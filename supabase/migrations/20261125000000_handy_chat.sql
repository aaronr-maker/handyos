-- Conversations with Handy, kept in the company's own database (the AI provider keeps nothing).
-- A person sees their own conversations; owners and admins can see everyone's, because Handy can change things.
create table public.handy_threads (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  title       text not null default 'New chat',
  -- what the chat was opened about (an alert, a job), so it can be picked up again
  context     jsonb not null default '{}',
  -- the placeholder for each real name, phone and address used in this chat ("Customer 1" -> the real name),
  -- so the same person keeps the same placeholder from one message to the next
  mask_map    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index handy_threads_user_idx on public.handy_threads (company_id, user_id, updated_at desc);

create table public.handy_messages (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  thread_id   uuid not null references public.handy_threads (id) on delete cascade,
  user_id     uuid not null,
  -- user: what the person said; assistant: what Handy said; action: what Handy did or was asked to do
  role        text not null check (role in ('user', 'assistant', 'action')),
  content     text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index handy_messages_thread_idx on public.handy_messages (company_id, thread_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['handy_threads', 'handy_messages'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create policy handy_threads_select on public.handy_threads for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy handy_threads_insert on public.handy_threads for insert to authenticated
  with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy handy_threads_update on public.handy_threads for update to authenticated
  using (company_id = public.current_company_id() and user_id = auth.uid()) with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy handy_threads_delete on public.handy_threads for delete to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));

create policy handy_messages_select on public.handy_messages for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy handy_messages_insert on public.handy_messages for insert to authenticated
  with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy handy_messages_delete on public.handy_messages for delete to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
