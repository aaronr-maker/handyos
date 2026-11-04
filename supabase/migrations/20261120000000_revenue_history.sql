-- Past revenue loaded from other systems (QuickBooks invoice lists, old CRMs), one row per invoice or payment, so the
-- Revenue report can show history by day, week, month, quarter, job and customer alongside new work done in HandyOS.
create table public.revenue_history (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  -- the day the money was received (or the invoice date when the export has no payment date)
  received_on  date not null,
  amount_cents bigint not null,
  customer     text not null default '',
  job          text not null default '',
  invoice_ref  text not null default '',
  -- the name of the import ("QuickBooks 2025", "Jobber"), so one import can be replaced or removed as a whole
  source       text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id)
);
create index revenue_history_date_idx on public.revenue_history (company_id, received_on);
create index revenue_history_source_idx on public.revenue_history (company_id, source);
create trigger revenue_history_set_updated_at before update on public.revenue_history
  for each row execute function public.set_updated_at();

alter table public.revenue_history enable row level security;
revoke all on public.revenue_history from anon;
grant select, insert, update, delete on public.revenue_history to authenticated;
-- Owners and admins only (it is the company's whole sales history). Techs and office see nothing.
create policy revenue_history_select on public.revenue_history for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy revenue_history_insert on public.revenue_history for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy revenue_history_update on public.revenue_history for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy revenue_history_delete on public.revenue_history for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
