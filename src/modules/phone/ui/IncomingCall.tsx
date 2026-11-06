import { useEffect, useState } from 'react';
import { apiCall, useSession } from '@/core';
import { handyCall, isPhoneApp, type CallState } from '../native';
import { getSettings, listTranscript } from '../service';
import type { TranscriptLine } from '../types';

const REFRESH_MS = 50 * 60 * 1000; // the calling pass lasts an hour

/**
 * Inside the installed Android app: signs the phone up for calls, and when one comes in shows a full-screen answer/decline
 * screen, then (once answered) the prompt and the words as they are typed. In a browser it shows nothing.
 */
export function IncomingCall() {
  if (!isPhoneApp()) return null;
  return <PhoneCalls />;
}

function PhoneCalls() {
  const { companyId } = useSession();
  const [call, setCall] = useState<CallState>({ state: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const [script, setScript] = useState('');
  const [lines, setLines] = useState<TranscriptLine[]>([]);

  // sign this phone up for calls (and again before the pass runs out)
  useEffect(() => {
    let live = true;
    const signUp = async () => {
      try {
        await handyCall.requestPermissions();
        const { token } = await apiCall<{ token: string }>('/api/voice/token');
        await handyCall.register({ token });
        if (live) setProblem(null);
      } catch (e) {
        if (live) setProblem(e instanceof Error ? e.message : 'Could not set this phone up for calls.');
      }
    };
    void signUp();
    const timer = setInterval(() => void signUp(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    void handyCall.getState().then(setCall);
    void handyCall.addListener('state', setCall).then((h) => (handle = h));
    // only some roles may read the prompt; the answer screen works without it
    void getSettings(companyId)
      .then((s) => setScript(s.script))
      .catch(() => undefined);
    return () => void handle?.remove();
  }, [companyId]);

  // while on a call, show what is being said
  const parent = call.parent;
  useEffect(() => {
    if (call.state !== 'connected' || !parent) return;
    let live = true;
    const tick = async () => {
      const said = await listTranscript(companyId, parent).catch(() => []);
      if (live) setLines(said);
    };
    void tick();
    const timer = setInterval(() => void tick(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [call.state, parent, companyId]);

  if (call.state === 'idle')
    return problem ? (
      <p className="err" style={{ position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 20, background: '#fff', padding: 8, borderRadius: 8 }}>
        {problem}
      </p>
    ) : null;

  const points = script
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="phone-call" role="dialog" aria-label="Phone call">
      <h1>{call.state === 'ringing' ? 'Incoming call' : 'On the call'}</h1>
      <p className="phone-from">{call.from || 'Unknown caller'}</p>
      {points.length > 0 && (
        <ul className="call-script">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {call.state === 'connected' && (
        <div className="call-lines" aria-live="polite">
          {lines.map((l) => (
            <p key={l.id} className={l.speaker === 'caller' ? 'caller' : 'team'}>
              <strong>{l.speaker === 'caller' ? 'Customer' : 'Us'}:</strong> {l.body}
            </p>
          ))}
        </div>
      )}
      <div className="row phone-buttons">
        {call.state === 'ringing' ? (
          <>
            <button className="danger-button" onClick={() => void handyCall.decline()}>
              Decline
            </button>
            <button onClick={() => void handyCall.answer()}>Answer</button>
          </>
        ) : (
          <>
            <button className="secondary" onClick={() => void handyCall.mute({ muted: !call.muted })}>
              {call.muted ? 'Unmute' : 'Mute'}
            </button>
            <button className="danger-button" onClick={() => void handyCall.hangUp()}>
              Hang up
            </button>
          </>
        )}
      </div>
    </div>
  );
}
