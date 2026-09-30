import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * The app is sideloaded, so nothing tells a phone a newer build exists. This asks
 * the repository's latest GitHub release and reports back only when it is ahead
 * of what is installed, read from the APK itself rather than a constant here.
 */
const LATEST_RELEASE_URL = 'https://api.github.com/repos/Shaiyon69/project-mabisa/releases/latest';

/** Digits and dots only. `1.0` and `1.0.1` are both fine; `1.0-rc1` is not a release we ship. */
const VERSION_PATTERN = /^\d+(\.\d+)*$/;

export type AvailableUpdate = {
  /** Release version, `v` stripped — what the banner shows and what a dismissal records. */
  version: string;
  /** Direct APK download, handed to the system browser. */
  url: string;
  /** The installed build is below the release's `min-version`: no "Later", and sync is paused. */
  required: boolean;
};

/**
 * A release body line `min-version: X.Y.Z` names the oldest build the server still
 * accepts writes from. Set it only when a schema change breaks older builds; they
 * keep working offline and their queue waits, untouched, until they update.
 */
const MIN_VERSION_PATTERN = /^min-version:\s*v?(\S+)\s*$/im;

let belowMinimum = false;

/** True once this launch's check found the installed build too old for the server. */
export function appTooOldToSync(): boolean {
  return belowMinimum;
}

/** Whether `installed` is older than the `min-version` a release body declares. */
export function isBelowMinimum(releaseBody: string | undefined, installed: string): boolean {
  const minimum = releaseBody?.match(MIN_VERSION_PATTERN)?.[1];
  return minimum ? isNewerVersion(minimum, installed) : false;
}

/**
 * Compares release tags segment by segment as numbers, since a string compare
 * calls 1.10.0 older than 1.9.0. Anything unparseable is treated as no update.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const strip = (value: string) => value.trim().replace(/^v/i, '');
  const tag = strip(candidate);
  const current = strip(installed);

  if (!VERSION_PATTERN.test(tag) || !VERSION_PATTERN.test(current)) {
    return false;
  }

  const left = tag.split('.').map(Number);
  const right = current.split('.').map(Number);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference > 0;
    }
  }

  return false;
}

type ReleaseAsset = { browser_download_url?: string };
type Release = { tag_name?: string; body?: string; assets?: ReleaseAsset[] };

/**
 * Null means "carry on" for every reason there is — the browser, an offline
 * device, a rate limit, a release with no APK — so a check nobody asked for never
 * raises an error mid-visit.
 */
export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (Capacitor.getPlatform() === 'web') {
    return null;
  }

  try {
    const [info, response] = await Promise.all([
      App.getInfo(),
      fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } }),
    ]);

    if (!response.ok) {
      return null;
    }

    // `/releases/latest` excludes drafts and prereleases, so whatever comes back is shippable.
    const release = (await response.json()) as Release;
    const tag = release.tag_name ?? '';

    if (!isNewerVersion(tag, info.version)) {
      return null;
    }

    const apk = (release.assets ?? []).find((asset) => asset.browser_download_url?.endsWith('.apk'));

    if (!apk?.browser_download_url) {
      return null;
    }

    belowMinimum = isBelowMinimum(release.body, info.version);

    return { version: tag.replace(/^v/i, ''), url: apk.browser_download_url, required: belowMinimum };
  } catch {
    return null;
  }
}
