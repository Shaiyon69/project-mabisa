import { NavLink } from 'react-router-dom';

const adminNavItems = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/residents', label: 'Residents' },
  { to: '/admin/inventory', label: 'Inventory' },
  { to: '/admin/accounts', label: 'Accounts' },
  { to: '/admin/reports', label: 'Reports' },
];

export function AdminSidebar() {
  return (
    <aside className="side-rail admin-sidebar" aria-label="Admin navigation">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <div>
          <p className="eyebrow">Project MABISA</p>
          <strong>Admin Dashboard</strong>
        </div>
      </div>
      <nav className="admin-nav">
        {adminNavItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
