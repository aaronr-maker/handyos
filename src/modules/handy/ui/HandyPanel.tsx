import { useEffect, useRef, useState } from 'react';
import { apiCall, Icon, listTeamMembers, onAssistantRequest, useRuntime, useSession } from '@/core';
import { MAX_STEPS, runTurn, SYSTEM_PROMPT, type StoredMessage, type TurnDeps, type WireMessage, type WireTool } from '../chat';
import { createMasker, createSpokenMasker, type Masker } from '../mask';
import { connectVoice, createVoiceHandler, VOICE_RULES, voiceTools, type VoiceStatus } from '../voice';
import { addMessage, createThread, knownEntities, listMessages, recordUsage, saveMaskMap, type HandyMessage, type HandyThread } from '../service';
import { addUsage, noUsage, type Usage } from '../usage';
import { setHandyOpen, useHandyOpen } from '../store';
import { describeAction, HANDY_TOOLS, isActionTool, runActionTool, runReadTool, type ToolContext } from '../tools';

interface Confirm {
  text: string;
  /** For a message: the words, which the person can change before saying yes. */
  edit?: { key: string; label: string; value: string };
  answer(yes: boolean, edited?: string): void;
}

/** The floating Handy button and its chat panel. */
export function HandyOverlay() {
  const { companyId, companyName, user, role } = useSession();
  const { actions } = useRuntime();
  const open = useHandyOpen();
  const [thread, setThread] = useState<HandyThread | null>(null);
  const [shown, setShown] = useState<{ id: string; role: HandyMessage['role']; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editing, setEditing] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const typed = useRef<Usage>(noUsage());
  const callUsage = useRef<{ used: Usage; startedAt: number }>({ used: noUsage(), startedAt: 0 });
  const call = useRef<{ close(): void } | null>(null);
  const sendRef = useRef<(text: string, current: HandyThread | null) => Promise<void>>(async () => undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [shown, busy, confirm]);

  /** Looking things up and doing them, for the text chat and the voice call alike. */
  const toolDeps = (masker: Masker, team: Awaited<ReturnType<typeof listTeamMembers>>): Omit<TurnDeps, 'system' | 'tools' | 'callModel'> => {
    const ctx: ToolContext = { companyId, team };
    const asHandy = (name: string, input: unknown) => actions.executeByName(name, input, { companyId, actor: { kind: 'agent', id: 'handy' }, onBehalfOf: { userId: user.id, role } });
    return {
      masker,
      runRead: (name, args, refs) => runReadTool(ctx, name, args, refs),
      isAction: isActionTool,
      confirm: async (name, args, refs) => {
        const d = await describeAction(ctx, name, args, refs);
        setEditing(d.edit?.value ?? '');
        return new Promise((resolve) =>
          setConfirm({
            text: d.text,
            edit: d.edit,
            answer: (yes, edited) => {
              setConfirm(null);
              if (!yes) return resolve(false);
              // the person may have rewritten the message before approving it
              resolve(d.edit && edited !== undefined && edited !== d.edit.value ? { overrides: { [d.edit.key]: edited } } : true);
            },
          }),
        );
      },
      runAction: (name, args, refs) => {
        const outcome = (r: Awaited<ReturnType<typeof asHandy>>) => ({ status: r.status, message: r.status === 'error' ? r.message : r.status === 'denied' ? r.reason : r.status === 'invalid' ? r.issues.join('; ') : undefined });
        // customer-facing words are saved by the person who approved them, not by Handy
        const asPerson = async (action: string, input: unknown) => outcome(await actions.executeByName(action, input, { companyId, actor: user, role }));
        return runActionTool(ctx, async (action, body) => outcome(await asHandy(action, body)), name, args, { refs, asPerson });
      },
    };
  };

  const hangUp = () => {
    const had = call.current;
    call.current?.close();
    call.current = null;
    setVoice(null);
    if (had) {
      // what the call used is written down, so the cost can be seen
      const { used, startedAt } = callUsage.current;
      void recordUsage(companyId, user.id, 'voice', { ...used, seconds: Math.round((Date.now() - startedAt) / 1000) }).catch(() => undefined);
    }
  };
  useEffect(() => () => call.current?.close(), []);

  /** A live voice call with Handy. The words are written down in the conversation like the typed ones. */
  const startVoice = async () => {
    if (voice) return hangUp();
    setError(null);
    setVoice('connecting');
    try {
      const [team, known] = await Promise.all([listTeamMembers(), knownEntities(companyId)]);
      const me = team.find((m) => m.id === user.id);
      const t = thread ?? (await createThread(companyId, user.id, 'Voice chat'));
      setThread(t);
      const masker = createSpokenMasker(known, t.mask_map);
      const save = async (role: HandyMessage['role'], content: string) => {
        const row = await addMessage(companyId, t.id, user.id, role, content);
        setShown((cur) => [...cur, { id: row.id, role, content }]);
      };
      const instructions = `${SYSTEM_PROMPT(companyName, me?.full_name || me?.email || 'a team member')}\n${VOICE_RULES}`;
      const pass = await apiCall<{ secret: string; model: string }>('/api/handy/voice', { instructions, tools: voiceTools(HANDY_TOOLS) });
      callUsage.current = { used: noUsage(), startedAt: Date.now() };
      let send: (e: unknown) => void = () => undefined;
      const handle = createVoiceHandler({
        turn: { ...toolDeps(masker, team), system: '', tools: [], callModel: async () => ({ role: 'assistant', content: null }) },
        send: (e) => send(e),
        onUser: (text) => void save('user', text),
        onHandy: (text) => void save('assistant', text),
        onAction: (line) => void save('action', line),
        onStatus: (s) => setVoice(s),
        onUsage: (u) => {
          callUsage.current.used = addUsage(callUsage.current.used, u);
        },
        onError: (m) => setError(m),
      });
      const conn = await connectVoice({ secret: pass.secret, model: pass.model, onEvent: (e) => void handle(e), onClosed: hangUp });
      send = conn.send;
      call.current = conn;
      setVoice('listening');
      // a call is billed by the minute, so one that is left open ends by itself
      window.setTimeout(() => call.current === conn && hangUp(), 10 * 60_000);
    } catch (err) {
      call.current?.close();
      call.current = null;
      setVoice(null);
      setError(err instanceof Error ? (err.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it for this site in your phone or browser settings.' : err.message) : 'Could not start the call.');
    }
  };

  const send = async (text: string, current: HandyThread | null) => {
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    try {
      const [team, known] = await Promise.all([listTeamMembers(), knownEntities(companyId)]);
      const me = team.find((m) => m.id === user.id);
      let t = current ?? (await createThread(companyId, user.id, said));
      if (!current) setThread(t);
      const history: StoredMessage[] = (await listMessages(companyId, t.id)).map((m) => ({ role: m.role, content: m.content }));
      const mine = await addMessage(companyId, t.id, user.id, 'user', said);
      setShown((cur) => [...cur, { id: mine.id, role: 'user', content: said }]);

      const masker = createMasker(known, t.mask_map);
      const result = await runTurn(history, said, {
        ...toolDeps(masker, team),
        system: SYSTEM_PROMPT(companyName, me?.full_name || me?.email || 'a team member'),
        tools: HANDY_TOOLS as WireTool[],
        callModel: async (messages: WireMessage[], tools: WireTool[]) => {
          const r = await apiCall<{ message: WireMessage; usage?: { input: number; output: number } }>('/api/handy/chat', { messages, tools });
          typed.current = addUsage(typed.current, { text_in: r.usage?.input ?? 0, text_out: r.usage?.output ?? 0 });
          return r.message;
        },
      });
      if (typed.current.text_in + typed.current.text_out > 0) void recordUsage(companyId, user.id, 'text', typed.current).catch(() => undefined);
      typed.current = noUsage();
      for (const a of result.actions) {
        const row = await addMessage(companyId, t.id, user.id, 'action', a);
        setShown((cur) => [...cur, { id: row.id, role: 'action', content: a }]);
      }
      const reply = await addMessage(companyId, t.id, user.id, 'assistant', result.reply);
      setShown((cur) => [...cur, { id: reply.id, role: 'assistant', content: result.reply }]);
      t = await saveMaskMap(companyId, t.id, masker.map());
      setThread(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong talking to Handy.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    sendRef.current = send;
  });
  // opened from a to-do item (or anywhere else) about something: start a fresh chat and ask
  useEffect(
    () =>
      onAssistantRequest((request) => {
        setHandyOpen(true);
        setThread(null);
        setShown([]);
        setError(null);
        if (request.prompt) void sendRef.current(request.prompt, null);
      }),
    [],
  );

  const fresh = () => {
    setThread(null);
    setShown([]);
    setError(null);
  };

  return (
    <>
      {!open && (
        <button type="button" className="handy-fab" onClick={() => setHandyOpen(true)} aria-label="Ask Handy">
          <Icon name="handy" />
          <span>Handy</span>
        </button>
      )}
      {open && (
        <section className="handy-panel" aria-label="Handy">
          <header>
            <strong>Handy</strong>
            <span className="muted small-note">{thread?.title ?? 'New chat'}</span>
            <button type="button" className="link" onClick={fresh}>
              New chat
            </button>
            <button type="button" className="link" onClick={() => setHandyOpen(false)} aria-label="Close Handy">
              ✕
            </button>
          </header>
          <div className="handy-messages">
            {shown.length === 0 && (
              <p className="muted">
                Hi, I'm Handy. Ask me about the schedule, who's heading into overtime, or jobs nobody has yet. I'll tell you what I'm going to change and wait for your OK.
              </p>
            )}
            {shown.map((m) => (
              <p key={m.id} className={`handy-msg ${m.role}`}>
                {m.role === 'action' ? `✓ ${m.content}` : m.content}
              </p>
            ))}
            {confirm && (
              <div className="handy-confirm">
                <p>
                  <strong>Handy wants to:</strong> {confirm.text}
                </p>
                {confirm.edit && (
                  <label>
                    {confirm.edit.label} (you can change it)
                    <textarea rows={4} value={editing} onChange={(e) => setEditing(e.target.value)} style={{ width: '100%' }} />
                  </label>
                )}
                <div className="row">
                  <button type="button" onClick={() => confirm.answer(true, confirm.edit ? editing : undefined)}>
                    {confirm.edit ? 'Save it' : 'Do it'}
                  </button>
                  <button type="button" className="secondary" onClick={() => confirm.answer(false)}>
                    Not now
                  </button>
                </div>
              </div>
            )}
            {voice && (
              <p className="notice">
                {voice === 'connecting' ? 'Connecting…' : voice === 'speaking' ? '● Handy is talking…' : voice === 'thinking' ? '● Handy is thinking…' : '● Listening. Just talk.'} Your spoken words go to OpenAI as audio, so names you say are not masked. The call ends by itself after 10 minutes.
              </p>
            )}
            {busy && !confirm && <p className="muted">Handy is thinking…</p>}
            {error && <p className="err">{error}</p>}
            <div ref={endRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input, thread);
            }}
          >
            <button type="button" className={voice ? '' : 'secondary'} onClick={() => void startVoice()} aria-label={voice ? 'End the voice call' : 'Talk to Handy'} title={voice ? 'End the call' : 'Talk to Handy'}>
              {voice ? 'End' : <Icon name="mic" />}
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Handy…" aria-label="Message Handy" disabled={busy} />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
          <p className="muted small-note handy-foot">Handy can make mistakes. Customer names, addresses, phones and emails are swapped for IDs before anything leaves the app.</p>
        </section>
      )}
    </>
  );
}

export const MAX_HANDY_STEPS = MAX_STEPS;
