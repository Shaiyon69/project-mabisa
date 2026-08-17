import type { FormEvent } from 'react';
import { Button } from '../../components/common/Button';
import { FormField } from '../../components/common/FormField';

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
  const isAdminPortal = window.location.pathname.startsWith('/admin');
  const portalName = isAdminPortal ? 'MABISA Admin Portal' : 'MABISA BHW Mobile';

  return (
    <main className={`mobile-shell auth-shell ${isAdminPortal ? 'admin-auth' : 'bhw-auth'}`}>
      <section className="login-panel">
        <div className="login-hero">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <p className="eyebrow">Project MABISA</p>
            <h1>{portalName}</h1>
            <p className="muted">
              {isAdminPortal
                ? 'Sign in with your authorized administrator account to manage MABISA operations.'
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
            placeholder={isAdminPortal ? 'admin@mabisa.local' : 'bhw@mabisa.local'}
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

        <p className="portal-switch">
          {isAdminPortal ? 'Are you a Barangay Health Worker?' : 'Are you an administrator?'}{' '}
          <a href={isAdminPortal ? '/bhw' : '/admin'}>
            Open the {isAdminPortal ? 'BHW mobile login' : 'Admin Portal'}
          </a>
        </p>

      </section>
    </main>
  );
}
