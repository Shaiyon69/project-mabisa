import { useEffect, useRef, useState } from 'react';
import { useDeviceLock } from '../../hooks/useDeviceLock';
import { PIN_LENGTH, describeWait, describeWeakPin, isPinSet, setPin, verifyPin } from '../../lib/devicePin';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';

type PinGateProps = {
  userId: string;
  /** Shown under the heading so a locked screen never reads as lost work. */
  pendingRecordCount: number;
  children: React.ReactNode;
};

type Phase = 'checking' | 'choose' | 'confirm' | 'entry';

/**
 * The PIN between a signed-in session and this device's records, asked for on a
 * cold start and after the device has been left alone. Checked entirely on the
 * device, and a wrong PIN costs an escalating wait and nothing else.
 */
export function PinGate({ userId, pendingRecordCount, children }: PinGateProps) {
  const { locked, unlock } = useDeviceLock();
  // null while the keystore is still being read — not the same answer as "no PIN".
  const [pinExists, setPinExists] = useState<boolean | null>(null);
  const [setupStep, setSetupStep] = useState<'choose' | 'confirm'>('choose');
  const [digits, setDigits] = useState('');
  const [firstEntry, setFirstEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Derived from the two facts above rather than held as a third piece of state,
  // so a re-lock needs nothing but the hook flipping `locked`.
  const phase: Phase = pinExists === null ? 'checking' : pinExists ? 'entry' : setupStep;

  // Whether this account has a PIN on this device decides which screen it gets.
  useEffect(() => {
    let cancelled = false;

    isPinSet(userId)
      .then((exists) => !cancelled && setPinExists(exists))
      // A keystore that cannot be read is not a reason to hand over the records.
      .catch(() => !cancelled && setPinExists(false));

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (phase !== 'checking') {
      inputRef.current?.focus();
    }
  }, [phase]);

  if (pinExists && !locked) {
    return <>{children}</>;
  }

  async function submit() {
    if (digits.length !== PIN_LENGTH || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (phase === 'entry') {
        const attempt = await verifyPin(userId, digits);

        if (attempt.ok) {
          setDigits('');
          unlock();
          return;
        }

        setDigits('');
        setError(
          attempt.reason === 'no-pin'
            ? 'No PIN is set on this device.'
            : attempt.waitMs
              ? `That PIN is not right. ${describeWait(attempt.waitMs)}`
              : 'That PIN is not right. Try again.',
        );

        if (attempt.reason === 'no-pin') {
          setPinExists(false);
          setSetupStep('choose');
        }

        return;
      }

      if (phase === 'choose') {
        const weakness = describeWeakPin(digits);

        if (weakness) {
          setError(weakness);
          setDigits('');
          return;
        }

        setFirstEntry(digits);
        setDigits('');
        setSetupStep('confirm');
        return;
      }

      // confirm
      if (digits !== firstEntry) {
        setError('The two entries did not match. Start again.');
        setFirstEntry('');
        setDigits('');
        setSetupStep('choose');
        return;
      }

      await setPin(userId, digits);
      setDigits('');
      setFirstEntry('');
      setPinExists(true);
      unlock();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.');
      setDigits('');
    } finally {
      setBusy(false);
    }
  }

  const copy = {
    checking: { title: 'One moment', body: 'Opening this device.' },
    choose: {
      title: 'Choose a PIN',
      body: `${PIN_LENGTH} digits. You will enter this to open BRHP-MSAM on this phone, even with no signal.`,
    },
    confirm: { title: 'Enter it again', body: 'Just to be sure it was typed the way you meant.' },
    entry: {
      title: 'Enter your PIN',
      body: pendingRecordCount
        ? `${pendingRecordCount} record(s) are still saved on this device.`
        : 'Nothing was lost. Your records are still on this device.',
    },
  }[phase];

  return (
    <div className="pin-gate" role="dialog" aria-modal="true" aria-label={copy.title}>
      <span className="brand-mark" aria-hidden="true">
        B
      </span>
      <h2>{copy.title}</h2>
      <p className="muted">{copy.body}</p>

      {phase === 'checking' ? null : (
        <>
          {/* One input, not four boxes: a single numeric field is what a phone keypad
              and a screen reader both handle without help. */}
          <input
            ref={inputRef}
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label={copy.title}
            aria-invalid={Boolean(error)}
            maxLength={PIN_LENGTH}
            value={digits}
            disabled={busy}
            onChange={(event) => {
              setDigits(event.target.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH));
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />

          <p className="pin-progress" aria-hidden="true">
            {'●'.repeat(digits.length).padEnd(PIN_LENGTH, '○')}
          </p>

          {error ? (
            <p className="form-alert" role="alert">
              <Icon name="warning" size={18} />
              {error}
            </p>
          ) : null}

          <Button disabled={digits.length !== PIN_LENGTH || busy} onClick={() => void submit()}>
            {busy ? 'Checking...' : phase === 'entry' ? 'Open' : 'Save PIN'}
          </Button>

          {/* No sign-out button here on purpose: signing out needs a connection to
              sign back in, so offering it to someone with no signal would take away
              the little they can still do. */}
          {phase === 'entry' ? (
            <p className="pin-help muted">
              Forgotten it? Your records stay safe on this phone. Once you have a signal, sign in again
              with your email and password to set a new PIN.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
