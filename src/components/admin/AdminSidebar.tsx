import { NavLink } from 'react-router-dom';
import { Icon } from '../common/Icon';
import { AdminAccountMenu } from './AdminAccountMenu';

type AdminSidebarProps = {
  fullName: string | null;
  logout: () => Promise<void>;
};

/**
 * Each destination carries an icon as well as its label. The portal is used on a
 * wide screen where the rail is read at a glance rather than word by word, and a
 * shape is what the eye lands on first; the label stays, because an icon alone
 * is a guess.
 *
 * The list is module-local and rendered by both components below, so the rail
 * and the narrow-window tab bar cannot drift apart. It is not exported: a
 * non-component export from a `.tsx` costs every consumer Fast Refresh.
 */
const adminNavItems = [
  { to: '/admin', label: 'Dashboard', icon: 'home' as const, end: true },
  { to: '/admin/residents', label: 'Residents', icon: 'users' as const },
  { to: '/admin/inventory', label: 'Inventory', icon: 'package' as const },
  { to: '/admin/accounts', label: 'Accounts', icon: 'shield' as const },
  // Analytics and Reports are different questions and so are different rail
  // items: Reports is "how many, in this period", Analytics is "how is it
  // moving, and where". Folding the second into the first is what buried it.
  { to: '/admin/analytics', label: 'Analytics', icon: 'chart' as const },
  { to: '/admin/reports', label: 'Reports', icon: 'clipboard' as const },
];

/**
 * The rail carries navigation and, pinned to its foot, the account: who is signed
 * in and the way out of the portal. They sit together because they are the shell
 * rather than the page, and the foot of a rail is where the eye lands last — the
 * account is checked at the start of a session and at the end of one, not while
 * reading a table.
 */
export function AdminSidebar({ fullName, logout }: AdminSidebarProps) {
  return (
    <aside className="side-rail admin-sidebar" aria-label="Admin navigation">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          B
        </span>
        <div>
          <p className="eyebrow">BRHP-MSAM</p>
          <strong>Admin Dashboard</strong>
        </div>
      </div>
      <nav className="admin-nav">
        {adminNavItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <Icon name={item.icon} size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-account">
        <AdminAccountMenu fullName={fullName} logout={logout} />
      </div>
    </aside>
  );
}

/**
 * The same destinations for a window too narrow for the rail.
 *
 * Below 860px `.admin-sidebar` is hidden, and until now nothing took its place —
 * the portal had no navigation at all in a half-width browser window, only the
 * address bar. This is that navigation, and it is hidden again at the breakpoint
 * where the rail comes back so the two are never both on screen.
 */
export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Admin sections">
      {adminNavItems.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          <Icon name={item.icon} size={22} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
