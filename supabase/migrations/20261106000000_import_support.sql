-- Import support: remember where a customer came from (e.g. Housecall Pro customer id "hcp:123"),
-- so re-importing the same export never creates duplicates.
alter table public.customers add column external_ref text;
create unique index customers_external_ref_idx on public.customers (company_id, external_ref) where external_ref is not null;
