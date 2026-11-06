-- The short message every caller hears first, before the call tree starts (leave empty to play none).
alter table public.call_settings
  add column notice text not null default 'Thanks for calling That Handyman Van. Calls are recorded for note taking purposes. Please wait while you are connected.';
