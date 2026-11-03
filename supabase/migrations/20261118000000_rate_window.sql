-- Company hourly rate over several months (usually 3), with hours from the time clock or from the crew's schedule.
--  * rate_months: which months are averaged. The rate is their combined counted costs divided by their combined man-hours.
--  * hours_mode: 'clock' (time clock totals, or hours typed in per month) or 'capacity' (people x days a week x hours a day
--    x working weeks, spread over the months).
--  * working_weeks: weeks worked in a year (50: a year has 52 weeks, but the crew does not work all of them).
--  * cost_per_hour_cents: the resulting rate, saved so job costing can use it.
alter table public.company_rate_settings
  add column rate_months          text[]  not null default '{}',
  add column hours_mode           text    not null default 'clock' check (hours_mode in ('clock', 'capacity')),
  add column crew_people          integer check (crew_people is null or crew_people between 0 and 1000),
  add column crew_days_per_week   numeric(3, 1) check (crew_days_per_week is null or crew_days_per_week between 0 and 7),
  add column crew_hours_per_day   numeric(4, 1) not null default 8 check (crew_hours_per_day between 0 and 24),
  add column working_weeks        integer not null default 50 check (working_weeks between 1 and 52),
  add column cost_per_hour_cents  bigint check (cost_per_hour_cents is null or cost_per_hour_cents >= 0);
