-- When each team member works, by weekday: {"mon":[{"start":"07:00","end":"16:00"}],...}. A person with no row has no limit.
-- Owners and admins set it; a person can read their own.

create table public.team_availability (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  week        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);
create trigger team_availability_set_updated_at before update on public.team_availability for each row execute function public.set_updated_at();
alter table public.team_availability enable row level security;
revoke all on public.team_availability from anon;
grant select, insert, update, delete on public.team_availability to authenticated;
create policy team_availability_manage on public.team_availability for all to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
create policy team_availability_own on public.team_availability for select to authenticated
  using (company_id = public.current_company_id() and user_id = auth.uid());
