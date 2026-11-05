import { useCallback, useEffect, useMemo, useState } from 'react';
import { addEdge, Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useUpdateNodeInternals, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { resultError, useAction } from '@/core';
import { portsOf, validateFlow, type Flow, type NodeData, type NodeKind } from '../../../../api/_lib/callEngine';
import { saveCallFlowAction } from '../actions';
import { TestCall } from './TestCall';

type BlockData = { kind: NodeKind; d: NodeData } & Record<string, unknown>;
type BlockNode = Node<BlockData, 'block'>;

export interface Person {
  id: string;
  name: string;
  phone: string;
}

const newId = (kind: NodeKind) => `${kind}-${crypto.randomUUID().slice(0, 6)}`;

const TITLE: Record<NodeKind, string> = { start: 'Call comes in', hours: 'Business hours?', say: 'Greeting', menu: 'Menu', ring: 'Ring people', voicemail: 'Voicemail', ai: 'AI receptionist', forward: 'Send to a number', hangup: 'Hang up' };
const ICON: Record<NodeKind, string> = { start: '📞', hours: '🕗', say: '💬', menu: '🔢', ring: '🔔', voicemail: '📼', ai: '🤖', forward: '↗️', hangup: '⛔' };
const ADDABLE: NodeKind[] = ['hours', 'say', 'menu', 'ring', 'voicemail', 'ai', 'forward', 'hangup'];

const summary = (k: NodeKind, d: NodeData, people: Person[]): string => {
  switch (k) {
    case 'say':
      return d.text ? `“${d.text.slice(0, 70)}${d.text.length > 70 ? '…' : ''}”` : 'Nothing to say yet';
    case 'menu':
      return d.prompt ? `“${d.prompt.slice(0, 50)}”` : 'Press a key to choose';
    case 'ring': {
      const names = (d.people ?? []).map((id) => people.find((p) => p.id === id)?.name ?? '?');
      return `${(d.mode ?? 'all') === 'all' ? 'All at once' : 'One after another'}: ${[...names, ...(d.numbers ?? [])].join(', ') || 'nobody yet'} (${d.seconds ?? 20}s)`;
    }
    case 'voicemail':
      return d.prompt ? `“${d.prompt.slice(0, 60)}…”` : 'Records a message';
    case 'forward':
      return d.number || 'No number yet';
    case 'hours':
      return 'Uses your Hours & people settings';
    case 'ai':
      return 'Talks to the caller, takes down details';
    default:
      return '';
  }
};

function Block({ id, data, selected }: NodeProps<BlockNode>) {
  const ports = portsOf({ kind: data.kind, data: data.d });
  const update = useUpdateNodeInternals();
  const key = ports.map((p) => p.id).join(',');
  useEffect(() => update(id), [id, key, update]);
  const people = (data.people as Person[] | undefined) ?? [];
  return (
    <div className={`pb pb-${data.kind} ${selected ? 'pb-selected' : ''}`}>
      {data.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="pb-title">
        <span>{ICON[data.kind]}</span> {data.d.label || TITLE[data.kind]}
      </div>
      {summary(data.kind, data.d, people) && <div className="pb-sum">{summary(data.kind, data.d, people)}</div>}
      {ports.map((p) => (
        <div key={p.id} className="pb-port">
          {p.label}
          <Handle type="source" id={p.id} position={Position.Right} style={{ right: -14, top: '50%' }} />
        </div>
      ))}
    </div>
  );
}
const nodeTypes = { block: Block };

const toRf = (flow: Flow, people: Person[]): { nodes: BlockNode[]; edges: Edge[] } => ({
  nodes: flow.nodes.map((n) => ({ id: n.id, type: 'block', position: { x: n.x, y: n.y }, deletable: n.kind !== 'start', data: { kind: n.kind, d: n.data, people } })),
  edges: flow.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.handle, target: e.target })),
});
const fromRf = (nodes: BlockNode[], edges: Edge[]): Flow => ({
  nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, x: Math.round(n.position.x), y: Math.round(n.position.y), data: n.data.d })),
  edges: edges.filter((e) => e.sourceHandle).map((e) => ({ id: e.id, source: e.source, handle: e.sourceHandle as string, target: e.target })),
});

const input = { width: '100%' } as const;

