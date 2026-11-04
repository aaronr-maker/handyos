-- Alerts for managers (a tech heading into overtime, a clock left running). One alert per kind, person and week, so
-- the same problem is not raised twice. Only owners and admins see and handle them.
create table public.desk_alerts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  kind             text not null check (kind in ('overtime_risk', 'forgotten_clock')),
  subject_user_id  uuid not null,
  -- the Monday of the week the alert is about
  week_start       date not null,
  severity         text not null default 'warning' check (severity in ('warning', 'critical')),
  title            text not null,
  detail           text not null default '',
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolution       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, kind, subject_user_id, week_start)
);
create trigger desk_alerts_set_updated_at before update on public.desk_alerts
  for each row execute function public.set_updated_at();

alter table public.desk_alerts enable row level security;
revoke all on public.desk_alerts from anon;
grant select, insert, update on public.desk_alerts to authenticated;
create policy desk_alerts_select on public.desk_alerts for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy desk_alerts_insert on public.desk_alerts for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy desk_alerts_update on public.desk_alerts for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());

-- Only admins and owners may change someone else's day clock or task times (everyone changes only their own).
-- This replaces the earlier rule from the time tracking file, which also let the office do it.
drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts for update to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')))
  with check (company_id = public.current_company_id());
drop policy if exists task_timers_update on public.task_timers;
create policy task_timers_update on public.task_timers for update to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')))
  with check (company_id = public.current_company_id());
