-- Company hourly rate refinements:
--  * the accounting method used when pulling from QuickBooks (cash or accrual); this company uses cash
--  * where each account sits in QuickBooks ("Supplies > Supplies & materials"), so two accounts with the same name in
--    different places (for example one under Cost of Goods Sold and one under Expenses) are kept apart.
alter table public.company_rate_settings
  add column accounting_method text not null default 'cash' check (accounting_method in ('cash', 'accrual'));
alter table public.overhead_lines
  add column group_path text not null default '';

-- Which part of the Profit and Loss an account came from (cogs, expense, other_expense), or 'manual' if typed in.
alter table public.overhead_lines
  add column section text not null default 'expense' check (section in ('cogs', 'expense', 'other_expense', 'manual'));
