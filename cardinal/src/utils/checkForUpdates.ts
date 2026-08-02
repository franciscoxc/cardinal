import { getVersion } from '@tauri-apps/api/app';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import i18n from '../i18n/config';

const LATEST_RELEASE_API = 'https://api.github.com/repos/franciscoxc/cardinal/releases/latest';
export const RELEASES_PAGE = 'https://github.com/franciscoxc/cardinal/releases/latest';

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

/**
 * Asks GitHub for the latest release and tells the user where they stand. Only ever runs from the
 * menu: the app makes no network requests on its own, and that should stay true.
 */
export async function checkForUpdates(): Promise<void> {
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

    const wantsDownload = await ask(t('updates.available.body', { latest, current }), {
      title: t('updates.available.title'),
      okLabel: t('updates.available.download'),
      cancelLabel: t('updates.available.later'),
    });
    if (wantsDownload) {
      await openUrl(RELEASES_PAGE);
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