/** What can be changed on the selected block. */
function Editor({ node, people, onChange, onDelete }: { node: BlockNode; people: Person[]; onChange: (d: NodeData) => void; onDelete: () => void }) {
  const { kind, d } = node.data;
  const set = (patch: Partial<NodeData>) => onChange({ ...d, ...patch });
  return (
    <div className="card">
      <h3>
        {ICON[kind]} {TITLE[kind]}
      </h3>
      <label>
        Name on the canvas (optional)
        <input style={input} value={d.label ?? ''} onChange={(e) => set({ label: e.target.value })} />
      </label>
      {kind === 'say' && (
        <label>
          What the caller hears
          <textarea rows={3} style={input} value={d.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
        </label>
      )}
      {kind === 'menu' && (
        <>
          <label>
            What to say first (the choices are read out for you)
            <textarea rows={2} style={input} value={d.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} placeholder="How can we help you today?" />
          </label>
          <strong>Choices</strong>
          {(d.options ?? []).map((o, i) => (
            <div key={i} className="row" style={{ alignItems: 'center' }}>
              <select aria-label="Key" value={o.digit} onChange={(e) => set({ options: (d.options ?? []).map((x, j) => (j === i ? { ...x, digit: e.target.value } : x)) })} style={{ maxWidth: 70 }}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <input className="grow" aria-label="What it is for" placeholder="e.g. Aaron, scheduling" value={o.label} onChange={(e) => set({ options: (d.options ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <button type="button" className="link" onClick={() => set({ options: (d.options ?? []).filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const used = new Set((d.options ?? []).map((o) => o.digit));
              const next = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].find((k) => !used.has(k));
              if (next) set({ options: [...(d.options ?? []), { digit: next, label: '' }] });
            }}
          >
            + Add a choice
          </button>
        </>
      )}
      {kind === 'ring' && (
        <>
          <strong>Who to ring</strong>
          {people.length === 0 && <p className="muted small-note">No team members yet.</p>}
          {people.map((p) => (
            <label key={p.id} className="row" style={{ alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={(d.people ?? []).includes(p.id)} onChange={(e) => set({ people: e.target.checked ? [...(d.people ?? []), p.id] : (d.people ?? []).filter((x) => x !== p.id) })} />
              <span>
                {p.name} <span className="muted small-note">{p.phone || 'no phone number yet (add it under Hours & people)'}</span>
              </span>
            </label>
          ))}
          <label>
            Other numbers to ring (one per line)
            <textarea rows={2} style={input} value={(d.numbers ?? []).join('\n')} onChange={(e) => set({ numbers: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
          </label>
          <label>
            How to ring them
            <select value={d.mode ?? 'all'} onChange={(e) => set({ mode: e.target.value as 'all' | 'in_order' })}>
              <option value="all">Everyone at once</option>
              <option value="in_order">One after another, in this order</option>
            </select>
          </label>
          <label>
            Ring for how many seconds
            <input type="number" min={8} max={60} value={d.seconds ?? 20} onChange={(e) => set({ seconds: Number(e.target.value) || 20 })} />
          </label>
        </>
      )}
      {kind === 'voicemail' && (
        <label>
          What the caller hears before the beep
          <textarea rows={3} style={input} value={d.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} />
        </label>
      )}
      {kind === 'forward' && (
        <>
          <label>
            Number to send the call to
            <input style={input} value={d.number ?? ''} onChange={(e) => set({ number: e.target.value })} placeholder="+15125550000" />
          </label>
          <label>
            Ring for how many seconds
            <input type="number" min={8} max={60} value={d.seconds ?? 25} onChange={(e) => set({ seconds: Number(e.target.value) || 25 })} />
          </label>
        </>
      )}
      {kind === 'hours' && <p className="muted">Callers go down "Open" during your opening hours and "Closed" otherwise. Set the hours under <strong>Hours & people</strong>.</p>}
      {kind === 'ai' && <p className="muted">The AI receptionist is not connected yet, so for now callers go down "If the assistant is not available" (connect that to your voicemail).</p>}
      {kind !== 'start' && (
        <button type="button" className="link" onClick={onDelete}>
          Delete this block
        </button>
      )}
    </div>
  );
}

/** The drag-and-drop call tree: blocks to add, lines to draw between them, a side panel to change the selected block, and a test call. */
export function CallTree({ flow, saved, people, companyName }: { flow: Flow; saved: boolean; people: Person[]; companyName: string }) {
  return (
    <ReactFlowProvider>
      <Canvas flow={flow} saved={saved} people={people} companyName={companyName} />
    </ReactFlowProvider>
  );
}

function Canvas({ flow, saved, people, companyName }: { flow: Flow; saved: boolean; people: Person[]; companyName: string }) {
  const save = useAction(saveCallFlowAction);
  const initial = useMemo(() => toRf(flow, people), []); // eslint-disable-line react-hooks/exhaustive-deps -- loaded once
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!saved);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const current = useMemo(() => fromRf(nodes, edges), [nodes, edges]);
  const problems = useMemo(() => validateFlow(current), [current]);
  const errors = problems.filter((p) => p.level === 'error');
  const node = nodes.find((n) => n.id === selected) ?? null;

  const touch = () => {
    setDirty(true);
    setNote(null);
  };
  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, id: `e${Date.now()}` }, eds.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle))));
      setDirty(true);
    },
    [setEdges],
  );
  const change = (d: NodeData) => {
    if (!node) return;
    setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, d } } : n)));
    // a menu choice that was removed or renumbered loses its line
    const ports = new Set(portsOf({ kind: node.data.kind, data: d }).map((p) => p.id));
    setEdges((es) => es.filter((e) => e.source !== node.id || (e.sourceHandle && ports.has(e.sourceHandle))));
    touch();
  };
  const add = (kind: NodeKind) => {
    const id = newId(kind);
    const defaults: NodeData = kind === 'menu' ? { prompt: '', options: [{ digit: '1', label: '' }] } : kind === 'ring' ? { people: [], numbers: [], mode: 'all', seconds: 20 } : kind === 'voicemail' ? { prompt: 'Please leave a message after the beep and we will call you back.', notify: [] } : {};
    const offset = nodes.length * 14;
    setNodes((ns) => [...ns, { id, type: 'block', position: { x: 80 + offset, y: 80 + offset }, data: { kind, d: defaults, people } }]);
    setSelected(id);
    touch();
  };
  const remove = () => {
    if (!node || node.data.kind === 'start') return;
    setNodes((ns) => ns.filter((n) => n.id !== node.id));
    setEdges((es) => es.filter((e) => e.source !== node.id && e.target !== node.id));
    setSelected(null);
    touch();
  };
  const submit = async () => {
    if (errors.length) return setNote({ ok: false, text: 'Fix the problems listed first, then save.' });
    const err = resultError(await save(current));
    if (err) setNote({ ok: false, text: err });
    else {
      setDirty(false);
      setNote({ ok: true, text: 'Saved. The next call uses this tree.' });
    }
  };

  return (
    <>
      <div className="card">
        <p className="muted">
          Build the way a call should go. Add blocks, drag them where you like, and draw a line from each exit on the right of a block to the block that should come next.
          Click a block to change it.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {ADDABLE.map((k) => (
            <button key={k} type="button" className="secondary" onClick={() => add(k)}>
              {ICON[k]} {TITLE[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="call-canvas">
        <ReactFlow<BlockNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(c) => {
            onNodesChange(c);
            if (c.some((x) => x.type === 'position' || x.type === 'remove')) setDirty(true);
          }}
          onEdgesChange={(c) => {
            onEdgesChange(c);
            if (c.some((x) => x.type === 'remove')) setDirty(true);
          }}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ maxZoom: 0.9, padding: 0.12 }}
          onInit={(rf) => setTimeout(() => void rf.fitView({ maxZoom: 0.9, padding: 0.12 }), 150)}
          minZoom={0.3}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void submit()} disabled={!dirty && errors.length === 0}>
          Save and use this tree
        </button>
        {dirty ? <span className="muted">You have changes that are not saved.</span> : <span className="muted">Saved.</span>}
      </div>
      {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}

      {problems.length > 0 && (
        <div className="card">
          <h3>To fix or check</h3>
          {problems.map((p, i) => (
            <p key={i} className={p.level === 'error' ? 'err' : 'muted'} style={{ margin: '4px 0' }}>
              {p.level === 'error' ? '● ' : '○ '}
              {p.node ? (
                <button type="button" className="link" onClick={() => setSelected(p.node)}>
                  {p.text}
                </button>
              ) : (
                p.text
              )}
            </p>
          ))}
        </div>
      )}

      {node && <Editor node={node} people={people} onChange={change} onDelete={remove} />}
      <TestCall flow={current} people={people} companyName={companyName} disabled={errors.length > 0} />
    </>
  );
}
