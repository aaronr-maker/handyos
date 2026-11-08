-- Calls only ever ring the phone app, never anyone's personal phone number, so the table that held team members' numbers is removed.
drop table if exists public.team_phones;
