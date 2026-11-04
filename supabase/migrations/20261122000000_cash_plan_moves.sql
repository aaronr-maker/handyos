-- Which of a week's cash-plan transfers have been made (sales tax moved, wages moved, ...). The amount is what the plan
-- said when it was ticked, so the page can warn when later payments change it.
create table public.cash_plan_moves (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  -- the Monday of the week
  week_start   date not null,
  bucket       text not null check (bucket in ('sales_tax', 'materials', 'wages', 'payroll_tax', 'overhead', 'p4p', 'reserve', 'profit')),
  amount_cents bigint not null,
  moved_on     date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, week_start, bucket)
);
create trigger cash_plan_moves_set_updated_at before update on public.cash_plan_moves
  for each row execute function public.set_updated_at();

alter table public.cash_plan_moves enable row level security;
revoke all on public.cash_plan_moves from anon;
grant select, insert, update, delete on public.cash_plan_moves to authenticated;
create policy cash_plan_moves_select on public.cash_plan_moves for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy cash_plan_moves_insert on public.cash_plan_moves for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy cash_plan_moves_update on public.cash_plan_moves for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy cash_plan_moves_delete on public.cash_plan_moves for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
