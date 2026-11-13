-- Things on a person's calendar that are not jobs: time off, personal appointments, anything that blocks scheduling.
-- Everyone in the company can see them (so nobody is double booked); a person can add and remove their own, and owners,
-- admins and office can for anyone.

create table public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  kind        text not null default 'time_off' check (kind in ('time_off', 'appointment', 'other')),
  title       text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  all_day     boolean not null default false,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index calendar_events_time_idx on public.calendar_events (company_id, starts_at);
create trigger calendar_events_set_updated_at before update on public.calendar_events for each row execute function public.set_updated_at();
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from anon;
grant select, insert, update, delete on public.calendar_events to authenticated;
create policy calendar_events_select on public.calendar_events for select to authenticated
  using (company_id = public.current_company_id());
create policy calendar_events_write on public.calendar_events for all to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin', 'office')))
  with check (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin', 'office')));
