import { createRepo, type Id } from '@/core';
import type { PriceBookItem } from '../types';

const items = createRepo<PriceBookItem>('price_book_items');

export type PriceBookFields = Pick<PriceBookItem, 'name' | 'description' | 'kind' | 'unit' | 'unit_price_cents' | 'unit_cost_cents' | 'taxable'>;

export const addPriceItem = (companyId: Id, data: PriceBookFields) => items.insert(companyId, { ...data, active: true });
export const getPriceItem = (companyId: Id, id: Id) => items.get(companyId, id);
export const updatePriceItem = (companyId: Id, id: Id, data: PriceBookFields) => items.update(companyId, id, data);
export const setPriceItemActive = (companyId: Id, id: Id, active: boolean) => items.update(companyId, id, { active });
export const listPriceItems = (companyId: Id) => items.list(companyId, { orderBy: 'name' });
