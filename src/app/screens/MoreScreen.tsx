import { Link } from 'react-router-dom';
import { Icon, isSupabaseConfigured, signOut, useSession } from '@/core';
import { modules } from '../modules';

/** Mobile overflow: every area that does not fit in the bottom tab bar. */
export function MoreScreen() {
  const { role } = useSession();
  const rest = modules.filter((m) => !m.mobileTab && !m.hiddenFromRoles?.includes(role));
  return (
    <section className="page">
      <header className="page-header">
        <h1>More</h1>
      </header>
      <div className="card list">
        {rest.map((m) => (
          <Link key={m.id} to={m.path}>
            <Icon name={m.icon} />
            <span>{m.label}</span>
          </Link>
        ))}
        <Link to="/earnings">
          <Icon name="jobcosting" />
          <span>My earnings</span>
        </Link>
        {(role === 'owner' || role === 'admin') && (
          <Link to="/settings">
            <Icon name="system" />
            <span>Settings</span>
          </Link>
        )}
        <Link to="/team">
          <Icon name="customers" />
          <span>Team</span>
        </Link>
        <Link to="/system">
          <Icon name="system" />
          <span>System</span>
        </Link>
      </div>
      {isSupabaseConfigured && (
        <button className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      )}
    </section>
  );
}
