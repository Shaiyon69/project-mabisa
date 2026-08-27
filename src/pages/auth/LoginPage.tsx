import type { FormEvent } from 'react';
import { Button } from '../../components/common/Button';
import { FormField } from '../../components/common/FormField';
import { surface } from '../../app/surface';

type LoginPageProps = {
  email: string;
  password: string;
  authMessage: string | null;
  authLoading: boolean;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function LoginPage({
  email,
  password,
  authMessage,
  authLoading,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginPageProps) {
  // A single-surface build already knows which portal it is. Only the combined
  // development build has to read the path to decide which one is being opened.
  const isAdminPortal = surface === 'admin' || (surface === 'both' && window.location.pathname.startsWith('/admin'));
  const portalName = isAdminPortal ? 'BRHP-MSAM Admin Portal' : 'BRHP-MSAM BHW Mobile';

  return (
    <main className={`mobile-shell auth-shell ${isAdminPortal ? 'admin-auth' : 'bhw-auth'}`}>
      <section className="login-panel">
        <div className="login-hero">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <div>
            {/* The sign-in screen is where most people meet the name for the
                first time, so it is the one place that spells the acronym out
                in full rather than leaving it as six letters. */}
            <p className="eyebrow">Barangay Residents Health Profiling and Medical Supply Allocation Monitoring System</p>
            <h1>{portalName}</h1>
            <p className="muted">
              {isAdminPortal
                ? 'Sign in with your authorized administrator account to manage barangay health profiling and supply monitoring.'
                : 'For Barangay Health Workers. Sign in once while online, then continue field work on your device.'}
            </p>
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

          <FormField
            label="Password"
            autoComplete="current-password"
            type="password"
            value={password}
            placeholder="Enter password"
            onChange={(event) => onPasswordChange(event.target.value)}
            required
          />

          {authMessage ? <p className="alert">{authMessage}</p> : null}

          <Button type="submit" disabled={authLoading}>
            {authLoading ? 'Checking Access' : isAdminPortal ? 'Sign in as Admin' : 'Sign in as BHW'}
          </Button>
        </form>
      </section>
    </main>
  );
}
