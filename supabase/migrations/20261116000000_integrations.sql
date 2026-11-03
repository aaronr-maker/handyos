-- Connections to outside services (QuickBooks now; Stripe, Gusto and others later). One per company per provider.
-- integration_links holds the harmless status (who connected, when, which QuickBooks company) and can be read by owners/admins.
-- integration_secrets holds the encrypted access tokens. NOBODY can read it from the app: only the server (service role) touches it.

create table public.integration_links (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  provider      text not null check (provider in ('quickbooks')),
  status        text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  external_id   text,
  label         text,
  connected_by  uuid references public.users (id) on delete set null,
  connected_at  timestamptz not null default now(),
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, provider)
);
create trigger integration_links_set_updated_at before update on public.integration_links
  for each row execute function public.set_updated_at();

create table public.integration_secrets (
  company_id        uuid not null references public.companies (id) on delete cascade,
  provider          text not null check (provider in ('quickbooks')),
  secret_encrypted  text not null,
  access_expires_at timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (company_id, provider)
);

alter table public.integration_links enable row level security;
alter table public.integration_secrets enable row level security;

create policy integration_links_select on public.integration_links for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));

revoke all on public.integration_links, public.integration_secrets from anon, authenticated;
grant select on public.integration_links to authenticated;
-- (no policies on integration_secrets and no grants: only the service role, which bypasses these rules, can use it)
