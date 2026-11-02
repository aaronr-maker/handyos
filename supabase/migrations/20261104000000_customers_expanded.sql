-- Customers: display name, company name, additional contacts, property-manager flag.
-- Properties: stand-alone records with dated history of who the owner, manager and tenant were,
-- so an address can change hands (sold, no longer a rental) and its records follow the address.
-- The work belongs to the property OWNER (a customer); the owner may be represented by a property MANAGER
-- (also a customer) for as long as the property is a rental.
-- Rentals are billed to the manager but labeled as owed by the owner (manager owes if no owner is listed).
-- A customer has a main contact (customers.name / phone / email) plus any number of additional contacts.
-- Any one of them can be the "display contact" shown in lists: customers.display_contact_id points at an
-- additional contact, or is null to mean the main contact.

alter table public.customers
  add column display_name text,
  add column company_name text,
  add column is_property_manager boolean not null default false;


create table public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  customer_id  uuid not null,
  name         text not null,
  phone        text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers (company_id, id) on delete cascade
);
create index customer_contacts_company_id_idx on public.customer_contacts (company_id);
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);
create trigger customer_contacts_set_updated_at before update on public.customer_contacts
  for each row execute function public.set_updated_at();

alter table public.customers add column display_contact_id uuid;
alter table public.customers
  add constraint customers_display_contact_fk foreign key (company_id, display_contact_id)
  references public.customer_contacts (company_id, id) on delete set null (display_contact_id);

alter table public.customer_contacts enable row level security;
create policy customer_contacts_select on public.customer_contacts for select to authenticated using (company_id = public.current_company_id());
create policy customer_contacts_insert on public.customer_contacts for insert to authenticated with check (company_id = public.current_company_id());
create policy customer_contacts_update on public.customer_contacts for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy customer_contacts_delete on public.customer_contacts for delete to authenticated using (company_id = public.current_company_id());

revoke all on public.customer_contacts from anon;
grant select, insert, update, delete on public.customer_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- Properties stand on their own. A property's records (jobs, estimates, invoices) hang off property_id,
-- so they stay with the address when it moves to another customer.
-- ---------------------------------------------------------------------------

-- A customer can no longer be deleted out from under their properties. properties.customer_id is the current owner.
alter table public.properties drop constraint properties_company_id_customer_id_fkey;
alter table public.properties add foreign key (company_id, customer_id) references public.customers (company_id, id);
-- A managed rental can exist before its owner is known, so customer_id (the current owner) may be empty.
alter table public.properties alter column customer_id drop not null;

alter table public.estimates add column property_id uuid;
alter table public.estimates add foreign key (company_id, property_id) references public.properties (company_id, id);
alter table public.invoices add column property_id uuid;
alter table public.invoices add foreign key (company_id, property_id) references public.properties (company_id, id);
-- Billing rule: invoices.customer_id is who is BILLED. For a managed rental that is the property manager,
-- and owed_by_customer_id is the owner it is labeled as owed by (the manager itself when no owner is listed).
alter table public.invoices add column owed_by_customer_id uuid;
alter table public.invoices add foreign key (company_id, owed_by_customer_id) references public.customers (company_id, id);
create index estimates_property_idx on public.estimates (property_id);
create index invoices_property_idx on public.invoices (property_id);
create index jobs_property_idx on public.jobs (property_id);

create type public.party_role as enum ('owner', 'manager', 'tenant');

-- History of who held each role at a property. A row with ended_on null is the current one.
-- owner and manager point at customer records; tenant is free text (name / company / phone / email).
-- properties.customer_id always mirrors the current 'owner' row (kept in sync by the app).
-- No current manager row = not a rental / not managed.
create table public.property_parties (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  property_id   uuid not null,
  role          public.party_role not null,
  customer_id   uuid,
  name          text,
  company_name  text,
  phone         text,
  email         text,
  started_on    date not null default current_date,
  ended_on      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, property_id) references public.properties (company_id, id) on delete cascade,
  foreign key (company_id, customer_id) references public.customers (company_id, id),
  check (role = 'tenant' or customer_id is not null),
  check (role <> 'tenant' or name is not null or company_name is not null),
  check (ended_on is null or ended_on >= started_on)
);
create unique index property_parties_one_current_idx on public.property_parties (property_id, role) where ended_on is null;
create index property_parties_company_idx on public.property_parties (company_id);
create index property_parties_property_idx on public.property_parties (property_id);
create trigger property_parties_set_updated_at before update on public.property_parties
  for each row execute function public.set_updated_at();

-- Existing properties get their first 'owner' history row.
insert into public.property_parties (company_id, property_id, role, customer_id, started_on)
  select company_id, id, 'owner', customer_id, created_at::date from public.properties;

alter table public.property_parties enable row level security;
create policy property_parties_select on public.property_parties for select to authenticated using (company_id = public.current_company_id());
create policy property_parties_insert on public.property_parties for insert to authenticated with check (company_id = public.current_company_id());
create policy property_parties_update on public.property_parties for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy property_parties_delete on public.property_parties for delete to authenticated using (company_id = public.current_company_id());
revoke all on public.property_parties from anon;
grant select, insert, update, delete on public.property_parties to authenticated;
