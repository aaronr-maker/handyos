import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Icon, isSupabaseConfigured, signOut, useSession, type IconName, type UserRole } from '@/core';
import { appConfig } from '@/config/app';
import { modules } from '../modules';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const home: NavItem = { to: '/', label: 'Home', icon: 'home', end: true };
/** Menu items for a role: sections hidden from the role are left out. */
const itemsFor = (role: UserRole) => {
  const visible = modules.filter((m) => !m.hiddenFromRoles?.includes(role));
  return {
    all: [
      home,
      ...visible.map((m) => ({ to: m.path, label: m.label, icon: m.icon })),
      { to: '/team', label: 'Team', icon: 'customers' as IconName },
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
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <div>
            <strong>{appConfig.name}</strong>
            <span>{companyName}</span>
          </div>
        </div>
        <nav aria-label="Main">
          {all.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
              <Icon name={i.icon} />
              {i.label}
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
        <img src="/icon.svg" alt="" width={28} height={28} />
        <strong>{appConfig.name}</strong>
      </header>

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
