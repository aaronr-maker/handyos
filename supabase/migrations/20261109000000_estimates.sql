-- Estimates: numbered quotes with line items, tax, and the billing rule applied from the property.
-- estimates.customer_id is who is BILLED (the property manager for a managed rental, else the owner);
-- owed_by_customer_id is who the estimate is labeled as owed by (the owner; the manager when no owner is listed).

-- Per-company counters (estimate numbers; invoice numbers later). Only reachable through next_company_number().
create table public.company_counters (
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  value       bigint not null default 0,
  primary key (company_id, name)
);
alter table public.company_counters enable row level security;
revoke all on public.company_counters from anon, authenticated;

create or replace function public.next_company_number(counter text) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if public.current_company_id() is null then raise exception 'Not signed in'; end if;
  insert into public.company_counters (company_id, name, value) values (public.current_company_id(), counter, 1001)
  on conflict (company_id, name) do update set value = public.company_counters.value + 1
  returning value into n;
  return n;
end $$;
revoke all on function public.next_company_number(text) from public, anon;
grant execute on function public.next_company_number(text) to authenticated;

alter table public.estimates
  add column estimate_number bigint,
  add column owed_by_customer_id uuid,
  add column tax_rate_bps integer not null default 0 check (tax_rate_bps >= 0 and tax_rate_bps <= 10000),
  add column subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  add column tax_cents bigint not null default 0 check (tax_cents >= 0),
  add column valid_until date,
  add column notes text,
  add column sent_at timestamptz,
  add column approved_at timestamptz,
  add column declined_at timestamptz;
alter table public.estimates add foreign key (company_id, owed_by_customer_id) references public.customers (company_id, id);
create unique index estimates_number_idx on public.estimates (company_id, estimate_number) where estimate_number is not null;
