import { useState, useSyncExternalStore } from 'react';
import { useSession, type ActionResult, type Actor } from '@/core';
import { runtime } from '../runtime';

function useAuditEntries() {
  return useSyncExternalStore(runtime.audit.subscribe, runtime.audit.entries);
}

function usePending(companyId: string) {
  const [, force] = useState(0);
  useSyncExternalStore(
    (cb) => runtime.actions.onApprovalsChanged(() => (force((n) => n + 1), cb())),
    () => runtime.actions.pendingApprovals(companyId).length,
  );
  return runtime.actions.pendingApprovals(companyId);
}

/**
 * Developer/owner view of the action registry. Anything you can run here is exactly what the UI
 * and (later) AI agents call: validated, audit-logged, and approval-gated for risky actions.
 */
export function SystemScreen() {
  const session = useSession();
  const actions = runtime.actions.list();
  const audit = useAuditEntries();
  const pending = usePending(session.companyId);
  const [name, setName] = useState(actions[0]?.name ?? '');
  const selected = actions.find((a) => a.name === name);
  const [json, setJson] = useState(JSON.stringify(selected?.example ?? {}, null, 2));
  const [result, setResult] = useState<ActionResult | null>(null);

  const pick = (n: string) => {
    setName(n);
    setJson(JSON.stringify(runtime.actions.get(n)?.example ?? {}, null, 2));
    setResult(null);
  };

  const run = async (actor: Actor) => {
    let input: unknown;
    try {
      input = JSON.parse(json);
    } catch {
      setResult({ status: 'invalid', issues: ['Input is not valid JSON'], auditId: '' });
      return;
    }
    setResult(await runtime.actions.executeByName(name, input, { companyId: session.companyId, actor, role: actor.kind === 'user' ? session.role : undefined }));
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>System</h1>
          <p className="muted">Every business action, run the same way for people and AI agents.</p>
        </div>
      </header>

      <div className="card">
        <h2>Try an action</h2>
        <label>
          Action
          <select value={name} onChange={(e) => pick(e.target.value)}>
            {actions.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} {a.risk === 'high' ? '· high risk' : ''}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="muted">
            {selected.description}{' '}
            <span className={`pill ${selected.risk}`}>{selected.risk} risk</span>
            {selected.requiresApproval !== false && <span className="pill"> approval needed</span>}
          </p>
        )}
        <label>
          Input (JSON)
          <textarea rows={7} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
        </label>
        <div className="row">
          <button onClick={() => run(session.user)}>Run as me</button>
          <button className="secondary" onClick={() => run({ kind: 'agent', id: 'demo-agent' })}>
            Run as AI agent
          </button>
        </div>
        {result && <pre className="result">{JSON.stringify(result, null, 2)}</pre>}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <h2>Waiting for approval ({pending.length})</h2>
          {pending.map((p) => (
            <div key={p.id} className="approval">
              <div>
                <strong>{p.action}</strong>
                <span className="muted"> requested by {p.requested_by.kind}</span>
              </div>
              <div className="row">
                <button onClick={async () => setResult(await runtime.actions.decide(p.id, true, session.user, session.role))}>Approve</button>
                <button className="secondary" onClick={async () => setResult(await runtime.actions.decide(p.id, false, session.user, session.role))}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Audit log</h2>
        {audit.length === 0 ? (
          <p className="muted">Nothing yet. Run an action above.</p>
        ) : (
          <ul className="audit">
            {audit.slice(0, 30).map((e) => (
              <li key={e.id}>
                <span className={`pill ${e.outcome}`}>{e.outcome}</span> <strong>{e.action}</strong>
                <span className="muted">
                  {' '}
                  by {e.actor_kind} · {new Date(e.created_at).toLocaleTimeString()}
                </span>
                {e.error && <div className="err">{e.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
