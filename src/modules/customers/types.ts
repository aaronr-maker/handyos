import type { BaseRecord, Id } from '@/core';

export interface Customer extends BaseRecord {
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface Property extends BaseRecord {
  customer_id: Id;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}
