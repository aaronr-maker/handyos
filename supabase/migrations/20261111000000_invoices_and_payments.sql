-- Invoices and payments.
-- invoices.customer_id is who is BILLED; owed_by_customer_id is who it is labeled as owed by (same rule as estimates).
-- Payments are stored as signed amounts (a refund is negative); invoices.amount_paid_cents is kept in step by the app.

alter table public.invoices
  add column invoice_number bigint,
  add column title text not null default '',
  add column line_items jsonb not null default '[]'::jsonb,
  add column tax_rate_bps integer not null default 0 check (tax_rate_bps >= 0 and tax_rate_bps <= 10000),
  add column subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  add column tax_cents bigint not null default 0 check (tax_cents >= 0),
  add column issued_on date,
  add column notes text,
  add column sent_at timestamptz,
  add column paid_at timestamptz,
  add column voided_at timestamptz,
  add column void_reason text;
create unique index invoices_number_idx on public.invoices (company_id, invoice_number) where invoice_number is not null;
create index invoices_status_due_idx on public.invoices (company_id, status, due_date);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  invoice_id    uuid not null,
  amount_cents  bigint not null check (amount_cents <> 0),
  method        text not null check (method in ('card', 'cash', 'check', 'bank_transfer', 'other')),
  provider_ref  text,
  received_on   date not null default current_date,
  note          text,
  recorded_by   uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, invoice_id) references public.invoices (company_id, id)
);
create index payments_company_idx on public.payments (company_id, received_on desc);
create index payments_invoice_idx on public.payments (invoice_id);
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated using (company_id = public.current_company_id());
create policy payments_insert on public.payments for insert to authenticated with check (company_id = public.current_company_id());
-- A recorded payment is a financial record: it can be corrected only by the owner or an admin, and is never deleted by the app.
create policy payments_update on public.payments for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
revoke all on public.payments from anon;
grant select, insert, update on public.payments to authenticated;
