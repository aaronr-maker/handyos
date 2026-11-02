-- Job costing: what a job really cost (labor from the time clock, materials and other costs) versus what was invoiced.
-- Pay rates are private: only owners/admins (and each person for their own rate) can read them.

create table public.team_pay_rates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  user_id           uuid not null references public.users (id) on delete cascade,
  hourly_cost_cents bigint not null default 0 check (hourly_cost_cents >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, id),
  unique (user_id)
);
create trigger team_pay_rates_set_updated_at before update on public.team_pay_rates
  for each row execute function public.set_updated_at();

create table public.job_costs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  job_id        uuid not null,
  kind          text not null check (kind in ('labor', 'material', 'other')),
  description   text not null default '',
  amount_cents  bigint not null check (amount_cents > 0),
  incurred_on   date not null default current_date,
  recorded_by   uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, job_id) references public.jobs (company_id, id) on delete cascade
);
create index job_costs_company_job_idx on public.job_costs (company_id, job_id);
create trigger job_costs_set_updated_at before update on public.job_costs
  for each row execute function public.set_updated_at();

alter table public.team_pay_rates enable row level security;
alter table public.job_costs enable row level security;

create policy team_pay_rates_select on public.team_pay_rates for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy team_pay_rates_insert on public.team_pay_rates for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy team_pay_rates_update on public.team_pay_rates for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());

-- Costs are business numbers: owners, admins and office staff only (techs never see them).
create policy job_costs_select on public.job_costs for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() <> 'tech');
create policy job_costs_insert on public.job_costs for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() <> 'tech');
create policy job_costs_update on public.job_costs for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy job_costs_delete on public.job_costs for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));

revoke all on public.team_pay_rates, public.job_costs from anon;
grant select, insert, update on public.team_pay_rates to authenticated;
grant select, insert, update, delete on public.job_costs to authenticated;
