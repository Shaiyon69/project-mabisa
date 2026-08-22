/**
 * Which surface this build is. Two deployments come out of this one repository:
 * the APK's web layer, which is the BHW phone app, and the LGU admin portal on a
 * server. They are separate systems in the field — different devices, different
 * people, different release cadence — so a build ships one of them and not the
 * other, and neither bundle carries the screens it can never show.
 *
 * `both` is the development default (`npm run dev`, `vite build` with no mode):
 * one server serving both trees is what you want while working, and the route
 * guard still keeps a session on the surface its role belongs to.
 *
 * Set by `define` in vite.config.ts from the build mode, not from a `.env` file:
 * the value decides what a deployment *is*, so it belongs to the build command
 * rather than to whichever env file happens to be on the machine.
 */
export type Surface = 'bhw' | 'admin' | 'both';

export const surface: Surface = (import.meta.env.VITE_SURFACE as Surface | undefined) ?? 'both';

/** True when this build contains the admin portal routes. */
export const buildsAdmin = surface !== 'bhw';

/** True when this build contains the BHW mobile routes. */
export const buildsBhw = surface !== 'admin';

/** True when this build has one surface only, so the other is not reachable at all. */
export const isSingleSurface = surface !== 'both';
