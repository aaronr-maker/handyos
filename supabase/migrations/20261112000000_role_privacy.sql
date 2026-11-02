-- Techs work from jobs and the time clock. They don't need prices, estimates, invoices or payments, so the database
-- doesn't hand those to them (the app also hides them). Owners, admins and office staff are unaffected.
do $$
declare t text;
begin
  foreach t in array array['estimates', 'invoices', 'payments', 'price_book_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id = public.current_company_id() and public.current_user_role() <> ''tech'')',
      t || '_select', t
    );
  end loop;
end $$;
