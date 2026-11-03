-- Income from the Profit and Loss, kept per month so other parts of the app can use it (revenue per man-hour, margins,
-- comparing what was brought in with what it cost). Same months as the cost lines (overhead_months).
create table public.income_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  month_id      uuid not null,
  account_name  text not null,
  group_path    text not null default '',
  -- 'income' is operating income (sales, services); 'other_income' is the report's Other Income section
  kind          text not null default 'income' check (kind in ('income', 'other_income')),
  amount_cents  bigint not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, month_id) references public.overhead_months (company_id, id) on delete cascade
);
create index income_lines_month_idx on public.income_lines (company_id, month_id);
create trigger income_lines_set_updated_at before update on public.income_lines
  for each row execute function public.set_updated_at();

alter table public.income_lines enable row level security;
revoke all on public.income_lines from anon;
grant select, insert, update, delete on public.income_lines to authenticated;
-- Owners, admins and office staff can read income (they can already see invoices); only owners and admins change it. Techs see nothing.
create policy income_lines_select on public.income_lines for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy income_lines_insert on public.income_lines for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy income_lines_update on public.income_lines for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy income_lines_delete on public.income_lines for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
