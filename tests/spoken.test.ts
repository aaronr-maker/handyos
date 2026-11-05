import { describe, expect, it } from 'vitest';
import { executeToolCall, type TurnDeps } from '../src/modules/handy/chat';
import { createMasker } from '../src/modules/handy/mask';
import { createSpokenConfirm, isNo, isYes, spokenCovers } from '../src/modules/handy/spoken';

describe('what counts as a spoken yes or no', () => {
  it('accepts short, clear yeses', () => {
    for (const t of ['Yes', 'yes.', 'Yeah', 'Yep, do it', "That's right", 'Yes please', 'Go ahead', 'Sounds good', 'Okay', 'Correct', 'Yes, save it', 'Absolutely']) expect(isYes(t), t).toBe(true);
  });

  it('does not accept anything with a no, a change, a question, or a long answer', () => {
    for (const t of ['No', 'Yes but change the phone number', 'Actually make it Thursday', 'Yeah wait', "Don't", 'What was that again', 'Yes and also text him', 'Maybe', 'Hmm', '', 'Yes yes yes yes yes yes yes', 'Is that right', 'Not yet, yes later']) expect(isYes(t), t).toBe(false);
  });

  it('recognizes a clear no, and not a yes as a no', () => {
    for (const t of ['No', 'Nope', 'Wait', "Don't do that", 'Cancel that', 'Stop']) expect(isNo(t), t).toBe(true);
    for (const t of ['Yes', 'Yeah, do it', 'Make it shorter', 'No wait yes']) expect(isNo(t), t).toBe(false);
  });
});

describe('checking that Handy read back what he is about to save', () => {
  it('needs every new value to appear in what he said, however a transcript writes it', () => {
    const args = { customer: 'Pat Miller', email: 'aaronr@thathandymanvan.com', phone: '512-555-0147', first_name: 'Pat' };
    expect(spokenCovers(args, "I'll change Pat's email to aaronr@thathandymanvan.com and the phone to 512-555-0147. Is that right?")).toBe(true);
    expect(spokenCovers(args, "I'll set Pat's email to aaronr at thathandymanvan dot com and the phone to five one two five five five zero one four seven. Is that right?")).toBe(false); // spelled-out digits are not matched: the card is the backup
    expect(spokenCovers(args, "I'll set Pat's email to aaronr at thathandymanvan dot com and the phone to 5125550147. Is that right?")).toBe(true);
    expect(spokenCovers(args, "I'll change Pat's email to aaronr@thathandymanvan.com. Is that right?")).toBe(false); // the phone was not read
    expect(spokenCovers({ email: 'a@b.com' }, "I'll change the email to someone@else.com")).toBe(false); // a different value than the one he will save
    expect(spokenCovers({ customer: 'Pat Miller' }, 'I will do something')).toBe(false); // he never said who it is for
  });

  it('checks a message word for word, and a person by first name', () => {
    const body = 'We are running about thirty minutes late and will be there by 2:30.';
    expect(spokenCovers({ customer: 'Pat Miller', channel: 'sms', body }, `Text to Pat: ${body} Should I send it?`)).toBe(true);
    expect(spokenCovers({ customer: 'Pat Miller', channel: 'sms', body }, `Here is the message: ${body} Should I send it?`)).toBe(false); // the words were read, but not who they are for
    expect(spokenCovers({ customer: 'Pat Miller', channel: 'sms', body }, 'Text to Pat: we are running a little late. Should I send it?')).toBe(false);
    expect(spokenCovers({ job_id: 'j1', person: 'Sam Lee' }, "I'll put Sam on the fence job. Is that right?")).toBe(true);
    expect(spokenCovers({ job_id: 'j1', person: 'Sam Lee' }, "I'll put Alex on the fence job. Is that right?")).toBe(false);
  });
});

