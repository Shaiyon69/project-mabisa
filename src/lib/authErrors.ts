/**
 * Turns a Supabase auth error into a sentence naming what to try next. The raw
 * text still reaches `logDev`.
 */
export function describeAuthError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();

  // Ordered by how often a BHW hits it, and matched on fragments, since GoTrue's
  // exact wording changes across versions.
  if (message.includes('invalid login credentials') || message.includes('invalid email or password')) {
    return 'That email or password did not match. Check for a capital letter at the start, or a space at the end.';
  }

  // What an offline sign-in looks like from the browser and from the WebView.
  if (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('fetch failed')
  ) {
    return 'No connection, so your account could not be checked. Signing in needs internet once — after that the app works offline.';
  }

  if (message.includes('email not confirmed')) {
    return 'This account is not activated yet. Ask your administrator to finish setting it up.';
  }

  // Both raised while setting a new password from a reset link.
  if (message.includes('password should be at least') || message.includes('password is too short')) {
    return 'That password is too short. Use a longer one.';
  }

  if (message.includes('should be different from the old password')) {
    return 'That is the password the account already has. Choose a different one.';
  }

  // The reset link opened a session that has since run out.
  if (message.includes('session') && (message.includes('expired') || message.includes('missing'))) {
    return 'That link has run out. Ask for a new one from the sign-in screen.';
  }

  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('you can only request this after')
  ) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }

  if (message.includes('user not found')) {
    return 'There is no account with that email. Check the spelling, or ask your administrator.';
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'The connection was too slow to finish signing in. Try again where the signal is better.';
  }

  return 'Sign-in did not work. Check the email and password, and try again once you have a connection.';
}
