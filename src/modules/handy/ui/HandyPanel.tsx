import { useEffect, useRef, useState } from 'react';
import { apiCall, Icon, listTeamMembers, onAssistantRequest, useRuntime, useSession } from '@/core';
import { MAX_STEPS, runTurn, SYSTEM_PROMPT, type StoredMessage, type WireMessage, type WireTool } from '../chat';
import { createMasker } from '../mask';
import { addMessage, createThread, knownEntities, listMessages, saveMaskMap, type HandyMessage, type HandyThread } from '../service';
import { setHandyOpen, useHandyOpen } from '../store';
import { describeAction, HANDY_TOOLS, isActionTool, runActionTool, runReadTool, type ToolContext } from '../tools';

interface Confirm {
  text: string;
  answer(yes: boolean): void;
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
  const endRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(text: string, current: HandyThread | null) => Promise<void>>(async () => undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [shown, busy, confirm]);

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
      const ctx: ToolContext = { companyId, team };
      const asHandy = (name: string, input: unknown) => actions.executeByName(name, input, { companyId, actor: { kind: 'agent', id: 'handy' }, onBehalfOf: { userId: user.id, role } });
      const result = await runTurn(history, said, {
        masker,
        system: SYSTEM_PROMPT(companyName, me?.full_name || me?.email || 'a team member'),
        tools: HANDY_TOOLS as WireTool[],
        callModel: async (messages: WireMessage[], tools: WireTool[]) => (await apiCall<{ message: WireMessage }>('/api/handy/chat', { messages, tools })).message,
        runRead: (name, args) => runReadTool(ctx, name, args),
        isAction: isActionTool,
        confirm: async (name, args) => {
          const text = await describeAction(ctx, name, args);
          return new Promise<boolean>((resolve) => setConfirm({ text, answer: (yes) => { setConfirm(null); resolve(yes); } }));
        },
        runAction: (name, args) =>
          runActionTool(ctx, async (action, body) => {
            const r = await asHandy(action, body);
            return { status: r.status, message: r.status === 'error' ? r.message : r.status === 'denied' ? r.reason : r.status === 'invalid' ? r.issues.join('; ') : undefined };
          }, name, args),
      });
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
                <div className="row">
                  <button type="button" onClick={() => confirm.answer(true)}>
                    Do it
                  </button>
                  <button type="button" className="secondary" onClick={() => confirm.answer(false)}>
                    Not now
                  </button>
                </div>
              </div>
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
