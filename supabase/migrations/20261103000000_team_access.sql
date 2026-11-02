-- Team access: invites, join requests and role management.
-- Rules: the company creator is the owner. Owners and admins can invite people and approve join
-- requests. Admins may only manage office/tech members; only the owner manages admins and company settings.
-- All membership changes go through the functions below (no direct writes), so these rules cannot be bypassed.

-- ---------------------------------------------------------------------------
-- Tighten earlier policies: role changes must go through functions; only the owner edits company settings.
-- ---------------------------------------------------------------------------
drop policy if exists users_update on public.users;
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (id = public.current_company_id() and public.current_user_role() = 'owner')
  with check (id = public.current_company_id());
revoke update on public.users from authenticated;

alter table public.users add column if not exists email text not null default '';

-- ---------------------------------------------------------------------------
-- Join codes (visible to owner/admin only). A person who signs up can use the code to ask to join.
-- ---------------------------------------------------------------------------
create table public.company_join_codes (
  company_id  uuid primary key references public.companies (id) on delete cascade,
  code        text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at  timestamptz not null default now()
);
alter table public.company_join_codes enable row level security;
create policy join_codes_select on public.company_join_codes for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
revoke all on public.company_join_codes from anon;
revoke insert, update, delete on public.company_join_codes from authenticated;
grant select on public.company_join_codes to authenticated;

insert into public.company_join_codes (company_id) select id from public.companies on conflict do nothing;

create or replace function public.create_join_code_for_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.company_join_codes (company_id) values (new.id);
  return new;
end $$;
create trigger companies_create_join_code after insert on public.companies
  for each row execute function public.create_join_code_for_company();

-- ---------------------------------------------------------------------------
-- Invites and join requests
-- ---------------------------------------------------------------------------
create type public.request_status as enum ('pending', 'accepted', 'declined', 'revoked');

create table public.company_invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  email       text not null,
  role        public.user_role not null check (role <> 'owner'),
  invited_by  uuid references auth.users (id) on delete set null,
  status      public.request_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index company_invites_pending_idx on public.company_invites (company_id, lower(email)) where status = 'pending';
create index company_invites_email_idx on public.company_invites (lower(email));

create table public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  status      public.request_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index join_requests_pending_idx on public.join_requests (company_id, user_id) where status = 'pending';

create trigger company_invites_set_updated_at before update on public.company_invites for each row execute function public.set_updated_at();
create trigger join_requests_set_updated_at before update on public.join_requests for each row execute function public.set_updated_at();

