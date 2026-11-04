import { askAssistant, resultError, useAsync, useSession } from '@/core';
import { deleteThread, listThreads } from '../service';

/** Past conversations with Handy. */
export default function HandyScreen() {
  const { companyId, user, role } = useSession();
  const { data, loading, error, reload } = useAsync(() => listThreads(companyId), [companyId]);
  const mine = (data ?? []).filter((t) => t.user_id === user.id);
  const others = role === 'owner' || role === 'admin' ? (data ?? []).filter((t) => t.user_id !== user.id) : [];
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Handy</h1>
          <p className="muted">Your office assistant. Use the Handy button at the bottom of any screen, or start here.</p>
        </div>
        <button type="button" onClick={() => askAssistant({ title: 'New chat', prompt: '' })}>
          Open Handy
        </button>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      <div className="card list">
        <h2>Your conversations</h2>
        {mine.length === 0 && <p className="muted">No conversations yet.</p>}
        {mine.map((t) => (
          <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              {t.title} <span className="muted small-note">{new Date(t.updated_at).toLocaleDateString()}</span>
            </span>
            <button
              type="button"
              className="link"
              onClick={async () => {
                if (!window.confirm('Delete this conversation?')) return;
                try {
                  await deleteThread(companyId, t.id);
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : resultError({ status: 'error', message: 'Could not delete', auditId: '' }));
                }
                reload();
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <div className="card list">
          <h2>Everyone else's (owners and admins can see these)</h2>
          {others.map((t) => (
            <p key={t.id}>
              {t.title} <span className="muted small-note">{new Date(t.updated_at).toLocaleDateString()}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
