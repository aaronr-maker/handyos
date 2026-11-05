-- What Handy costs to run: one row per voice call and per typed answer, with the tokens and (for calls) the seconds, plus the
-- prices the owner reads off OpenAI's pricing page so the app can show an estimate. Tokens only; no words are kept here.
create table public.handy_usage (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  kind           text not null check (kind in ('voice', 'text')),
  seconds        int not null default 0,
  text_in        bigint not null default 0,
  text_out       bigint not null default 0,
  audio_in       bigint not null default 0,
  audio_out      bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index handy_usage_idx on public.handy_usage (company_id, created_at);

create table public.handy_settings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null unique references public.companies (id) on delete cascade,
  -- dollars per million tokens, as OpenAI's pricing page lists them
  rates       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['handy_usage', 'handy_settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
grant select, insert on public.handy_usage to authenticated;
grant select, insert, update on public.handy_settings to authenticated;

create policy handy_usage_select on public.handy_usage for select to authenticated
  using (company_id = public.current_company_id() and (user_id = auth.uid() or public.current_user_role() in ('owner', 'admin')));
create policy handy_usage_insert on public.handy_usage for insert to authenticated
  with check (company_id = public.current_company_id() and user_id = auth.uid());
create policy handy_settings_select on public.handy_settings for select to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy handy_settings_insert on public.handy_settings for insert to authenticated
  with check (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'));
create policy handy_settings_update on public.handy_settings for update to authenticated
  using (company_id = public.current_company_id() and public.current_user_role() in ('owner', 'admin'))
  with check (company_id = public.current_company_id());
