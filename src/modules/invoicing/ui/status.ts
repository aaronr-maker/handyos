import type { InvoiceStatus } from '../types';

export const statusClass: Record<InvoiceStatus, string> = { draft: 'pill', sent: 'pill medium', paid: 'pill ok', overdue: 'pill high', void: 'pill' };
