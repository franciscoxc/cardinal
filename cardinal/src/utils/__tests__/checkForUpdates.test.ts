import { describe, expect, it } from 'vitest';
import { compareVersions, diskImageUrl, plainNotes } from '../checkForUpdates';

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

describe('diskImageUrl', () => {
  it('picks the disk image out of a release', () => {
    expect(
      diskImageUrl({
        assets: [
          { browser_download_url: 'https://example.com/notes.txt' },
          { browser_download_url: 'https://example.com/Cardinal_1.0.0_aarch64.dmg' },
        ],
      }),
    ).toBe('https://example.com/Cardinal_1.0.0_aarch64.dmg');
  });

  it('returns null when a release published no disk image', () => {
    expect(diskImageUrl({ assets: [{ browser_download_url: 'https://example.com/a.zip' }] })).toBe(
      null,
    );
    expect(diskImageUrl({ assets: [] })).toBe(null);
    expect(diskImageUrl({})).toBe(null);
    expect(diskImageUrl(null)).toBe(null);
  });
});
