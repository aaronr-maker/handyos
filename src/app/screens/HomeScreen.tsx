import { Link } from 'react-router-dom';
import { Icon, isSupabaseConfigured, useSession } from '@/core';
import { appConfig } from '@/config/app';
import { modules } from '../modules';

export function HomeScreen() {
  const { companyName } = useSession();
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Welcome to {appConfig.name}</h1>
          <p className="muted">
            {companyName} · {appConfig.tagline}
          </p>
        </div>
      </header>
      <div className="card">
        <h2>Foundation status</h2>
        <p className="muted">
          The app skeleton is live: navigation, install-to-phone, the action/audit system and the database design. Each
          area below is a placeholder that will be built out one at a time.
        </p>
        <p>
          Database: <span className={isSupabaseConfigured ? 'pill ok' : 'pill'}>{isSupabaseConfigured ? 'Connected' : 'Demo mode (not connected yet)'}</span>
        </p>
      </div>
      <div className="grid">
        {modules.map((m) => (
          <Link key={m.id} to={m.path} className="card tile">
            <Icon name={m.icon} width={28} height={28} />
            <strong>{m.label}</strong>
            <span className="muted">{m.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
