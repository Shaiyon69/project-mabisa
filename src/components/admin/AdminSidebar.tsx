import { NavLink } from 'react-router-dom';
import { Icon } from '../common/Icon';
import { AdminAccountMenu } from './AdminAccountMenu';
import type { UserRole } from '../../types/database';

type AdminSidebarProps = {
  fullName: string | null;
  role: UserRole | null;
  logout: () => Promise<void>;
};

/**
 * The portal's destinations, each with an icon as well as a label. Rendered by
 * both components below, so the rail and the narrow-window tab bar cannot drift
 * apart. Not exported: a non-component export from a `.tsx` costs Fast Refresh.
 */
const adminNavItems = [
  { to: '/admin', label: 'Dashboard', icon: 'home' as const, end: true },
  { to: '/admin/residents', label: 'Residents', icon: 'users' as const },
  { to: '/admin/inventory', label: 'Inventory', icon: 'package' as const },
  { to: '/admin/accounts', label: 'Accounts', icon: 'shield' as const },
  // A separate item from Reports: that answers "how many, in this period", this
  // answers "how is it moving, and where".
  { to: '/admin/analytics', label: 'Analytics', icon: 'chart' as const },
  { to: '/admin/reports', label: 'Reports', icon: 'clipboard' as const },
];

/** The rail: navigation, plus the account and the way out pinned to its foot. */
export function AdminSidebar({ fullName, role, logout }: AdminSidebarProps) {
  return (
    <aside className="side-rail admin-sidebar" aria-label="Admin navigation">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          B
        </span>
        <div>
          <p className="eyebrow">BRHP-MSAM</p>
          {/* Names the product, not the current page — "Dashboard" is already the
              first item in the rail below, and repeating it here just says the
              same word twice at the top of the screen. */}
          <strong>Admin Portal</strong>
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
        <AdminAccountMenu fullName={fullName} role={role} logout={logout} />
      </div>
    </aside>
  );
}

/**
 * The same destinations for a window too narrow for the rail. `.admin-sidebar` is
 * hidden below 860px, and this is hidden above it, so the two are never both on screen.
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
