-- Price book: the services, materials and fees you quote from. Prices and costs are integer cents.
-- unit_cost_cents is what it costs you (used later for job costing and pay-for-performance).
create table public.price_book_items (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  name             text not null,
  description      text,
  kind             text not null default 'service' check (kind in ('service', 'material', 'fee')),
  unit             text not null default 'each',
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  unit_cost_cents  bigint not null default 0 check (unit_cost_cents >= 0),
  taxable          boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, id)
);
create index price_book_items_company_idx on public.price_book_items (company_id, active, name);
create trigger price_book_items_set_updated_at before update on public.price_book_items
  for each row execute function public.set_updated_at();

alter table public.price_book_items enable row level security;
create policy price_book_items_select on public.price_book_items for select to authenticated using (company_id = public.current_company_id());
create policy price_book_items_insert on public.price_book_items for insert to authenticated with check (company_id = public.current_company_id());
create policy price_book_items_update on public.price_book_items for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy price_book_items_delete on public.price_book_items for delete to authenticated using (company_id = public.current_company_id());
revoke all on public.price_book_items from anon;
grant select, insert, update, delete on public.price_book_items to authenticated;
