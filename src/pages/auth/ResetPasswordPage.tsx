import { useState, type FormEvent } from 'react';
import { Button } from '../../components/common/Button';
import { FormField } from '../../components/common/FormField';

/** Shortest password this screen will send. The project's own minimum may be lower. */
const MIN_PASSWORD_LENGTH = 8;

type ResetPasswordPageProps = {
  message: string | null;
  saving: boolean;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => Promise<void>;
};

/**
 * Where an emailed reset link lands. The link already signed this person in, so
 * the only thing left is to choose the password that replaces the forgotten one.
 */
export function ResetPasswordPage({ message, saving, onSubmit, onCancel }: ResetPasswordPageProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    if (password !== confirmation) {
      setLocalError('The two boxes are not the same. Type the new password again.');
      return;
    }

    setLocalError(null);
    await onSubmit(password);
  }

  return (
    <main className="mobile-shell auth-shell">
      <section className="login-panel">
        <div className="login-hero">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <div>
            <p className="eyebrow">BRHP-MSAM</p>
            <h1>Choose a new password</h1>
            <p className="muted">
              You opened this from the email we sent. Type the password you want to use from now on.
            </p>
          </div>
        </div>

        <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
          <FormField
            label="New password"
            autoComplete="new-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <FormField
            label="Type it again"
            autoComplete="new-password"
            type={showPassword ? 'text' : 'password'}
            value={confirmation}
            placeholder="The same password"
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />

          <label className="check-option">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            <span>Show password</span>
          </label>

          {localError || message ? <p className="alert">{localError ?? message}</p> : null}

          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save new password'}
          </Button>

          <Button variant="ghost" disabled={saving} onClick={() => void onCancel()}>
            Cancel and sign in instead
          </Button>
        </form>
      </section>
    </main>
  );
}
