import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { ThemeToggle } from '../common/ThemeToggle';

type AdminAccountMenuProps = {
  /** The signed-in account's name, from the cached profile row read at sign-in. */
  fullName: string | null;
  logout: () => Promise<void>;
};

/**
 * Who is signed in, and the two controls that belong to that account —
 * appearance and sign-out. On a shared LGU workstation the name is what someone
 * needs to check before they start encoding, which is why it is the button
 * itself; the role and the address are the same on every visit and sit behind
 * the click.
 *
 * Rendered twice, in the same way `adminNavItems` is: at the foot of the rail on
 * a wide window, and in `AdminTopbar` below 860px where the rail is hidden. CSS
 * keeps exactly one of the two on screen.
 */
export function AdminAccountMenu({ fullName, logout }: AdminAccountMenuProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);

  // getSession reads the cached session rather than going to the network, so the
  // account line renders immediately and still renders if Supabase is unreachable.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  const displayName = fullName ?? email ?? 'Barangay Official';

  return (
    <>
      {/* A native <details> rather than open-state plus an outside-click
          listener: the summary is already focusable, already toggles on Enter
          and Space, and already closes on a second click. */}
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
            <span className="account-email-line">{email ?? 'Signed in'}</span>
          </span>
          <Icon name="chevron" size={15} className="account-caret" />
        </summary>

        <div className="account-panel">
          <p className="account-role">Barangay Official</p>
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
              // The menu is a plain <details>, so it stays open under the dialog
              // unless it is closed here.
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

/** First letters of the first two words, so an email address falls back to one letter rather than a slice of the domain. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
