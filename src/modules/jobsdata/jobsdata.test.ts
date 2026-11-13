import { describe, expect, it } from 'vitest';
import { dedupe } from './service';


describe('importing the same record twice', () => {
  it('keeps one row per invoice number', () => {
    const rows = [{ invoice_number: 123, total: 1 }, { invoice_number: 124, total: 2 }, { invoice_number: 123, total: 1 }];
    expect(dedupe(rows, (r) => r.invoice_number)).toHaveLength(2);
  });
});
