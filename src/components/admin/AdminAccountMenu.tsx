import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { ThemeToggle } from '../common/ThemeToggle';
import type { UserRole } from '../../types/database';

type AdminAccountMenuProps = {
  /** The signed-in account's name, from the cached profile row read at sign-in. */
  fullName: string | null;
  /** Named on the panel, so an RHU account is not told it is a barangay one. */
  role: UserRole | null;
  logout: () => Promise<void>;
};

/** How a role reads on screen. `barangay_admin` is not a title an officer would recognise. */
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Rural Health Unit administrator',
  barangay_admin: 'Barangay administrator',
  bhw: 'Barangay Health Worker',
};

/**
 * Who is signed in, plus appearance and sign-out. The name is the button itself,
 * since a shared workstation is checked before encoding starts; the role and
 * address sit behind the click.
 *
 * Rendered at the foot of the rail and again in `AdminTopbar` below 860px, with
 * CSS keeping exactly one on screen.
 */
export function AdminAccountMenu({ fullName, role, logout }: AdminAccountMenuProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);

  // getSession reads the cached session, so the account line renders immediately
  // and survives Supabase being unreachable.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  // A <details> closes on a second click on its own summary and on nothing else,
  // so the panel would otherwise stay open over the table behind it.
  useEffect(() => {
    const closeIfOutside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) {
        menu.current?.removeAttribute('open');
      }
    };

    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('focusin', closeIfOutside);

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('focusin', closeIfOutside);
    };
  }, []);

  const displayName = fullName ?? email ?? 'Signed-in account';
  const roleLabel = role ? ROLE_LABELS[role] : 'Signed in';

  return (
    <>
      {/* A native <details> rather than open state: the summary is already
          focusable and already toggles on Enter and Space. Closing it from
          outside is the one thing it does not do, hence the effect above. */}
      <details className="account-menu" ref={menu}>
        <summary aria-label="Account menu">
          <span className="account-avatar" aria-hidden="true">
            {initialsOf(displayName)}
          </span>
          {/* The address is a second line rather than a second element: in the
              rail the bar is the only account surface on screen, and "which
              account is this" is answered by the address more often than by a
              name two people at the barangay may share. CSS drops it in the
              topbar, which is one row high. */}
          <span className="account-identity">
            <span className="account-name">{displayName}</span>
            {/* Dropped when the name line is already the address — an account with
                no `full_name` otherwise prints its email twice, stacked. */}
            {email && email !== displayName ? <span className="account-email-line">{email}</span> : null}
          </span>
          <Icon name="chevron" size={15} className="account-caret" />
        </summary>

        <div className="account-panel">
          <p className="account-role">{roleLabel}</p>
          <p className="account-email">{email ?? 'Signed in'}</p>

          <div className="profile-setting">
            <span>Appearance</span>
            <ThemeToggle />
          </div>

          {/* Confirmed rather than immediate. The portal is a shared LGU
              workstation and this button sits two clicks from every screen; a
              mis-click here ends the session mid-edit and the next person has to
              find someone with the password. */}
          <Button
            variant="danger"
            className="profile-logout"
            onClick={() => {
              // A plain <details> stays open under the dialog unless closed here.
              menu.current?.removeAttribute('open');
              setConfirmingLogout(true);
            }}
          >
            <Icon name="logout" size={17} />
            Logout
          </Button>
        </div>
      </details>

      <Modal open={confirmingLogout} title="Log out of BRHP-MSAM?" onClose={() => setConfirmingLogout(false)}>
        <p className="logout-warning">
          <Icon name="warning" size={20} />
          Unsaved filters and anything open on this screen are lost. Field records are unaffected — they live on the BHW
          devices and in the central database.
        </p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setConfirmingLogout(false)}>
            Stay signed in
          </Button>
          <Button variant="danger" onClick={() => void logout()}>
            <Icon name="logout" size={17} />
            Log out
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** First letters of the first two words, so an email address gives one letter rather than a slice of the domain. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
