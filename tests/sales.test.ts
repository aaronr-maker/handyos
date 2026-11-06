import { describe, expect, it } from 'vitest';
import { computeSales } from '../src/modules/sales/calc';

const NOW = Date.parse('2027-02-01T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const est = (sold_by: string | null, sent: number, outcome: 'approved' | 'declined' | null, dollars: number) => ({
  sold_by,
  subtotal_cents: dollars * 100,
  sent_at: day(sent),
  approved_at: outcome === 'approved' ? day(sent - 1) : null,
  declined_at: outcome === 'declined' ? day(sent - 1) : null,
});
const settings = { crew_people: 2, crew_days_per_week: 5, crew_hours_per_day: 8, cost_per_hour_cents: 5100, target_margin_bps: 2000 };

describe('sales by person', () => {
  const estimates = [est('a', 10, 'approved', 2000), est('a', 12, 'approved', 1000), est('a', 14, 'declined', 500), est('a', 5, null, 800), est('b', 9, 'declined', 700), est('b', 8, 'approved', 600), est('b', 40, 'approved', 9000)];
  const r = computeSales({ now: NOW, windowDays: 30, estimates, settings });

  it('counts sent, close rate, average ticket and sold for each person inside the period', () => {
    const a = r.sellers.find((s) => s.user_id === 'a')!;
    expect(a).toMatchObject({ sent: 4, approved: 2, declined: 1, soldCents: 300000, avgTicketCents: 150000 });
    expect(a.closeRate).toBeCloseTo(2 / 3);
    const b = r.sellers.find((s) => s.user_id === 'b')!;
    expect(b).toMatchObject({ sent: 2, approved: 1, soldCents: 60000 }); // the $9,000 sale was 39 days ago: outside 30 days
    expect(r.sellers[0].user_id).toBe('a'); // biggest seller first
    expect(r.total.sent).toBe(6);
  });

  it('works out how many estimates have to go out to cover the crew and the profit target', () => {
    // 2 people x 5 days x 8 hours x (52/12) weeks x $51 = about $17,680 a month; /0.8 = about $22,100 to hit the target
    expect(r.needs.monthlyCostCents).toBe(Math.round(2 * 5 * 8 * (52 / 12) * 5100));
    expect(r.needs.targetSalesCents).toBe(Math.round(r.needs.monthlyCostCents! / 0.8));
    const perEstimate = r.total.avgTicketCents! * r.total.closeRate!;
    expect(r.needs.targetEstimates).toBeCloseTo(r.needs.targetSalesCents! / perEstimate, 0);
    expect(r.needs.sentPerMonth).toBe(6);
    expect(r.needs.verdict).toBe('short');
    expect(r.needs.gap!).toBeLessThan(0);
  });

  it('says what is missing instead of guessing', () => {
    expect(computeSales({ now: NOW, windowDays: 30, estimates, settings: { ...settings, crew_people: null } }).needs).toMatchObject({ verdict: 'unknown', monthlyCostCents: null });
    const none = computeSales({ now: NOW, windowDays: 30, estimates: [est('a', 3, null, 500)], settings });
    expect(none.needs.verdict).toBe('unknown');
    expect(none.needs.missing).toMatch(/close rate/);
  });

  it('scales a longer period down to a month', () => {
    const year = computeSales({ now: NOW, windowDays: 90, estimates: [est('a', 80, null, 1), est('a', 50, null, 1), est('a', 10, null, 1)], settings });
    expect(year.needs.sentPerMonth).toBe(1);
  });

  it('ranks the top performer in each category, and a close rate needs enough decided estimates', () => {
    const boards = Object.fromEntries(r.boards.map((b) => [b.id, b.leaders.map((l) => l.user_id)]));
    expect(boards.sold).toEqual(['a', 'b']);
    expect(boards.sent).toEqual(['a', 'b']);
    expect(boards.close).toEqual(['a']); // b has only 2 decided
    expect(boards.ticket).toEqual(['a', 'b']);
    const withPace = computeSales({ now: NOW, windowDays: 30, estimates, settings, pace: [{ user_id: 'b', rate: 0.8 }, { user_id: 'a', rate: 1.1 }] });
    expect(withPace.boards.find((b) => b.id === 'pace')!.leaders.map((l) => l.user_id)).toEqual(['b', 'a']); // faster first
  });
});
