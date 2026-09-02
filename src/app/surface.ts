/**
 * Which surface this build is. Two deployments come out of this repository — the
 * APK's web layer and the LGU admin portal — and neither bundle carries the
 * screens it can never show. `both` is the development default.
 *
 * Set by `define` in vite.config.ts from the build mode rather than a `.env` file,
 * since the value decides what a deployment is.
 */
export type Surface = 'bhw' | 'admin' | 'both';

export const surface: Surface = (import.meta.env.VITE_SURFACE as Surface | undefined) ?? 'both';

/** True when this build contains the admin portal routes. */
export const buildsAdmin = surface !== 'bhw';

/** True when this build contains the BHW mobile routes. */
export const buildsBhw = surface !== 'admin';

/** True when this build has one surface only, so the other is not reachable at all. */
export const isSingleSurface = surface !== 'both';
