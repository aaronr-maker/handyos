import { Link } from 'react-router-dom';
import { Icon, isSupabaseConfigured, listTeamMembers, useAsync, useSession } from '@/core';
import { modules } from '../modules';

const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

export function HomeScreen() {
  const { companyName, role, user } = useSession();
  const { data: team } = useAsync(() => listTeamMembers(), []);
  const me = team?.find((m) => m.id === user.id);
  const first = (me?.full_name || '').trim().split(' ')[0];
  const mine = modules.filter((m) => !m.hiddenFromRoles?.includes(role));
  return (
    <section className="page">
      <header className="hero">
        <h1>
          {greeting(new Date().getHours())}
          {first ? `, ${first}` : ''}!
        </h1>
        <p className="muted">Here's your day at {companyName}. Pick up where you left off.</p>
      </header>
      {!isSupabaseConfigured && <p className="notice">You're looking at demo mode, so nothing here is saved yet.</p>}
      <div className="grid">
        {mine.map((m) => (
          <Link key={m.id} to={m.path} className="card tile">
            <span className="tile-icon">
              <Icon name={m.icon} width={26} height={26} />
            </span>
            <strong>{m.label}</strong>
            <span className="muted">{m.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
