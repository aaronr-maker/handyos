-- Sending HandyOS invoices and payments into QuickBooks. Settings are the company's choices (where things post, whether
-- sending is on); records are what has been sent, so nothing is sent twice. Sending starts switched OFF.
create table public.qb_sync_settings (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null unique references public.companies (id) on delete cascade,
  enabled              boolean not null default false,
  income_account_id    text,
  income_account_name  text,
  deposit_account_id   text,
  deposit_account_name text,
  tax_code_id          text,
  tax_code_name        text,
  -- only invoices and payments dated on or after this day are sent, so old history is never pushed
  start_date           date not null default '2027-01-01',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger qb_sync_settings_set_updated_at before update on public.qb_sync_settings
  for each row execute function public.set_updated_at();

create table public.qb_sync_records (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  entity            text not null check (entity in ('invoice', 'payment')),
  local_id          uuid not null,
  qb_id             text,
  qb_customer_id    text,
  error             text,
  synced_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, entity, local_id)
);

alter table public.qb_sync_settings enable row level security;
alter table public.qb_sync_records enable row level security;
revoke all on public.qb_sync_settings, public.qb_sync_records from anon;
grant select, insert, update on public.qb_sync_settings to authenticated;
grant select on public.qb_sync_records to authenticated;
-- the server (service role) writes the records; people only read them

create policy qb_sync_settings_select on public.qb_sync_settings for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy qb_sync_settings_insert on public.qb_sync_settings for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy qb_sync_settings_update on public.qb_sync_settings for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy qb_sync_records_select on public.qb_sync_records for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
