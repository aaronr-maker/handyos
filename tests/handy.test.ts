import { describe, expect, it } from 'vitest';
import { runTurn, type TurnDeps, type WireMessage } from '../src/modules/handy/chat';
import { createMasker } from '../src/modules/handy/mask';
import { findPerson } from '../src/modules/handy/tools';

const team = [
  { id: 'u1', full_name: 'Alex Rivera', email: 'a@x.com', role: 'tech' },
  { id: 'u2', full_name: 'Sam Lee', email: 's@x.com', role: 'tech' },
  { id: 'u3', full_name: 'Sam Ortiz', email: 'so@x.com', role: 'office' },
];

describe('finding a team member by what was said', () => {
  it('matches a full name, a unique first name, and says when it is unclear or unknown', () => {
    expect(findPerson(team, 'alex').id).toBe('u1');
    expect(findPerson(team, 'Sam Lee').id).toBe('u2');
    expect(() => findPerson(team, 'sam')).toThrow(/More than one/);
    expect(() => findPerson(team, 'pat')).toThrow(/No team member/);
    expect(() => findPerson(team, '')).toThrow(/Which team member/);
  });
});

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });

function harness(replies: WireMessage[], over: Partial<TurnDeps> = {}) {
  const sent: WireMessage[][] = [];
  const ran: string[] = [];
  const deps: TurnDeps = {
    masker: createMasker([{ kind: 'customer', id: '4f2a1c3e-1234-4567-8901-abcdef012345', label: 'Pat Miller', aliases: ['Pat Miller'] }]),
    system: 'You are Handy.',
    tools: [],
    callModel: async (messages) => {
      sent.push(structuredClone(messages));
      const next = replies.shift();
      if (!next) throw new Error('no more replies');
      return next;
    },
    runRead: async (name) => {
      ran.push(`read:${name}`);
      return { job: 'Fix gate for Pat Miller', phone_on_file: '(512) 555-0147' };
    },
    isAction: (n) => n === 'assign_job',
    confirm: async () => true,
    runAction: async (name, args) => {
      ran.push(`do:${name}:${JSON.stringify(args)}`);
      return 'Moved the job to Sam.';
    },
    ...over,
  };
  return { deps, sent, ran };
}

describe('a conversation with Handy', () => {
  it('masks everything that goes out, looks things up, and puts real names back in what Handy says', async () => {
    const h = harness([{ role: 'assistant', content: null, tool_calls: [call('1', 'upcoming_jobs', {})] }, { role: 'assistant', content: 'C-4F2A1C3E has a gate job on Thursday.' }]);
    const r = await runTurn([{ role: 'user', content: 'earlier question about Pat Miller' }, { role: 'assistant', content: 'earlier answer' }], 'What is the job for Pat Miller?', h.deps);
    expect(r.reply).toBe('Pat Miller has a gate job on Thursday.');
    const everything = JSON.stringify(h.sent);
    expect(everything).not.toContain('Pat Miller');
    expect(everything).not.toContain('555-0147'); // masked even though the look-up returned it
    expect(everything).toContain('C-4F2A1C3E');
    expect(h.sent[0].map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(h.ran).toEqual(['read:upcoming_jobs']);
  });

  it('asks before changing anything, does it only on a yes, and tells Handy when the answer was no', async () => {
    const act = [call('1', 'assign_job', { job_id: 'j1', person: 'Sam Lee' })];
    const yes = harness([{ role: 'assistant', content: null, tool_calls: act }, { role: 'assistant', content: 'Done.' }]);
    const a = await runTurn([], 'Move it to Sam', yes.deps);
    expect(yes.ran).toEqual(['do:assign_job:{"job_id":"j1","person":"Sam Lee"}']);
    expect(a.actions).toEqual(['Moved the job to Sam.']);

    const no = harness([{ role: 'assistant', content: null, tool_calls: act }, { role: 'assistant', content: 'Okay, leaving it.' }], { confirm: async () => false });
    const b = await runTurn([], 'Move it to Sam', no.deps);
    expect(no.ran).toEqual([]); // nothing ran
    expect(b.actions).toEqual(['Declined: assign_job']);
    expect(JSON.stringify(no.sent[1])).toContain('Nothing was changed');
  });

  it('puts the real name back into what Handy asks to do, and reports a failed tool without stopping', async () => {
    const h = harness([{ role: 'assistant', content: null, tool_calls: [call('1', 'week_hours', { person: 'C-4F2A1C3E' })] }, { role: 'assistant', content: 'I could not find that.' }], {
      runRead: async (_n, args) => {
        throw new Error(`No team member matches "${String(args.person)}".`);
      },
    });
    const r = await runTurn([], 'hours for Pat Miller', h.deps);
    expect(r.reply).toBe('I could not find that.');
    expect(JSON.stringify(h.sent[1])).toContain('That did not work');
  });

  it('stops after a few steps if Handy keeps asking for more', async () => {
    const loop = Array.from({ length: 10 }, () => ({ role: 'assistant' as const, content: null, tool_calls: [call('x', 'team', {})] }));
    const h = harness(loop);
    const r = await runTurn([], 'hi', h.deps);
    expect(r.reply).toMatch(/circles/);
    expect(h.sent).toHaveLength(6);
  });
});
