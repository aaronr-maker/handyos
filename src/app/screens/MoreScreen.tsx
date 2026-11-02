import { Link } from 'react-router-dom';
import { Icon } from '@/core';
import { modules } from '../modules';

/** Mobile overflow: every area that does not fit in the bottom tab bar. */
export function MoreScreen() {
  const rest = modules.filter((m) => !m.mobileTab);
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
        <Link to="/system">
          <Icon name="system" />
          <span>System</span>
        </Link>
      </div>
    </section>
  );
}
