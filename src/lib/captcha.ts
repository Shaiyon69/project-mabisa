/**
 * The Cloudflare Turnstile site key. Supabase Auth checks the captcha on sign-in
 * and on a password reset request once "Enable Captcha protection" is on for the
 * project.
 *
 * Empty in a build without `VITE_TURNSTILE_SITE_KEY`, so development, CI and the
 * e2e suite run without one. Once the project enforces captcha, every build that
 * signs in — the portal and the APK — needs the key.
 *
 * The APK's WebView serves from `https://localhost`, so `localhost` has to be on
 * the widget's hostname list alongside the portal's domain.
 */
export const turnstileSiteKey: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
