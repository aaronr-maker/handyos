-- Two things the AI receptionist needs: who is signed off to do in-home estimates and which languages each person speaks,
-- and the blocks of time Aaron sets aside for in-home estimates.

alter table public.users
  add column is_seller boolean not null default false,
  add column languages text[] not null default '{}';

-- Owners and admins set these for anyone in the company.
create or replace function public.set_member_profile(member_id uuid, seller boolean, speaks text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('owner', 'admin') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.users where id = member_id and company_id = public.current_company_id()) then raise exception 'Member not found'; end if;
  update public.users set is_seller = coalesce(seller, false), languages = coalesce(speaks, '{}') where id = member_id and company_id = public.current_company_id();
end $$;
revoke all on function public.set_member_profile(uuid, boolean, text[]) from public, anon;
grant execute on function public.set_member_profile(uuid, boolean, text[]) to authenticated;

create table public.estimate_settings (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null unique references public.companies (id) on delete cascade,
  timezone       text not null default 'America/Chicago',
  -- the blocks set aside for in-home estimates: {"tue":[{"start":"16:00","end":"18:00"}],...}
  week           jsonb not null default '{}',
  slot_minutes   int not null default 60 check (slot_minutes between 15 and 480),
  buffer_minutes int not null default 30 check (buffer_minutes between 0 and 240),
  notice_hours   int not null default 12 check (notice_hours between 0 and 336),
  horizon_days   int not null default 14 check (horizon_days between 1 and 90),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger estimate_settings_set_updated_at before update on public.estimate_settings for each row execute function public.set_updated_at();
alter table public.estimate_settings enable row level security;
revoke all on public.estimate_settings from anon;
grant select, insert, update, delete on public.estimate_settings to authenticated;
create policy estimate_settings_all on public.estimate_settings for all to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
