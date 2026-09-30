import { useEffect, useId, useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from '../../components/common/Button';
import { FormField } from '../../components/common/FormField';
import { Icon } from '../../components/common/Icon';
import { TermsDialog } from '../../components/common/TermsNotice';
import { Turnstile } from '../../components/common/Turnstile';
import { turnstileSiteKey } from '../../lib/captcha';
import { surface } from '../../app/surface';
import { describeWait } from '../../lib/loginThrottle';

type LoginPageProps = {
  email: string;
  password: string;
  authMessage: string | null;
  authLoading: boolean;
  /** Records saved on this device that have not reached the server, or null if unreadable. */
  pendingRecordCount: number | null;
  /** Epoch milliseconds until which this address may not try again, or 0. */
  lockedUntil: number;
  /** Whether a captcha token is in hand. Always true in a build without a site key. */
  captchaReady: boolean;
  /** Bumped by the parent after each request that spent the captcha token. */
  captchaResetKey: number;
  onCaptchaToken: (token: string | null) => void;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  /** Mails a reset link to the address typed above. */
  onForgotPassword: () => Promise<void>;
};

/** Milliseconds left until `until`, re-rendering each second while it counts down. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) {
      return;
    }

    const tick = () => {
      const current = Date.now();

      setNow(current);

      if (current >= until) {
        window.clearInterval(timer);
      }
    };
    // Straight away as well as each second: `now` is as old as the last tick, and
    // a lock read for a newly typed address would otherwise count from then.
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [until]);

  return Math.max(0, until - now);
}

export function LoginPage({
  email,
  password,
  authMessage,
  authLoading,
  pendingRecordCount,
  lockedUntil,
  captchaReady,
  captchaResetKey,
  onCaptchaToken,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onForgotPassword,
}: LoginPageProps) {
  // Only the combined dev build needs the path — a single-surface build already knows which portal it is.
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  // Unticked on every visit to this screen, so each sign-in is its own agreement.
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const lockLeft = useCountdown(lockedUntil);
  const isAdminPortal = surface === 'admin' || (surface === 'both' && window.location.pathname.startsWith('/admin'));
  const portalName = 'BRHP-MSAM';
  // The reset link arrives by email and opens in a browser, which is nowhere the
  // installed app can be reached from. On a phone the health office is the path.
  const canEmailReset = Capacitor.getPlatform() === 'web';

  return (
    <main className={`mobile-shell auth-shell ${isAdminPortal ? 'admin-auth' : 'bhw-auth'}`}>
      <section className="login-panel">
        <div className="login-hero">
          <span className="brand-mark" aria-hidden="true">
            <img src="/assets/logo.png" alt="" />
          </span>
          <div>
            <h1>{portalName}</h1>
          </div>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <FormField
            label="Email"
            autoComplete="email"
            inputMode="email"
            type="email"
            value={email}
            placeholder={isAdminPortal ? 'admin@brhp-msam.local' : 'bhw@brhp-msam.local'}
            onChange={(event) => onEmailChange(event.target.value)}
            required
          />

          {/* Not FormField: its <label> wraps the input, and the eye button inside
              it would make the input's accessible name "Password Show password". */}
          <div className="ui-field">
            <label htmlFor={passwordId}>
              Password
              <b className="required-mark" aria-hidden="true">
                {' '}
                *
              </b>
            </label>
            <div className="password-field">
              <input
                id={passwordId}
                autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                placeholder="Enter password"
                onChange={(event) => onPasswordChange(event.target.value)}
                required
              />
              {/* Default stays hidden — this only offers the choice, for phone keyboards where typos are easy to miss. */}
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </div>
          </div>

          {turnstileSiteKey ? <Turnstile onToken={onCaptchaToken} resetKey={captchaResetKey} /> : null}

          {lockLeft > 0 ? (
            <p className="alert" role="status">
              Too many wrong passwords for this email. Try again in {describeWait(lockLeft)}.
            </p>
          ) : authMessage ? (
            <p className="alert">{authMessage}</p>
          ) : null}

          {pendingRecordCount ? (
            <p className="muted">
              {pendingRecordCount} record{pendingRecordCount === 1 ? ' is' : 's are'} still saved on this device and will sync
              once you are signed in. Nothing has been lost.
            </p>
          ) : null}

          {/* Straight above the button it unlocks. `required`, so the browser
              refuses the submit and says why, rather than the button sitting
              disabled with no explanation. The link is a button inside the label:
              clicking it opens the terms without ticking the box. */}
          <label className="terms-agree">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required />
            <span>
              I have read and agree to the{' '}
              <button
                type="button"
                className="text-link"
                onClick={(event) => {
                  event.preventDefault();
                  setTermsOpen(true);
                }}
              >
                Terms and Conditions
              </button>{' '}
              and Privacy Notice under the Data Privacy Act of 2012.
            </span>
          </label>

          <Button type="submit" disabled={authLoading || lockLeft > 0 || !captchaReady}>
            {authLoading
              ? 'Checking Access'
              : !captchaReady
                ? 'Waiting for security check'
                : 'Log in'}
          </Button>

          {canEmailReset ? (
            <Button variant="ghost" disabled={authLoading || !captchaReady} onClick={() => void onForgotPassword()}>
              I forgot my password
            </Button>
          ) : null}

          {/* The honest half of the answer: a reset link only reaches an account
              whose email address is a real one somebody can open. */}
          <p className="muted">
            {canEmailReset
              ? 'We will email you a link to set a new one. If no email arrives, ask the health office to reset it for you.'
              : 'Forgot your password? Ask the health office to reset it for you — it cannot be changed from this phone.'}
          </p>
        </form>
      </section>

      <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
    </main>
  );
}
