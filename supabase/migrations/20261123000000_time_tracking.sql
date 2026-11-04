-- Time tracking in three levels: the day (shifts), the job (time_entries, already there) and the task (task_timers),
-- plus the tasks of a job, the history of edits, geofence consent and the job's location.

create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  clock_in    timestamptz not null default now(),
  clock_out   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index shifts_user_idx on public.shifts (company_id, user_id, clock_in);

create table public.job_tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  job_id              uuid not null,
  name                text not null,
  -- the price book item this task is (so the same service can be compared across jobs)
  price_book_item_id  text,
  quantity            numeric not null default 1,
  unit                text not null default 'each',
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index job_tasks_job_idx on public.job_tasks (company_id, job_id);

create table public.task_timers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  job_id      uuid not null,
  task_id     uuid not null references public.job_tasks (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index task_timers_job_idx on public.task_timers (company_id, job_id);

-- Every change to a time stamp keeps what it was before, who changed it and why.
create table public.time_edits (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  entity      text not null check (entity in ('job', 'task', 'shift')),
  entity_id   uuid not null,
  -- whose time it is
  user_id     uuid not null,
  edited_by   uuid not null,
  field       text not null,
  old_value   text,
  new_value   text,
  reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index time_edits_entity_idx on public.time_edits (company_id, entity, entity_id);

-- A tech agrees (or not) to location-based reminders on their phone, and each job can have a location.
create table public.geofence_consent (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  consented_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id)
);
create table public.job_sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  job_id      uuid not null,
  lat         double precision not null,
  lng         double precision not null,
  radius_m    int not null default 150,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, job_id)
);

do $$
declare t text;
begin
  foreach t in array array['shifts', 'job_tasks', 'task_timers', 'time_edits', 'geofence_consent', 'job_sites'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Everyone in the company can see time and tasks (as with time_entries); anyone changes only their own, admins and owners anyone's.
create policy shifts_select on public.shifts for select to authenticated using (company_id = public.current_company_id());
create policy shifts_insert on public.shifts for insert to authenticated with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy shifts_update on public.shifts for update to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')))
  with check (company_id = public.current_company_id());
create policy shifts_delete on public.shifts for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));

create policy task_timers_select on public.task_timers for select to authenticated using (company_id = public.current_company_id());
create policy task_timers_insert on public.task_timers for insert to authenticated with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy task_timers_update on public.task_timers for update to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')))
  with check (company_id = public.current_company_id());
create policy task_timers_delete on public.task_timers for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));

create policy job_tasks_select on public.job_tasks for select to authenticated using (company_id = public.current_company_id());
create policy job_tasks_insert on public.job_tasks for insert to authenticated with check (company_id = public.current_company_id());
create policy job_tasks_update on public.job_tasks for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy job_tasks_delete on public.job_tasks for delete to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));

-- edits can be added and read, never changed or removed from the app
create policy time_edits_select on public.time_edits for select to authenticated using (company_id = public.current_company_id());
create policy time_edits_insert on public.time_edits for insert to authenticated with check (company_id = public.current_company_id() and edited_by = auth.uid());
revoke update, delete on public.time_edits from authenticated;

create policy geofence_consent_select on public.geofence_consent for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy geofence_consent_insert on public.geofence_consent for insert to authenticated with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy geofence_consent_update on public.geofence_consent for update to authenticated
  using (company_id = public.current_company_id() and user_id = auth.uid()) with check (company_id = public.current_company_id() and user_id = auth.uid());

create policy job_sites_select on public.job_sites for select to authenticated using (company_id = public.current_company_id());
create policy job_sites_insert on public.job_sites for insert to authenticated with check (company_id = public.current_company_id());
create policy job_sites_update on public.job_sites for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
