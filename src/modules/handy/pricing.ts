/**
 * The company's own pricing numbers, for Handy to use instead of general web-style answers. These come from Aaron's pace-pricing
 * spec (docs/specs/PACE_PRICING.md) and are PRELIMINARY until the pace engine learns them from real jobs.
 */
export const PRICING = {
  /** What a budgeted man-hour of labor sells for. */
  laborRateCents: 12000,
  /** Labor budget = historical hours x (1 + allowance), so technicians at average pace can finish under budget. */
  allowance: 0.2,
  /** Single-coat interior painting, square feet of painted surface per man-hour. */
  paintSqftPerHour: 97.72,
  /** A second coat takes this share of the first coat's labor. */
  secondCoatShare: 0.75,
};

export interface PaintingPrice {
  area_sqft: number;
  coats: number;
  historical_hours: number;
  budgeted_hours: number;
  labor_price_dollars: number;
  labor_price_per_sqft: number;
}

/** Labor price for interior painting (materials, moving furniture and unusual prep are priced separately). */
export function priceInteriorPainting(areaSqft: number, coats: number): PaintingPrice {
  if (!(areaSqft > 0) || areaSqft > 200000) throw new Error('I need the painted surface area in square feet.');
  if (!Number.isInteger(coats) || coats < 1 || coats > 3) throw new Error('I need one, two or three coats.');
  const factor = 1 + (coats - 1) * PRICING.secondCoatShare;
  const historical = (areaSqft * factor) / PRICING.paintSqftPerHour;
  const budgeted = historical * (1 + PRICING.allowance);
  const price = (budgeted * PRICING.laborRateCents) / 100;
  const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  return { area_sqft: areaSqft, coats, historical_hours: r(historical), budgeted_hours: r(budgeted), labor_price_dollars: r(price), labor_price_per_sqft: r(price / areaSqft) };
}

/** How Handy talks about prices: decisive, with the company's numbers, never a generic web answer. */
export const PRICING_RULES = `Pricing: when asked what to charge, give a specific number first, then show the short math. Use the company's own numbers through your tools (price_painting) and never general internet averages or "it depends" answers. Our labor sells at $120 per budgeted man-hour; the budget is the usual time plus 20%. Interior painting labor uses the company's own pace (one coat about 97.72 square feet per man-hour, a second coat adds 75% of the first coat's labor). Materials, moving furniture, unusual prep and protection are priced separately, so say what is and is not included. If you are missing something you need (the square feet, the number of coats), ask for just that, once. If a number is a preliminary company figure, say so in a few words, and still give your recommendation. Never lower a price below what keeps the job profitable.`;
