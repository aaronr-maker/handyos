import { describe, expect, it } from 'vitest';
import { priceInteriorPainting } from '../src/modules/handy/pricing';

describe('interior painting labor price (Aaron\'s example, 1,000 sq ft)', () => {
  it('one coat', () => {
    expect(priceInteriorPainting(1000, 1)).toEqual({ area_sqft: 1000, coats: 1, historical_hours: 10.23, budgeted_hours: 12.28, labor_price_dollars: 1473.6, labor_price_per_sqft: 1.47 });
  });
  it('two coats', () => {
    const p = priceInteriorPainting(1000, 2);
    expect(p).toMatchObject({ historical_hours: 17.91, budgeted_hours: 21.49, labor_price_dollars: 2578.8, labor_price_per_sqft: 2.58 });
  });
  it('asks for what is missing instead of guessing', () => {
    expect(() => priceInteriorPainting(0, 1)).toThrow(/square feet/);
    expect(() => priceInteriorPainting(500, 0)).toThrow(/coats/);
  });
});
