-- Jobs, tech assignment and time clock.
-- jobs.customer_id is who is BILLED and owed_by_customer_id who it is labeled as owed by (same rule as estimates).
-- Time entries are the tech clock in/out records that job costing later turns into labor cost.

alter table public.jobs
  add column job_number bigint,
  add column owed_by_customer_id uuid,
  add column notes text,
  add column scheduled_end timestamptz,
  add column completed_at timestamptz;
alter table public.jobs add foreign key (company_id, owed_by_customer_id) references public.customers (company_id, id);
create unique index jobs_number_idx on public.jobs (company_id, job_number) where job_number is not null;

-- Which team members are assigned to a job.
create table public.job_assignments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  job_id      uuid not null,
  user_id     uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id),
  unique (job_id, user_id),
  foreign key (company_id, job_id) references public.jobs (company_id, id) on delete cascade
);
create index job_assignments_company_idx on public.job_assignments (company_id);
create index job_assignments_user_idx on public.job_assignments (user_id);
create trigger job_assignments_set_updated_at before update on public.job_assignments
  for each row execute function public.set_updated_at();

-- Tech clock in / out. At most one open entry (clock_out is null) per person at a time.
create table public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  job_id      uuid not null,
  user_id     uuid not null references public.users (id) on delete cascade,
  clock_in    timestamptz not null default now(),
  clock_out   timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, job_id) references public.jobs (company_id, id) on delete cascade,
  check (clock_out is null or clock_out >= clock_in)
);
create unique index time_entries_one_open_idx on public.time_entries (user_id) where clock_out is null;
create index time_entries_company_idx on public.time_entries (company_id, clock_in desc);
create index time_entries_job_idx on public.time_entries (job_id);
create trigger time_entries_set_updated_at before update on public.time_entries
  for each row execute function public.set_updated_at();

alter table public.job_assignments enable row level security;
alter table public.time_entries enable row level security;

create policy job_assignments_select on public.job_assignments for select to authenticated using (company_id = public.current_company_id());
create policy job_assignments_insert on public.job_assignments for insert to authenticated with check (company_id = public.current_company_id());
create policy job_assignments_update on public.job_assignments for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy job_assignments_delete on public.job_assignments for delete to authenticated using (company_id = public.current_company_id());

-- Everyone in the company can see time entries (the schedule needs them); you can only clock yourself in/out;
-- closing someone else's open entry (for example when a job is completed) is allowed; editing finished ones is for the owner and admins.
create policy time_entries_select on public.time_entries for select to authenticated using (company_id = public.current_company_id());
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy time_entries_update on public.time_entries for update to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or clock_out is null or public.current_user_role() in ('owner', 'admin'))
  )
  with check (company_id = public.current_company_id());
-- (anyone in the company may close an open entry, so finishing a job can clock out a coworker who forgot;
--  changing finished entries is for the owner and admins.)
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));

revoke all on public.job_assignments, public.time_entries from anon;
grant select, insert, update, delete on public.job_assignments, public.time_entries to authenticated;
