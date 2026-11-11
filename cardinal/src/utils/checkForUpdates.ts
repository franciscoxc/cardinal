import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import i18n from '../i18n/config';
import { formatBytes } from './format';

const LATEST_RELEASE_API = 'https://api.github.com/repos/franciscoxc/cardinal/releases/latest';
export const RELEASES_PAGE = 'https://github.com/franciscoxc/cardinal/releases/latest';
/** Every release with its notes, for the Help menu: a place to read, not a check to run. */
export const ALL_RELEASES_PAGE = 'https://github.com/franciscoxc/cardinal/releases';

/** How much of the release notes the dialog will show before pointing at the full page. */
const NOTES_BUDGET = 1200;

/**
 * Release notes as a plain dialog can show them.
 *
 * The dialog takes a string, not markup, so the markers have to go or they show up as literal
 * asterisks and brackets. Links keep their text and lose the URL: nothing in a modal can be
 * clicked anyway.
 */
export const plainNotes = (body: string): string => {
  const text = body
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Spaces and tabs, not \s: that class includes the newline, so a bullet after a blank line
    // swallowed the blank line and the notes came out as one wall of text.
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length <= NOTES_BUDGET) {
    return text;
  }
  // Cut at a line break rather than mid-sentence, so the tail never reads like a truncation bug.
  const cut = text.lastIndexOf('\n', NOTES_BUDGET);
  return `${text.slice(0, cut > 0 ? cut : NOTES_BUDGET).trim()}\n…`;
};

/** The macOS disk image among a release's assets, if it published one, and what it weighs. */
export const releaseDiskImage = (release: unknown): { url: string; size: number | null } | null => {
  if (typeof release !== 'object' || release === null || !('assets' in release)) {
    return null;
  }
  const assets = (release as { assets: unknown }).assets;
  if (!Array.isArray(assets)) {
    return null;
  }
  for (const asset of assets) {
    if (typeof asset !== 'object' || asset === null) {
      continue;
    }
    const { browser_download_url: url, size } = asset as {
      browser_download_url?: unknown;
      size?: unknown;
    };
    if (typeof url === 'string' && url.endsWith('.dmg')) {
      return { url, size: typeof size === 'number' && size > 0 ? size : null };
    }
  }
  return null;
};

/** Negative when `a` is older, positive when newer, zero when the same release. */
export const compareVersions = (a: string, b: string): number => {
  // Tags carry a leading `v`, and a pre-release suffix (`0.3.0-beta.1`) is not part of the ordering
  // here: it would need its own precedence rules, and this fork does not publish pre-releases.
  const parts = (value: string) =>
    value
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((piece) => Number.parseInt(piece, 10) || 0);

  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

// ponytail-keep: one check at a time. Between agreeing to the download and the dialog that
// follows it nothing is on screen, and the menu is still there to be clicked — a second run
// fetched the same disk image over the one the first was still writing, then mounted whichever
// state it was in.
let checking = false;

/**
 * Asks GitHub for the latest release and tells the user where they stand. Only ever runs from the
 * menu: the app makes no network requests on its own, and that should stay true.
 */
export async function checkForUpdates(): Promise<void> {
  if (checking) {
    return;
  }
  checking = true;
  try {
    await runUpdateCheck();
  } finally {
    checking = false;
  }
}

async function runUpdateCheck(): Promise<void> {
  const t = i18n.t.bind(i18n);
  let current = '';

  try {
    current = await getVersion();
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`);
    }

    const release: unknown = await response.json();
    const tag =
      typeof release === 'object' && release !== null && 'tag_name' in release
        ? String((release as { tag_name: unknown }).tag_name)
        : '';
    if (!tag) {
      throw new Error('release has no tag_name');
    }

    const latest = tag.replace(/^v/i, '');
    if (compareVersions(latest, current) <= 0) {
      await message(t('updates.upToDate.body', { version: current }), {
        title: t('updates.upToDate.title'),
      });
      return;
    }

    const notes =
      typeof release === 'object' && release !== null && 'body' in release
        ? plainNotes(String((release as { body: unknown }).body ?? ''))
        : '';
    const dmg = releaseDiskImage(release);
    // The dialog goes away on the click and nothing takes its place until the download is done,
    // so the button says how much it is about to fetch. A plain dialog cannot show progress; it
    // can at least set the expectation.
    const weight = formatBytes(dmg?.size);
    const downloadLabel = weight
      ? `${t('updates.available.download')} (${weight})`
      : t('updates.available.download');

    const headline = t('updates.available.body', { latest, current });
    const wantsDownload = await ask(notes ? `${headline}\n\n${notes}` : headline, {
      title: t('updates.available.title'),
      okLabel: dmg ? downloadLabel : t('updates.failed.open'),
      cancelLabel: t('updates.available.later'),
    });
    if (!wantsDownload) {
      return;
    }

    // No disk image in the release: fall back to the page, which is what this always did.
    if (!dmg) {
      await openUrl(RELEASES_PAGE);
      return;
    }

    try {
      const { mountPoint, diskImage } = await invoke<{ mountPoint: string; diskImage: string }>(
        'download_and_mount_update',
        { url: dmg.url },
      );
      // ponytail-keep: quitting is part of installing, not a courtesy. macOS will not let the new
      // app replace the one that is running, so the installer runs after this process is gone —
      // the button says what it does rather than "OK".
      const install = await ask(t('updates.mounted.body'), {
        title: t('updates.mounted.title', { latest }),
        okLabel: t('updates.mounted.install'),
        cancelLabel: t('updates.mounted.manual'),
      });
      if (install) {
        try {
          await invoke('install_update', { mountPoint, diskImage });
          return;
        } catch (installError) {
          console.error('Update install failed', installError);
          // ponytail-keep: its own dialog, with the way out that still works. The app refuses to
          // install where it cannot write — /Applications on an account that is not an
          // administrator — and that used to fall through to the message below, which says the
          // download failed and points at the web page. The download is fine: it is mounted, its
          // window is open, and Finder can ask for the password this app cannot.
          const wantsManual = await ask(t('updates.installFailed.body'), {
            title: t('updates.installFailed.title'),
            kind: 'warning',
            okLabel: t('updates.mounted.manual'),
            cancelLabel: t('updates.available.later'),
          });
          if (!wantsManual) {
            return;
          }
        }
      }
      // Doing it by hand: the volume is already open, so leave it and get out of the way.
      await invoke('quit_app');
    } catch (downloadError) {
      console.error('Update download failed', downloadError);
      // Downloading is a convenience; the page is the thing that always works.
      const wantsPage = await ask(t('updates.downloadFailed.body'), {
        title: t('updates.downloadFailed.title'),
        okLabel: t('updates.failed.open'),
        cancelLabel: t('updates.available.later'),
      });
      if (wantsPage) {
        await openUrl(RELEASES_PAGE);
      }
    }
  } catch (error) {
    console.error('Update check failed', error);
    // Offline, rate-limited, or GitHub is down: say so and offer the page, which may still work.
    const wantsPage = await ask(t('updates.failed.body'), {
      title: t('updates.failed.title'),
      okLabel: t('updates.failed.open'),
      cancelLabel: t('updates.available.later'),
    });
    if (wantsPage) {
      await openUrl(RELEASES_PAGE);
    }
  }
}
