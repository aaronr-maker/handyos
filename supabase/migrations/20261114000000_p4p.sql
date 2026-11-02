-- Pay-for-performance (P4P).
--  1. A pool is taken from a job: revenue, gross profit or net profit (company setting).
--  2. The company keeps a protected percent of that first; the rest is the P4P pool.
--  3. The pool is shared out by levels (renamable, any number): a seller level (the person who sold the job),
--     a worker level (split by each person's share of hours on the job), and supervisor levels that each oversee
--     the level below (e.g. general foreman, regional manager). Anything not allocated stays with the company.
-- Everything here is private to owners/admins, except that each person can read their own structure row and payouts.

alter table public.estimates add column sold_by uuid references public.users (id) on delete set null;
alter table public.jobs add column sold_by uuid references public.users (id) on delete set null;

create table public.p4p_settings (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null unique references public.companies (id) on delete cascade,
  basis                text not null default 'net_profit' check (basis in ('revenue', 'gross_profit', 'net_profit')),
  company_reserve_bps  integer not null default 0 check (company_reserve_bps between 0 and 10000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, id)
);

create table public.p4p_levels (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null,
  kind         text not null check (kind in ('seller', 'worker', 'supervisor')),
  percent_bps  integer not null default 0 check (percent_bps between 0 and 10000),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id)
);
create index p4p_levels_company_idx on public.p4p_levels (company_id, sort_order);

-- Which level each person is on, and who they report to (their general foreman, regional manager, ...).
create table public.team_structure (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  user_id          uuid not null unique references public.users (id) on delete cascade,
  level_id         uuid references public.p4p_levels (id) on delete set null,
  reports_to       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, id),
  check (reports_to is null or reports_to <> user_id)
);

-- A finalized payout for one job: a snapshot, so later setting changes never rewrite what was earned.
create table public.p4p_runs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  job_id              uuid not null,
  basis               text not null,
  basis_cents         bigint not null,
  reserve_bps         integer not null,
  reserve_cents       bigint not null,
  pool_cents          bigint not null,
  company_total_cents bigint not null,
  snapshot            jsonb not null,
  finalized_by        uuid references public.users (id) on delete set null,
  finalized_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, id),
  unique (job_id),
  foreign key (company_id, job_id) references public.jobs (company_id, id)
);

create table public.p4p_payouts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  run_id        uuid not null,
  job_id        uuid not null,
  user_id       uuid not null references public.users (id),
  level_name    text not null,
  minutes       integer not null default 0,
  amount_cents  bigint not null check (amount_cents >= 0),
  paid_on       date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, run_id) references public.p4p_runs (company_id, id) on delete cascade,
  foreign key (company_id, job_id) references public.jobs (company_id, id)
);
create index p4p_payouts_user_idx on public.p4p_payouts (company_id, user_id);

do $$
declare t text;
begin
  foreach t in array array['p4p_settings', 'p4p_levels', 'team_structure', 'p4p_runs', 'p4p_payouts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Settings, levels, runs: owners and admins only.
do $$
declare t text;
begin
  foreach t in array array['p4p_settings', 'p4p_levels', 'p4p_runs'] loop
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin''))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin'')) with check (company_id = public.current_company_id())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin''))', t || '_delete', t);
  end loop;
end $$;

-- Team structure and payouts: owners/admins see all; everyone sees their own row(s). Only owners/admins change them.
create policy team_structure_select on public.team_structure for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy team_structure_insert on public.team_structure for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy team_structure_update on public.team_structure for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy team_structure_delete on public.team_structure for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));

create policy p4p_payouts_select on public.p4p_payouts for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy p4p_payouts_insert on public.p4p_payouts for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy p4p_payouts_update on public.p4p_payouts for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy p4p_payouts_delete on public.p4p_payouts for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
