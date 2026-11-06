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
