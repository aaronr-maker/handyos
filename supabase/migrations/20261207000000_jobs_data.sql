-- Jobs data: the history brought in from the old system's reports (jobs, invoices, payments, hours, per-person summaries), kept
-- apart from the live jobs and invoices so it never mixes with them. Client emails and phone numbers are not stored.
-- Only owners and admins can see or change it.

create table public.history_jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  source           text not null default 'jobber',
  job_number       int not null,
  client_name      text,
  lead_source      text,
  service_address  text,
  title            text,
  created_on       date,
  scheduled_on     date,
  closed_on        date,
  salesperson      text,
  crew             text,
  line_items       text,
  invoice_numbers  text,
  quote_number     text,
  revenue_cents    bigint not null default 0,
  cost_cents       bigint not null default 0,
  labour_cost_cents bigint not null default 0,
  profit_cents     bigint not null default 0,
  hours_tracked    numeric not null default 0,
  budget_hours     numeric not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, source, job_number)
);
create table public.history_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  source          text not null default 'jobber',
  invoice_number  int not null,
  client_name     text,
  lead_source     text,
  subject         text,
  created_on      date,
  issued_on       date,
  due_on          date,
  paid_on         date,
  days_to_pay     int,
  salesperson     text,
  status          text,
  job_numbers     text,
  subtotal_cents  bigint not null default 0,
  total_cents     bigint not null default 0,
  balance_cents   bigint not null default 0,
  tax_cents       bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, source, invoice_number)
);
create table public.history_payments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  source         text not null default 'jobber',
  external_key   text not null,
  client_name    text,
  paid_on        date,
  kind           text,
  method         text,
  total_cents    bigint not null default 0,
  fee_cents      bigint not null default 0,
  invoice_number text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, source, external_key)
);
create table public.history_job_hours (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  source      text not null default 'jobber',
  job_number  int not null,
  hours       numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, source, job_number)
);
-- per-person summaries (salesperson performance, team productivity) and the report's overall hours figure
create table public.history_people (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  source      text not null default 'jobber',
  report      text not null check (report in ('salespeople', 'productivity', 'timesheet_total')),
  person      text not null default '',
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, source, report, person)
);

do $$
declare t text;
begin
  foreach t in array array['history_jobs', 'history_invoices', 'history_payments', 'history_job_hours', 'history_people'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin'')) with check (company_id = public.current_company_id())', t || '_owner_admin', t);
  end loop;
end $$;