describe('judging a tool request from the conversation', () => {
  /** A clock the test moves by hand, so waiting is instant. */
  function world() {
    let t = 1000;
    const sc = createSpokenConfirm(() => t, async (ms) => void (t += ms));
    return { sc, tick: (ms = 10) => void (t += ms) };
  }
  const args = { customer: 'Pat Miller', email: 'pat.new@example.com' };
  const readBack = "I'll change Pat's email to pat.new@example.com. Is that right?";

  it('accepts a yes that came after the read-back and covers what will be saved', async () => {
    const w = world();
    w.sc.handySaid(readBack);
    w.tick();
    w.sc.userSaid('Yes');
    expect(await w.sc.judge('update_customer', args)).toEqual({ kind: 'yes' });
  });

  it('turns a clear no into no, and anything else into feedback that nothing was saved for', async () => {
    const w = world();
    w.sc.handySaid(readBack);
    w.tick();
    w.sc.userSaid('No, wait');
    expect(await w.sc.judge('update_customer', args)).toEqual({ kind: 'no' });
    const x = world();
    x.sc.handySaid(readBack);
    x.tick();
    x.sc.userSaid('Make it the other email');
    expect(await x.sc.judge('update_customer', args)).toEqual({ kind: 'feedback', said: 'Make it the other email' });
  });

  it('falls back to the card when there was no answer, the yes was before the read-back, he read something else, or the kind of change needs a tap', async () => {
    const none = world();
    none.sc.handySaid(readBack);
    expect(await none.sc.judge('update_customer', args)).toEqual({ kind: 'unknown' }); // nobody answered in time
    const early = world();
    early.sc.userSaid('Yes');
    early.tick();
    early.sc.handySaid(readBack);
    expect(await early.sc.judge('update_customer', args)).toEqual({ kind: 'unknown' }); // an old yes does not count
    const other = world();
    other.sc.handySaid("I'll change Pat's email to someone@else.com. Is that right?");
    other.tick();
    other.sc.userSaid('Yes');
    expect(await other.sc.judge('update_customer', args)).toEqual({ kind: 'unknown' });
    const money = world();
    money.sc.handySaid(readBack);
    money.tick();
    money.sc.userSaid('Yes');
    expect(await money.sc.judge('delete_everything', args)).toEqual({ kind: 'unknown' });
  });

  it("counts the yes even when Handy says something short right after it (\"sending it now\") before asking the app to act", async () => {
    const w = world();
    w.sc.handySaid(readBack);
    w.tick();
    w.sc.userSaid('Yes, go ahead');
    w.tick();
    w.sc.handySaid('Sure, sending it now.'); // this must not replace the read-back
    expect(await w.sc.judge('update_customer', args)).toEqual({ kind: 'yes' });
  });

  it('still refuses a yes that was given before any read-back, or to a read-back that left out a value', async () => {
    const w = world();
    w.sc.handySaid('Hello, how can I help?');
    w.tick();
    w.sc.userSaid('Yes');
    expect(await w.sc.judge('update_customer', args)).toEqual({ kind: 'unknown' });
    const x = world();
    x.sc.handySaid("I'll change Pat's name. Is that right?"); // never read the new email
    x.tick();
    x.sc.userSaid('Yes');
    x.tick();
    x.sc.handySaid('Sending it now.');
    expect(await x.sc.judge('update_customer', args)).toEqual({ kind: 'unknown' });
  });

  it('uses a yes only once: a later change needs its own read-back and its own answer', async () => {
    const w = world();
    w.sc.handySaid(readBack);
    w.tick();
    w.sc.userSaid('Yes');
    expect((await w.sc.judge('update_customer', args)).kind).toBe('yes');
    w.tick();
    w.sc.handySaid('Done. The email is changed.'); // Handy speaks again
    expect((await w.sc.judge('update_customer', args)).kind).toBe('unknown');
  });
});

describe('what Handy is told when the answer was not a yes', () => {
  it('passes the spoken feedback back, saves nothing, and does not record it as an action done', async () => {
    let ran = 0;
    const deps: TurnDeps = {
      masker: createMasker([]),
      system: '',
      tools: [],
      callModel: async () => ({ role: 'assistant', content: null }),
      runRead: async () => ({}),
      isAction: () => true,
      confirm: async () => ({ feedback: 'make it the other email' }),
      runAction: async () => {
        ran++;
        return 'done';
      },
    };
    const r = await executeToolCall('update_customer', JSON.stringify({ customer: 'x' }), deps);
    expect(ran).toBe(0);
    expect(r.result).toContain('make it the other email');
    expect(r.result).toContain('Nothing was changed');
    expect(r.action).toBeUndefined();
  });
});
