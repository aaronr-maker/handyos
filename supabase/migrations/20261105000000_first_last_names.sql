-- First and last names for individuals (customers, additional contacts, tenants).
-- The existing "name" columns stay as the full name (or the business name when there is no first/last),
-- so searches, lists and imports keep working. The app fills "name" from first + last.
alter table public.customers         add column first_name text, add column last_name text;
alter table public.customer_contacts add column first_name text, add column last_name text;
alter table public.property_parties  add column first_name text, add column last_name text;

-- Which name is shown for a customer: the person's name, the company name, or a custom display name.
alter table public.customers
  add column display_name_source text not null default 'person'
  check (display_name_source in ('person', 'company', 'custom'));
