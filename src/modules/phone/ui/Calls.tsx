import { useState } from 'react';
import { apiBlob, listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { listAiRequests, listCalls, listVoicemails } from '../service';
import { markVoicemailHeardAction, setAiRequestStatusAction } from '../actions';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Recent calls and voicemails. A voicemail plays through the server, which holds the Twilio login. */
export function Calls() {
  const { companyId } = useSession();
  const heard = useAction(markVoicemailHeardAction);
  const setStatus = useAction(setAiRequestStatusAction);
  const { data, loading, error, reload } = useAsync(
    async () => ({ calls: await listCalls(companyId), mail: await listVoicemails(companyId), requests: await listAiRequests(companyId), team: await listTeamMembers() }),
    [companyId],
  );
  const [audio, setAudio] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load calls.'}</p>;

  const play = async (id: string, isNew: boolean) => {
    setProblem(null);
    try {
      const blob = await apiBlob(`/api/voice/audio?id=${encodeURIComponent(id)}`);
      setAudio((a) => ({ ...a, [id]: URL.createObjectURL(blob) }));
      if (isNew) {
        const err = resultError(await heard({ voicemail_id: id }));
        if (err) setProblem(err);
        else reload();
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not play that voicemail.');
    }
  };

  return (
    <div>
      {problem && <p className="err">{problem}</p>}
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>From the AI receptionist</h2>
        {data.requests.filter((r) => r.status === 'new').length === 0 && <p className="muted">Nothing new. Estimates it books and callbacks it promises appear here.</p>}
        {data.requests.map((r) => (
          <div key={r.id} className={r.status === 'new' ? 'ai-request' : 'ai-request faded'}>
            <div>
              <strong>{r.kind === 'estimate' ? 'In-home estimate booked' : 'Call back'}</strong> {r.status !== 'new' && <span className="pill">{r.status}</span>}
              {r.language && r.language.toLowerCase() !== 'english' && <span className="pill medium">{r.language}</span>}
              <div>
                {[r.caller_name, r.caller_phone].filter(Boolean).join(' · ') || 'Unknown caller'}
                {r.address ? ` · ${r.address}` : ''}
              </div>
              {r.kind === 'estimate' && r.starts_at && (
                <div>
                  {new Date(r.starts_at).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} with{' '}
                  {data.team.find((m) => m.id === r.seller_id)?.full_name || 'an estimator'}
                </div>
              )}
              {r.notes && <div className="muted">{r.notes}</div>}
              <div className="muted small-note">{when(r.created_at)}</div>
            </div>
            {r.status === 'new' && (
              <div className="row">
                {(['done', 'cancelled'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      const err = resultError(await setStatus({ request_id: r.id, status }));
                      if (err) setProblem(err);
                      else reload();
                    }}
                  >
                    {status === 'done' ? 'Done' : 'Cancel'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Voicemails</h2>
        {data.mail.length === 0 && <p className="muted">No voicemails yet.</p>}
        {data.mail.map((v) => (
          <div key={v.id} style={{ margin: '8px 0' }}>
            <strong>{v.from_number ?? 'Unknown caller'}</strong> · {when(v.created_at)} · {v.duration_seconds}s {v.status === 'new' && <span className="pill medium">New</span>}
            <div>
              {audio[v.id] ? (
                <audio controls autoPlay src={audio[v.id]} />
              ) : (
                <button type="button" className="secondary" onClick={() => play(v.id, v.status === 'new')}>
                  ▶ Listen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Recent calls</h2>
        {data.calls.length === 0 && <p className="muted">No calls yet.</p>}
        {data.calls.map((c) => (
          <p key={c.id} style={{ margin: '6px 0' }}>
            {when(c.created_at)} · {c.from_number ?? 'Unknown'} · <span className="pill">{c.outcome}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
