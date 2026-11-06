-- Live call transcripts, the AI summary of each call, and the prompt shown on the call screen.
-- The transcription server writes transcript lines and summaries; owners, admins and office read them.

alter table public.call_settings
  add column script text not null default E'Greet them: "That Handyman Van, this is ___."\nGet their name and the best number to reach them.\nGet the service address.\nWhat is the problem or the job? Anything urgent or unsafe?\nWhen do they need it done?\nRepeat the details back and say when we will follow up.';

alter table public.call_log add column summary text;

create table public.call_transcripts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  call_sid    text not null,
  -- who was talking: the customer who called, or our team member who answered
  speaker     text not null check (speaker in ('caller', 'team')),
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index call_transcripts_call_idx on public.call_transcripts (company_id, call_sid, created_at);

create trigger call_transcripts_set_updated_at before update on public.call_transcripts for each row execute function public.set_updated_at();
alter table public.call_transcripts enable row level security;
revoke all on public.call_transcripts from anon;
grant select on public.call_transcripts to authenticated;
create policy call_transcripts_select on public.call_transcripts for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin', 'office'));
