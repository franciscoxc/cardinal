import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { checkForUpdates, compareVersions, plainNotes, releaseDiskImage } from '../checkForUpdates';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), message: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
// Keys are enough here: what matters is which dialog is shown, not its wording.
vi.mock('../../i18n/config', () => ({ default: { t: (key: string) => key } }));

describe('compareVersions', () => {
  it('orders releases, ignoring the tag prefix', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.3.0')).toBeLessThan(0);
  });

  it('compares each part as a number, not as text', () => {
    // The string comparison everyone reaches for first says 0.10.0 < 0.9.0, and the user is
    // told they are up to date on the older build.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.1', '0.3')).toBeGreaterThan(0);
  });

  it('does not crash on a tag it cannot parse', () => {
    expect(compareVersions('nightly', '0.2.0')).toBeLessThan(0);
  });
});

describe('plainNotes', () => {
  it('strips the markers a plain dialog would show literally', () => {
    const notes = plainNotes(
      '## Summary\n\n- **Bold** thing with `code` and a [link](https://example.com)\n- second\n',
    );
    expect(notes).toBe('Summary\n\n• Bold thing with code and a link\n• second');
  });

  it('drops images, which a dialog cannot show at all', () => {
    expect(plainNotes('before ![shot](https://example.com/a.png) after')).toBe('before  after');
  });

  it('cuts long notes at a line break rather than mid-sentence', () => {
    const long = Array.from({ length: 200 }, (_, i) => `- item number ${i}`).join('\n');
    const notes = plainNotes(long);
    expect(notes.length).toBeLessThan(1400);
    expect(notes.endsWith('…')).toBe(true);
    // Whatever survived has to be whole lines, or the tail reads like a bug.
    expect(
      notes
        .split('\n')
        .slice(0, -1)
        .every((line) => line.startsWith('• item number')),
    ).toBe(true);
  });
});

describe('releaseDiskImage', () => {
  it('picks the disk image out of a release, with what it weighs', () => {
    expect(
      releaseDiskImage({
        assets: [
          { browser_download_url: 'https://example.com/notes.txt', size: 12 },
          {
            browser_download_url: 'https://example.com/Cardinal_1.0.0_aarch64.dmg',
            size: 10276044,
          },
        ],
      }),
    ).toEqual({ url: 'https://example.com/Cardinal_1.0.0_aarch64.dmg', size: 10276044 });
  });

  it('still finds the image when the release does not say how big it is', () => {
    expect(
      releaseDiskImage({ assets: [{ browser_download_url: 'https://example.com/a.dmg' }] }),
    ).toEqual({ url: 'https://example.com/a.dmg', size: null });
  });

  it('returns null when a release published no disk image', () => {
    expect(
      releaseDiskImage({ assets: [{ browser_download_url: 'https://example.com/a.zip' }] }),
    ).toBe(null);
    expect(releaseDiskImage({ assets: [] })).toBe(null);
    expect(releaseDiskImage({})).toBe(null);
    expect(releaseDiskImage(null)).toBe(null);
  });
});

describe('checkForUpdates', () => {
  const mockedGetVersion = vi.mocked(getVersion);
  const mockedInvoke = vi.mocked(invoke);
  const mockedAsk = vi.mocked(ask);
  const mockedMessage = vi.mocked(message);
  const fetchMock = vi.fn();

  const DMG = 'https://github.com/franciscoxc/cardinal/releases/download/v9.9.9/Cardinal.dmg';
  const releaseAnswer = (release: unknown) => ({ ok: true, json: async () => release });
  const newerRelease = releaseAnswer({
    tag_name: 'v9.9.9',
    body: '',
    assets: [{ browser_download_url: DMG, size: 10276044 }],
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    mockedGetVersion.mockResolvedValue('0.5.1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('runs one check at a time, however often the menu is clicked', async () => {
    let answer!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    const first = checkForUpdates();
    // Clicked again while the first is still out. During a download nothing is on screen to say
    // so, and a second run fetched the same disk image over the one still being written.
    await checkForUpdates();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    answer(releaseAnswer({ tag_name: 'v0.5.1' }));
    await first;
    expect(mockedMessage).toHaveBeenCalledTimes(1);

    // Once it has finished, the next click checks again.
    fetchMock.mockResolvedValueOnce(releaseAnswer({ tag_name: 'v0.5.1' }));
    await checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says on the button how much it is about to download', async () => {
    fetchMock.mockResolvedValueOnce(newerRelease);
    mockedAsk.mockResolvedValueOnce(false);

    await checkForUpdates();

    expect(mockedAsk).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ okLabel: 'updates.available.download (9.80 MB)' }),
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('explains an install it had to refuse, and still offers the drag', async () => {
    fetchMock.mockResolvedValueOnce(newerRelease);
    mockedAsk
      .mockResolvedValueOnce(true) // download it
      .mockResolvedValueOnce(true) // install it
      .mockResolvedValueOnce(true); // could not: quit and do it by hand
    mockedInvoke.mockImplementation((command: string) =>
      command === 'install_update'
        ? Promise.reject(new Error('cannot write to "/Applications"'))
        : Promise.resolve({
            mountPoint: '/Volumes/Cardinal',
            diskImage: '/Users/x/Downloads/C.dmg',
          }),
    );

    await checkForUpdates();

    expect(mockedInvoke).toHaveBeenCalledWith('download_and_mount_update', { url: DMG });
    // The download worked — it is mounted, with its window open — so the dialog must not be the
    // one that says it failed and sends the user to a web page.
    const titles = mockedAsk.mock.calls.map(([, options]) => (options as { title: string }).title);
    expect(titles).toEqual([
      'updates.available.title',
      'updates.mounted.title',
      'updates.installFailed.title',
    ]);
    expect(mockedInvoke).toHaveBeenLastCalledWith('quit_app');
  });

  it('leaves the app running when the user would rather not finish it by hand now', async () => {
    fetchMock.mockResolvedValueOnce(newerRelease);
    mockedAsk.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockedInvoke.mockImplementation((command: string) =>
      command === 'install_update'
        ? Promise.reject(new Error('cannot write to "/Applications"'))
        : Promise.resolve({
            mountPoint: '/Volumes/Cardinal',
            diskImage: '/Users/x/Downloads/C.dmg',
          }),
    );

    await checkForUpdates();

    expect(mockedInvoke).not.toHaveBeenCalledWith('quit_app');
  });
});