alter table public.company_invites enable row level security;
alter table public.join_requests enable row level security;
create policy invites_select on public.company_invites for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy join_requests_select on public.join_requests for select to authenticated
  using ((company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin')) or user_id = auth.uid());
revoke all on public.company_invites, public.join_requests from anon;
revoke insert, update, delete on public.company_invites, public.join_requests from authenticated;
grant select on public.company_invites, public.join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Functions (the only way to change membership)
-- ---------------------------------------------------------------------------
create or replace function public.auth_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- Can the caller (owner/admin) manage a member or invite with this role?
create or replace function public.can_manage_role(target public.user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.current_user_role()
    when 'owner' then target <> 'owner'
    when 'admin' then target in ('office', 'tech')
    else false end
$$;

-- Replaces the earlier version: also stores the owner's email.
create or replace function public.create_company_for_user(company_name text, owner_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_company uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.users where id = auth.uid()) then raise exception 'User already belongs to a company'; end if;
  if length(trim(company_name)) = 0 then raise exception 'Company name is required'; end if;
  insert into public.companies (name) values (trim(company_name)) returning id into new_company;
  insert into public.users (id, company_id, full_name, role, email)
    values (auth.uid(), new_company, owner_name, 'owner', public.auth_email());
  return new_company;
end $$;

create or replace function public.invite_member(invite_email text, invite_role public.user_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv uuid;
begin
  if not public.can_manage_role(invite_role) then raise exception 'You are not allowed to invite that role'; end if;
  if position('@' in invite_email) = 0 then raise exception 'Enter a valid email'; end if;
  update public.company_invites set status = 'revoked'
    where company_id = public.current_company_id() and lower(email) = lower(trim(invite_email)) and status = 'pending';
  insert into public.company_invites (company_id, email, role, invited_by)
    values (public.current_company_id(), lower(trim(invite_email)), invite_role, auth.uid()) returning id into inv;
  return inv;
end $$;

create or replace function public.revoke_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.company_invites;
begin
  select * into inv from public.company_invites where id = invite_id and company_id = public.current_company_id() and status = 'pending';
  if not found then raise exception 'Invite not found'; end if;
  if not public.can_manage_role(inv.role) then raise exception 'You are not allowed to revoke that invite'; end if;
  update public.company_invites set status = 'revoked' where id = invite_id;
end $$;

-- Invites addressed to the signed-in user's email (for people who have no company yet).
create or replace function public.my_pending_invites()
returns table (invite_id uuid, company_name text, role public.user_role)
language sql stable security definer set search_path = public as $$
  select i.id, c.name, i.role
  from public.company_invites i join public.companies c on c.id = i.company_id
  where i.status = 'pending' and lower(i.email) = public.auth_email() and auth.uid() is not null
$$;

create or replace function public.accept_invite(invite_id uuid, member_name text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.company_invites;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.users where id = auth.uid()) then raise exception 'You already belong to a company'; end if;
  select * into inv from public.company_invites where id = invite_id and status = 'pending' and lower(email) = public.auth_email();
  if not found then raise exception 'Invite not found'; end if;
  insert into public.users (id, company_id, full_name, role, email) values (auth.uid(), inv.company_id, member_name, inv.role, public.auth_email());
  update public.company_invites set status = 'accepted' where id = invite_id;
  update public.join_requests set status = 'revoked' where user_id = auth.uid() and status = 'pending';
  return inv.company_id;
end $$;

create or replace function public.decline_invite(invite_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.company_invites set status = 'declined'
  where id = invite_id and status = 'pending' and lower(email) = public.auth_email()
$$;

-- A signed-in person with no company asks to join using the company's join code.
create or replace function public.request_to_join(join_code text, member_name text default '') returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid; cname text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.users where id = auth.uid()) then raise exception 'You already belong to a company'; end if;
  select jc.company_id, c.name into cid, cname from public.company_join_codes jc join public.companies c on c.id = jc.company_id
    where jc.code = lower(trim(join_code));
  if not found then raise exception 'That join code was not found'; end if;
  insert into public.join_requests (company_id, user_id, email, full_name)
    values (cid, auth.uid(), public.auth_email(), member_name)
    on conflict (company_id, user_id) where status = 'pending' do update set full_name = excluded.full_name;
  return cname;
end $$;

create or replace function public.decide_join_request(request_id uuid, approve boolean, as_role public.user_role default 'tech') returns void
language plpgsql security definer set search_path = public as $$
declare req public.join_requests;
begin
  select * into req from public.join_requests where id = request_id and company_id = public.current_company_id() and status = 'pending';
  if not found then raise exception 'Request not found'; end if;
  if not approve then
    if public.current_user_role() not in ('owner', 'admin') then raise exception 'Not allowed'; end if;
    update public.join_requests set status = 'declined' where id = request_id;
    return;
  end if;
  if not public.can_manage_role(as_role) then raise exception 'You are not allowed to grant that role'; end if;
  if exists (select 1 from public.users where id = req.user_id) then raise exception 'That person already belongs to a company'; end if;
  insert into public.users (id, company_id, full_name, role, email) values (req.user_id, req.company_id, req.full_name, as_role, req.email);
  update public.join_requests set status = 'accepted' where id = request_id;
end $$;

create or replace function public.set_member_role(member_id uuid, new_role public.user_role) returns void
language plpgsql security definer set search_path = public as $$
declare target public.users;
begin
  select * into target from public.users where id = member_id and company_id = public.current_company_id();
  if not found then raise exception 'Member not found'; end if;
  if member_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if target.role = 'owner' then raise exception 'The owner''s role cannot be changed'; end if;
  if not (public.can_manage_role(target.role) and public.can_manage_role(new_role)) then raise exception 'You are not allowed to make that change'; end if;
  update public.users set role = new_role where id = member_id;
end $$;

create or replace function public.remove_member(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare target public.users;
begin
  select * into target from public.users where id = member_id and company_id = public.current_company_id();
  if not found then raise exception 'Member not found'; end if;
  if member_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if not public.can_manage_role(target.role) then raise exception 'You are not allowed to remove that member'; end if;
  delete from public.users where id = member_id;
end $$;

create or replace function public.rotate_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare new_code text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  if public.current_user_role() not in ('owner', 'admin') then raise exception 'Not allowed'; end if;
  update public.company_join_codes set code = new_code where company_id = public.current_company_id();
  return new_code;
end $$;

-- Only signed-in users may call these.
do $$
declare f text;
begin
  foreach f in array array[
    'auth_email()', 'can_manage_role(public.user_role)', 'create_company_for_user(text, text)',
    'invite_member(text, public.user_role)', 'revoke_invite(uuid)', 'my_pending_invites()',
    'accept_invite(uuid, text)', 'decline_invite(uuid)', 'request_to_join(text, text)',
    'decide_join_request(uuid, boolean, public.user_role)', 'set_member_role(uuid, public.user_role)',
    'remove_member(uuid)', 'rotate_join_code()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
