-- Real drive times: each team member's home base, and a saved copy of map lookups so the same address or trip is never looked up twice.

alter table public.users add column home_address text;

create or replace function public.set_member_home(member_id uuid, address text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('owner', 'admin') then raise exception 'Not allowed'; end if;
  update public.users set home_address = nullif(btrim(address), '') where id = member_id and company_id = public.current_company_id();
end $$;
revoke all on function public.set_member_home(uuid, text) from public, anon;
grant execute on function public.set_member_home(uuid, text) to authenticated;

-- Only the server (service key) reads and writes these; no one signed in can touch them directly.
create table public.geocodes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  address_key text not null,
  lat         double precision,
  lon         double precision,
  created_at  timestamptz not null default now(),
  unique (company_id, address_key)
);
create table public.drive_times (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  from_key    text not null,
  to_key      text not null,
  minutes     int not null,
  created_at  timestamptz not null default now(),
  unique (company_id, from_key, to_key)
);
alter table public.geocodes enable row level security;
alter table public.drive_times enable row level security;
revoke all on public.geocodes, public.drive_times from anon, authenticated;
