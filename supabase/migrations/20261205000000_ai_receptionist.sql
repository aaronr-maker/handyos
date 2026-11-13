-- What the AI receptionist books and asks the office to do: in-home estimates it scheduled, and callbacks it promised.
-- The server writes these; owners, admins and office read and update them.

create table public.ai_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  kind         text not null check (kind in ('estimate', 'callback')),
  status       text not null default 'new' check (status in ('new', 'done', 'cancelled')),
  call_sid     text,
  caller_name  text,
  caller_phone text,
  address      text,
  language     text,
  notes        text,
  -- for a booked estimate: who and when
  seller_id    uuid references public.users (id) on delete set null,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index ai_requests_company_idx on public.ai_requests (company_id, status, created_at desc);
create trigger ai_requests_set_updated_at before update on public.ai_requests for each row execute function public.set_updated_at();
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon;
grant select, update on public.ai_requests to authenticated;
create policy ai_requests_select on public.ai_requests for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
create policy ai_requests_update on public.ai_requests for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'))
  with check (company_id = public.current_company_id());

-- the assistant's own words appear in the call transcript too
alter table public.call_transcripts drop constraint if exists call_transcripts_speaker_check;
alter table public.call_transcripts add constraint call_transcripts_speaker_check check (speaker in ('caller', 'team', 'assistant'));
alter table public.call_transcripts add column if not exists original text;
