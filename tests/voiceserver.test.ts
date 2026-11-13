import { describe, expect, it } from 'vitest';
import { streamToken as appToken } from '../api/_lib/streamToken';
import { speakerOf, streamToken, summaryRequest, transcriptText, validStreamToken } from '../voice-server/src/logic';

describe('voice server logic', () => {
  it('makes the same token as the main app, and rejects others', () => {
    expect(streamToken('s', 'CA1', 'co1')).toBe(appToken('s', 'CA1', 'co1'));
    expect(validStreamToken('s', 'CA1', 'co1', appToken('s', 'CA1', 'co1'))).toBe(true);
    expect(validStreamToken('s', 'CA1', 'co2', appToken('s', 'CA1', 'co1'))).toBe(false);
    expect(validStreamToken('s', 'CA1', 'co1', '')).toBe(false);
  });
  it('labels the sides of the call', () => {
    expect(speakerOf('inbound')).toBe('caller');
    expect(speakerOf('outbound')).toBe('team');
  });
  it('builds the summary request in order, and skips calls with nothing said', () => {
    const lines = [
      { speaker: 'team' as const, body: 'How can I help?', at: 2 },
      { speaker: 'caller' as const, body: 'My gate is broken.', at: 1 },
    ];
    expect(transcriptText(lines)).toBe('Customer: My gate is broken.\nTeam: How can I help?');
    expect(summaryRequest(lines)?.user).toContain('Customer: My gate is broken.');
    expect(summaryRequest([lines[0]])).toBeNull();
    expect(transcriptText([{ speaker: 'caller', body: 'x'.repeat(50), at: 1 }], 10)).toHaveLength(10);
  });
});

import { ASSISTANT_TOOLS, ASSISTANT_VOICE, assistantInstructions, toolAnswer } from '../voice-server/src/logic';

describe("the AI receptionist's instructions and tools", () => {
  const text = assistantInstructions('That Handyman Van', '+14175550100');
  it('carries the firm rules: no prices, no promises beyond the offered times, emergencies, any language, and the booking steps', () => {
    expect(text).toMatch(/Never give, guess or discuss prices/);
    expect(text).toMatch(/in-home estimates are free/);
    expect(text).toMatch(/materials, service minimums or trip charges/);
    expect(text).toMatch(/Never promise a time that find_times did not give you/);
    expect(text).toMatch(/911/);
    expect(text).toMatch(/Answer in whatever language the caller speaks/);
    expect(text).toMatch(/language barrier/);
    expect(text).toMatch(/Yeah, no problem\. We can have a technician call you and set up a time outside our normal estimate times to get you taken care of\./);
    expect(text).toContain('+14175550100');
    expect(text).toMatch(/woman's voice/);
  });
  it("offers only the four things the assistant may do, with the booking details required, and a woman's voice", () => {
    expect(ASSISTANT_TOOLS.map((t) => t.name)).toEqual(['find_times', 'book_estimate', 'request_callback', 'end_call']);
    expect(ASSISTANT_TOOLS[1].parameters.required).toEqual(['seller_id', 'start', 'name', 'phone', 'address']);
    expect(ASSISTANT_VOICE).toBe('marin');
  });
  it('keeps a tool answer short', () => {
    expect(toolAnswer({ ok: true })).toBe('{"ok":true}');
    expect(toolAnswer({ x: 'a'.repeat(9000) }).length).toBe(4000);
  });
});
