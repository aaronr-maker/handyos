# HandyOS: guide for a code reviewer

HandyOS is a multi-tenant field-service app (quotes, jobs, scheduling, invoicing, job costing, pay-for-performance, revenue
reporting, QuickBooks). This guide says where to look first. It was written for a reviewer, so it also lists known gaps.

## Stack
Vite + React 19 + TypeScript PWA, Supabase (Postgres, auth, row-level security), Vercel (static site + `api/` functions).
Run `npm ci && npm run lint && npm test && npm run build`. Tests need no database or network.

## Architecture
- **Modular monolith** (`src/modules/*`). A module may only import another module through its `index.ts`; enforced by ESLint
  (`no-restricted-imports`) and `scripts/check-boundaries.mjs` (part of `npm run lint`). The only place modules are listed is
  `src/app/modules.ts`: removing a module from that list removes its screen and its actions.
- **Core** (`src/core`): typed event bus, action registry, repositories, auth/session, formatting.
- **Actions** (`defineAction`): every write goes through a zod-validated, audited action with `roles`, `risk` and
  `requiresApproval` (AI agents need approval for sensitive ones). Look at `src/core/actions/`.
- **Data**: `createRepo<T>(table)` talks to Supabase when configured, else memory (demo mode and tests).
  Reads page past Supabase's 1,000-row limit.

## Security-sensitive places (review these first)
1. **Row-level security**: `supabase/migrations/*`. Every table has `company_id`; policies use `current_company_id()` and
   `current_user_role()`. Techs are blocked from billing and financial tables.
2. **QuickBooks**: `api/_lib/qb.ts` (OAuth, signed `state`, token refresh rotation), `api/_lib/crypto.ts` (AES-256-GCM token
   storage, key in `INTEGRATIONS_SECRET`), `integration_secrets` (service role only; no policies).
3. **Pushing to QuickBooks**: `api/_lib/qbPush.ts`. Reads settings and sent-records from the database on the server (not
   from the browser); off switches: per-company `enabled` (default off), `QB_PUSH_DISABLED=1`, and a `start_date` that blocks
   old history. Each invoice and payment is sent once (`qb_sync_records`). Only tested against a fake QuickBooks so far.
4. **Headers**: `vercel.json` (HSTS, no-store on `/api/`, no framing).
5. The callback `api/qb/callback.ts` always answers with a 302 (Intuit's rule for URLs carrying a code).

## Money
Integer cents everywhere (`Cents`). Splits use largest-remainder (`splitCents`) so parts add up exactly. See `p4pCalc.ts`,
`rateCalc.ts`, `src/modules/cashplan/calc.ts` (parts always sum to the payment).

## Tests
`tests/*.test.ts` (vitest): parsing of QuickBooks Profit and Loss files, hourly-rate math, P4P, cash plan, revenue grouping,
QuickBooks OAuth and push with a fake network. There are no browser end-to-end tests in the repo (they were run by hand).

## Known gaps (honest list)
- QuickBooks is connected to Intuit's sandbox; production approval has not been done. Pushing invoices has not run against a
  real QuickBooks.
- Sales tax mapping for pushed invoices is untested against a real company; refunds and voids are not synced.
- No scheduled/automatic sync yet (manual "Send" button), no Stripe, no messaging providers.
- No automated browser tests, no load testing, no formal threat model, no vulnerability scan.
- Privacy policy and terms (`src/app/screens/LegalPages.tsx`) are plain-language drafts that need a lawyer before selling.
- Multi-tenant isolation relies on RLS: worth an independent test with two companies.
