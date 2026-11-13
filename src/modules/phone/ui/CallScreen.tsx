import { useEffect, useState } from 'react';
import { useSession } from '@/core';
import { listCalls, listTranscript } from '../service';
import type { CallLogRow, TranscriptLine } from '../types';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The screen to keep open while taking calls: the prompt of what to ask on one side, and on the other what is being said right
 * now (it updates by itself), with the AI's summary once the call ends. Pick an earlier call to read it back.
 */
export function CallScreen({ script }: { script: string }) {
  const { companyId } = useSession();
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [problem, setProblem] = useState<string | null>(null);

  const sid = picked ?? calls[0]?.call_sid ?? null;
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const recent = await listCalls(companyId);
        const open = picked ?? recent[0]?.call_sid ?? null;
        const said = open ? await listTranscript(companyId, open) : [];
        if (!live) return;
        setCalls(recent.slice(0, 15));
        setLines(said);
        setNow(Date.now());
        setProblem(null);
      } catch (e) {
        if (live) setProblem(e instanceof Error ? e.message : 'Could not load calls.');
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [companyId, picked]);

  const call = calls.find((c) => c.call_sid === sid) ?? null;
  const last = lines.length ? Date.parse(lines[lines.length - 1].created_at) : 0;
  const talking = !!call && !call.summary && now - last < 20_000 && lines.length > 0;
  const points = script
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="call-screen">
      {problem && <p className="err">{problem}</p>}
      <div className="card">
        <h2>Ask every caller</h2>
        <ul className="call-script">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <p className="muted small-note">Change this under Number, hours &amp; people.</p>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <h2>{call ? `${call.from_number ?? 'Unknown caller'} · ${when(call.created_at)}` : 'No calls yet'}</h2>
          {talking && <span className="pill ok">● Live</span>}
        </div>
        {call?.summary && (
          <div className="call-summary">
            <strong>AI summary</strong>
            <pre>{call.summary}</pre>
          </div>
        )}
        {call && lines.length === 0 && <p className="muted">Nothing typed out yet. Words appear here a few seconds after people speak, once the call connects.</p>}
        <div className="call-lines" aria-live="polite">
          {lines.map((l) => (
            <p key={l.id} className={l.speaker === 'caller' ? 'caller' : 'team'}>
              <strong>{l.speaker === 'caller' ? 'Customer' : l.speaker === 'assistant' ? 'Assistant' : 'Us'}:</strong> {l.body}
            </p>
          ))}
        </div>
        {calls.length > 1 && (
          <label>
            Read an earlier call
            <select value={picked ?? ''} onChange={(e) => setPicked(e.target.value || null)}>
              <option value="">Latest call</option>
              {calls.map((c) => (
                <option key={c.id} value={c.call_sid}>
                  {when(c.created_at)} · {c.from_number ?? 'Unknown'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
