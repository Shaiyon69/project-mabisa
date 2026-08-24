/**
 * Turns a Supabase auth error into a sentence naming what to try next, rather
 * than raw GoTrue text like "Invalid login credentials". Raw text still reaches `logDev`.
 */
export function describeAuthError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();

  // Ordered by how often a BHW will actually hit it, and matched on fragments
  // because GoTrue's exact wording has changed across versions.
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

  if (message.includes('rate limit') || message.includes('too many requests')) {
    return 'Too many sign-in attempts. Wait a few minutes, then try again.';
  }

  if (message.includes('user not found')) {
    return 'There is no account with that email. Check the spelling, or ask your administrator.';
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'The connection was too slow to finish signing in. Try again where the signal is better.';
  }

  return 'Sign-in did not work. Check the email and password, and try again once you have a connection.';
}
