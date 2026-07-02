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
  onDemoAccess: (target: 'bhw' | 'admin') => void;
};

export function LoginPage({
  email,
  password,
  authMessage,
  authLoading,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onDemoAccess,
}: LoginPageProps) {
  return (
    <main className="mobile-shell auth-shell">
      <section className="login-panel">
        <div className="login-hero">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <p className="eyebrow">Project MABISA</p>
            <h1>Barangay Health Access</h1>
            <p className="muted">Sign in once while online, then continue resident profiling and supply logging on the device.</p>
          </div>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <FormField
            label="Email"
            autoComplete="email"
            inputMode="email"
            type="email"
            value={email}
            placeholder="bhw@mabisa.local"
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
            {authLoading ? 'Checking Access' : 'Login to MABISA'}
          </Button>
        </form>

        <div className="login-footnote">
          <span>Offline-first BHW workflow</span>
          <span>Supabase sync ready</span>
        </div>

        <div className="demo-access">
          <div>
            <p className="eyebrow">Demo access</p>
            <strong>UI testing only</strong>
            <span>Temporary shortcuts for reviewing BHW and Admin screens without signing in.</span>
          </div>
          <div className="demo-actions">
            <Button variant="secondary" onClick={() => onDemoAccess('bhw')}>
              Enter as BHW
            </Button>
            <Button variant="ghost" onClick={() => onDemoAccess('admin')}>
              Enter as Admin
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
