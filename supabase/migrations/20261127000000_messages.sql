-- Messages to and from customers, kept with the customer. A message is 'queued' until a sending service (email or text) is
-- connected and delivers it; the status then moves to 'sent' or 'failed'. Nothing is shown as sent that was not.
create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  customer_id   uuid not null,
  channel       text not null check (channel in ('sms', 'email')),
  direction     text not null check (direction in ('outbound', 'inbound')),
  body          text not null,
  status        text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_ref  text,
  error         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (company_id, customer_id) references public.customers (company_id, id) on delete cascade
);
create index messages_customer_idx on public.messages (company_id, customer_id, created_at);
create trigger messages_set_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

alter table public.messages enable row level security;
revoke all on public.messages from anon;
grant select, insert, update on public.messages to authenticated;
-- Owners, admins and office staff handle customer messages; techs see none.
create policy messages_select on public.messages for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy messages_insert on public.messages for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy messages_update on public.messages for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'))
  with check (company_id = public.current_company_id());
