import { Suspense, type ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Icon, isSupabaseConfigured, signOut, useSession, type IconName, type UserRole } from '@/core';
import { modules } from '../modules';

interface NavItem {
  Badge?: ComponentType;
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const home: NavItem = { to: '/', label: 'Home', icon: 'home', end: true };
/** Menu items for a role: sections hidden from the role are left out. */
const itemsFor = (role: UserRole) => {
  const visible = modules.filter((m) => !m.hiddenFromRoles?.includes(role) && !m.hiddenFromNav);
  return {
    all: [
      home,
      ...visible.map((m) => ({ to: m.path, label: m.label, icon: m.icon, Badge: m.Badge })),
      { to: '/earnings', label: 'My earnings', icon: 'jobcosting' as IconName },
      { to: '/team', label: 'Team', icon: 'customers' as IconName },
      ...(role === 'owner' || role === 'admin' ? [{ to: '/settings', label: 'Settings', icon: 'system' as IconName }] : []),
      { to: '/system', label: 'System', icon: 'system' as IconName },
    ] as NavItem[],
    tabs: [
      home,
      ...visible.filter((m) => m.mobileTab).map((m) => ({ to: m.path, label: m.label, icon: m.icon })),
      { to: '/more', label: 'More', icon: 'more' as IconName },
    ] as NavItem[],
  };
};

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);

export function AppShell() {
  const { companyName, role } = useSession();
  const { all, tabs } = itemsFor(role);
  const overlays = modules.filter((m) => m.Overlay && !m.hiddenFromRoles?.includes(role));
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo-small.png" alt={companyName} />
        </div>
        <nav aria-label="Main">
          {all.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
              <Icon name={i.icon} />
              {i.label}
              {i.Badge && <i.Badge />}
            </NavLink>
          ))}
        </nav>
        {isSupabaseConfigured && (
          <button className="link signout" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </aside>

      <header className="topbar">
        <img src="/logo-small.png" alt={companyName} height={30} style={{ height: 30, width: 'auto' }} />
      </header>

      {overlays.map((m) => m.Overlay && <m.Overlay key={m.id} />)}

      <main className="content">
        <Suspense fallback={<p className="muted pad">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="tabbar" aria-label="Main">
        {tabs.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
            <Icon name={i.icon} />
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
