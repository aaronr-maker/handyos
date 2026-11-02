-- Company hourly rate (burdened labor rate).
-- Each month: total company costs (from QuickBooks, as an imported Profit & Loss now and the live connection later)
-- divided by the man-hours clocked that month = cost per hour. A target margin on top gives the hourly price.
-- Only owners and admins can see or change any of this.

create table public.overhead_months (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  source      text not null default 'manual' check (source in ('manual', 'quickbooks_csv', 'quickbooks_api')),
  -- Man-hours to divide by, in minutes. Normally the time clock total for the month; can be entered by hand
  -- (for example for months before the time clock was in use).
  hours_minutes        integer check (hours_minutes is null or hours_minutes >= 0),
  hours_from_clock     boolean not null default true,
  -- The result for the month, saved so job costing can use it (the accounts behind it stay owner/admin only).
  cost_per_hour_cents  bigint check (cost_per_hour_cents is null or cost_per_hour_cents >= 0),
  imported_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, month)
);

-- One row per account for a month. category says how it counts toward the hourly cost.
--   wages / payroll_tax: payroll (counted in the rate, and tracked to work out the wages share)
--   overhead: every other running cost (counted)
--   excluded: not counted (e.g. materials that are already charged to each job, or non-operating items)
create table public.overhead_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  month_id      uuid not null,
  account_name  text not null,
  amount_cents  bigint not null,
  category      text not null check (category in ('wages', 'payroll_tax', 'overhead', 'excluded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, month_id) references public.overhead_months (company_id, id) on delete cascade
);
create index overhead_lines_month_idx on public.overhead_lines (company_id, month_id);

-- Remembers how each account was categorized, so next month's import is sorted automatically.
create table public.cost_account_map (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  account_name  text not null,
  category      text not null check (category in ('wages', 'payroll_tax', 'overhead', 'excluded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, account_name)
);

create table public.company_rate_settings (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null unique references public.companies (id) on delete cascade,
  target_margin_bps   integer not null default 3000 check (target_margin_bps between 0 and 9500),
  -- when on, job costing values labor at the company hourly cost instead of each person's own pay rate
  use_in_job_costing  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['overhead_months', 'overhead_lines', 'cost_account_map', 'company_rate_settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin''))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin'')) with check (company_id = public.current_company_id())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (company_id = public.current_company_id() and public.current_user_role() in (''owner'', ''admin''))', t || '_delete', t);
  end loop;
end $$;

-- Job costing (office staff too) needs the resulting hourly cost and the settings, but not the accounts behind it.
drop policy overhead_months_select on public.overhead_months;
create policy overhead_months_select on public.overhead_months for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
drop policy company_rate_settings_select on public.company_rate_settings;
create policy company_rate_settings_select on public.company_rate_settings for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
