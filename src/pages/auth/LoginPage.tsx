import { useState, type FormEvent } from 'react';
import { Button } from '../../components/common/Button';
import { FormField } from '../../components/common/FormField';
import { surface } from '../../app/surface';

type LoginPageProps = {
  email: string;
  password: string;
  authMessage: string | null;
  authLoading: boolean;
  /**
   * Records saved on this device that have not reached the server, or null when
   * the count could not be read. A session that expires in the field drops the
   * BHW back here holding a phone full of unsent work, and the first thing they
   * need to know is that signing in again is not going to cost them any of it.
   */
  pendingRecordCount: number | null;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function LoginPage({
  email,
  password,
  authMessage,
  authLoading,
  pendingRecordCount,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginPageProps) {
  // A single-surface build already knows which portal it is. Only the combined
  // development build has to read the path to decide which one is being opened.
  const [showPassword, setShowPassword] = useState(false);
  const isAdminPortal = surface === 'admin' || (surface === 'both' && window.location.pathname.startsWith('/admin'));
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
            type={showPassword ? 'text' : 'password'}
            value={password}
            placeholder="Enter password"
            onChange={(event) => onPasswordChange(event.target.value)}
            required
          />

          {/*
            A password typed on a phone keyboard, by someone who cannot see what
            they typed, is the most common reason a correct password is reported
            as wrong. The default stays hidden; this only offers the choice.
          */}
          <label className="check-option">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            <span>Show password</span>
          </label>

          {authMessage ? <p className="alert">{authMessage}</p> : null}

          {pendingRecordCount ? (
            <p className="muted">
              {pendingRecordCount} record{pendingRecordCount === 1 ? ' is' : 's are'} still saved on this device and will sync
              once you are signed in. Nothing has been lost.
            </p>
          ) : null}

          <Button type="submit" disabled={authLoading}>
            {authLoading ? 'Checking Access' : isAdminPortal ? 'Sign in as Admin' : 'Sign in as BHW'}
          </Button>
        </form>
      </section>
    </main>
  );
}
