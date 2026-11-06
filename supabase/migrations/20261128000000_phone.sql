-- The phone system: the company's call tree, business hours, who to ring, a log of calls, and voicemails.
-- The server (which answers Twilio) writes the call log and voicemails; owners and admins edit the rest.

create table public.call_settings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null unique references public.companies (id) on delete cascade,
  -- the Twilio number customers call, like +15125550000
  number      text,
  timezone    text not null default 'America/Chicago',
  -- open stretches for each weekday: {"mon":[{"open":"08:00","close":"17:00"}],...}
  hours       jsonb not null default '{}',
  -- the voice that reads greetings aloud
  voice       text not null default 'Polly.Joanna',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.team_phones (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  phone       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.call_flows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null default 'Main line',
  -- only one tree answers the phone at a time
  active      boolean not null default true,
  graph       jsonb not null default '{"nodes":[],"edges":[]}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index call_flows_one_active on public.call_flows (company_id) where active;

create table public.call_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  call_sid     text not null,
  from_number  text,
  to_number    text,
  -- the blocks the call passed through, in order
  trail        jsonb not null default '[]',
  outcome      text not null default 'started',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, call_sid)
);
create index call_log_time_idx on public.call_log (company_id, created_at desc);

create table public.voicemails (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  call_sid          text not null,
  from_number       text,
  recording_url     text not null,
  duration_seconds  int not null default 0,
  transcript        text,
  status            text not null default 'new' check (status in ('new', 'heard')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, call_sid)
);
create index voicemails_time_idx on public.voicemails (company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['call_settings', 'team_phones', 'call_flows', 'call_log', 'voicemails'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

grant select, insert, update, delete on public.call_settings, public.team_phones, public.call_flows to authenticated;
grant select on public.call_log to authenticated;
grant select, update on public.voicemails to authenticated;

create policy call_settings_all on public.call_settings for all to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy team_phones_all on public.team_phones for all to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy call_flows_all on public.call_flows for all to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy call_log_select on public.call_log for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy voicemails_select on public.voicemails for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy voicemails_update on public.voicemails for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'))
  with check (company_id = public.current_company_id());
