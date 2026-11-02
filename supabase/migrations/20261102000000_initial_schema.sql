-- HandyOS initial schema.
-- Multi-tenant: every business table has company_id, and row-level security (RLS) restricts
-- every read and write to the signed-in user's own company. Money is integer cents.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'admin', 'office', 'tech');
create type public.estimate_status as enum ('draft', 'sent', 'approved', 'declined');
create type public.job_status as enum ('unscheduled', 'scheduled', 'in_progress', 'completed');
create type public.invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'void');
create type public.actor_kind as enum ('user', 'agent', 'system');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tenants and users
-- ---------------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per person who can sign in; id matches auth.users.id.
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  full_name   text not null default '',
  role        public.user_role not null default 'tech',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index users_company_id_idx on public.users (company_id);

-- The signed-in user's company. SECURITY DEFINER so policies on public.users can use it without recursion.
create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.users where id = auth.uid()
$$;

create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

-- Onboarding: a freshly signed-up user creates their company and becomes its owner.
create or replace function public.create_company_for_user(company_name text, owner_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_company uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.users where id = auth.uid()) then raise exception 'User already belongs to a company'; end if;
  insert into public.companies (name) values (company_name) returning id into new_company;
  insert into public.users (id, company_id, full_name, role) values (auth.uid(), new_company, owner_name, 'owner');
  return new_company;
end $$;

-- ---------------------------------------------------------------------------
-- Business tables. (company_id, id) is unique so child rows can use composite foreign keys,
-- which makes it impossible for a row to point at another company's record.
-- ---------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id)
);
create index customers_company_id_idx on public.customers (company_id);

create table public.properties (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  customer_id    uuid not null,
  address_line1  text not null,
  city           text not null default '',
  state          text not null default '',
  postal_code    text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers (company_id, id) on delete cascade
);
create index properties_company_id_idx on public.properties (company_id);

create table public.estimates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  customer_id  uuid not null,
  title        text not null,
  status       public.estimate_status not null default 'draft',
  line_items   jsonb not null default '[]'::jsonb,
  total_cents  bigint not null default 0 check (total_cents >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers (company_id, id)
);
create index estimates_company_id_idx on public.estimates (company_id);

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  customer_id      uuid not null,
  property_id      uuid,
  estimate_id      uuid,
  title            text not null,
  status           public.job_status not null default 'unscheduled',
  scheduled_start  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers (company_id, id),
  foreign key (company_id, property_id) references public.properties (company_id, id),
  foreign key (company_id, estimate_id) references public.estimates (company_id, id)
);
create index jobs_company_id_idx on public.jobs (company_id);
create index jobs_scheduled_start_idx on public.jobs (company_id, scheduled_start);

create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  customer_id        uuid not null,
  job_id             uuid,
  status             public.invoice_status not null default 'draft',
  total_cents        bigint not null default 0 check (total_cents >= 0),
  amount_paid_cents  bigint not null default 0 check (amount_paid_cents >= 0),
  due_date           date not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers (company_id, id),
  foreign key (company_id, job_id) references public.jobs (company_id, id)
);
create index invoices_company_id_idx on public.invoices (company_id);

-- Append-only record of every business action (who, what, outcome). Written by the action registry.
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  actor_kind   public.actor_kind not null,
  actor_id     text not null,
  action       text not null,
  outcome      text not null,
  input        jsonb,
  output       jsonb,
  error        text,
  approval_id  uuid,
  created_at   timestamptz not null default now()
);
create index audit_log_company_created_idx on public.audit_log (company_id, created_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['companies','users','customers','properties','estimates','jobs','invoices'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: a user only ever sees and writes rows of their own company.
-- ---------------------------------------------------------------------------
alter table public.companies  enable row level security;
alter table public.users      enable row level security;
alter table public.customers  enable row level security;
alter table public.properties enable row level security;
alter table public.estimates  enable row level security;
alter table public.jobs       enable row level security;
alter table public.invoices   enable row level security;
alter table public.audit_log  enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (id = public.current_company_id());
create policy companies_update on public.companies for update to authenticated
  using (id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (id = public.current_company_id());

create policy users_select on public.users for select to authenticated
  using (company_id = public.current_company_id());
create policy users_update on public.users for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
-- User rows are created by create_company_for_user() or by the server (invites); there is no client insert policy.

-- Generic company-scoped full access for the core business tables.
do $$
declare t text;
begin
  foreach t in array array['customers','properties','estimates','jobs','invoices'] loop
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.current_company_id())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id = public.current_company_id())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (company_id = public.current_company_id())', t || '_delete', t);
  end loop;
end $$;

-- Audit log: members can read their company's log and append to it. No update/delete policy = immutable from the app.
create policy audit_log_select on public.audit_log for select to authenticated
  using (company_id = public.current_company_id());
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (company_id = public.current_company_id());

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update, delete on public.audit_log from authenticated;
grant execute on function public.create_company_for_user(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for job photos / documents, folders are "<company_id>/...".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('company-files', 'company-files', false)
on conflict (id) do nothing;

create policy company_files_select on storage.objects for select to authenticated
  using (bucket_id = 'company-files' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy company_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-files' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy company_files_update on storage.objects for update to authenticated
  using (bucket_id = 'company-files' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy company_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-files' and (storage.foldername(name))[1] = public.current_company_id()::text);
