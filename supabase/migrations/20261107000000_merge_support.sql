-- Merging duplicate customers: when customer B is merged into A, B's old-system id(s) are remembered on A,
-- so re-importing the same export does not bring B back.
alter table public.customers add column merged_external_refs text[] not null default '{}';
