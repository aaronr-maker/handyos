# HandyOS

Field-service management for handyman companies: quotes, jobs, scheduling, invoicing and job costing.
Built first for **That Handyman Van LLC** (replacing Housecall Pro, Jobber and Workiz), designed so it can be
offered to other companies later.

The product name lives in **one file**: [`src/config/app.ts`](src/config/app.ts). Rename it there and the UI, HTML
title, PWA manifest and Capacitor config all follow.

## Run it

Requires Node 20+ (CI and Vercel use 22).

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run lint` | ESLint **and** the module-boundary check |
| `npm test` | Unit tests (action registry, boundary rules) |
| `npm run preview` | Serve the production build locally |

The app runs in **demo mode** without a database. To connect Supabase, copy `.env.example` to `.env.local` and fill in
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the public anon key only; never the `service_role` key, never commit secrets).

## Architecture: a modular monolith

One deployable app, split into modules with hard walls between them, so a bug fix or upgrade in one area never
forces a rewrite of another.

```
src/
  config/app.ts        App name and identity (single source of truth)
  core/                Shared foundation (public surface: src/core/index.ts)
    events/            Typed event bus + the catalog of every domain event
    actions/           Action registry: validated, audit-logged, approval-gated business actions
    data/              Tenant-scoped repository helper (in-memory for now, Supabase next)
    tenancy/           Current company/user session
    supabase/          Supabase client (null when env vars are missing)
    ui/                Shared UI pieces (icons, placeholder screen)
  modules/
    customers/  estimates/  jobs/  scheduling/  invoicing/  payments/  jobcosting/  messaging/
      index.ts         PUBLIC interface: the module manifest + the few types/functions others may use
      types.ts         The module's own types
      actions.ts       The module's business actions (zod-validated)
      services/        Business logic and data access
      ui/              Screens
  app/                 App shell: routing, bottom tabs (mobile), sidebar (desktop), System screen
supabase/migrations/   Postgres schema + row-level security
```

### Module rules

1. **A module never imports another module's internals.** It may import another module only through that module's
   public `index.ts` (`import { getJob } from '@/modules/jobs'`), or talk to it through the **event bus**.
2. Modules import shared code from `@/core` only (its public index, not deep paths) and never from `src/app`.
3. `src/core` never imports from modules or the app shell.
4. The app shell reaches a module only through its public index (it imports each module's manifest).
5. Within a module, use relative imports.

Enforced two ways, both run by `npm run lint` (and CI):

- ESLint `no-restricted-imports` rules, generated per module in `scripts/eslint-boundaries.js`.
- `scripts/check-boundaries.mjs`, which also resolves relative paths (`../jobs/...`) and dynamic `import()`. It has unit tests in `tests/boundaries.test.ts`.

### Event bus

Modules announce facts and react to each other without knowing about each other. Events are typed in
[`src/core/events/catalog.ts`](src/core/events/catalog.ts) (e.g. `invoice.overdue`, `job.completed`,
`payment.received`). Example already wired: approving an estimate emits `estimate.approved`, the jobs module creates
a job; recording a payment emits `payment.received`, the invoicing module updates the balance. A failing handler
never breaks the sender.

### Action registry (one door for UI and AI agents)

Every business action (create estimate, send invoice, reschedule job, ...) is defined once with `defineAction`:

- a **zod schema** for input (the same schema validates a form and an AI tool call),
- a **risk level** and a **`requiresApproval`** flag (a boolean, or a function such as "only when an AI agent is the actor"),
- a handler that receives the company (tenant) and actor from context, never from user input.

Calling an action (`registry.execute(...)` from UI, `registry.executeByName(...)` from agents) always validates,
checks approval, runs, emits events and writes an **audit entry** (who, what, outcome). Approval-required actions
return `pending_approval` and run only after a human `user` calls `decide(...)`; an agent cannot approve its own request.
Try it live on the **System** screen in the app.

### Multi-tenant from day one

Every record carries `company_id` (`BaseRecord` in code, a column in every table). In code, repositories require a
`companyId` for every read and write. In the database, row-level security restricts every row to the signed-in
user's company, and composite foreign keys make it impossible for a row to reference another company's data.
The initial migration also creates a private `company-files` storage bucket scoped by company folder.

### Company accounts and team access

A company is its own account; people sign in as members of it. Whoever creates the company is the **owner**.

| Role | Can do |
| --- | --- |
| Owner | Everything: company settings, invite/approve anyone, change roles, remove members |
| Admin | Invite/approve **office and tech** members, change/remove office and tech members |
| Office, Tech | Work in the app; cannot manage the team |

People get in two ways: an owner/admin **invites** an email address (the person signs up with that email and accepts),
or the person signs up and asks to join with the company's **join code** and an owner/admin approves. All membership
changes go through database functions (`supabase/migrations/20261103000000_team_access.sql`), so the rules above are
enforced in the database, not just hidden in the UI. Supabase email confirmation should stay on, since invites are matched by email.

### Customers, properties and billing

- A **customer** has a first and last name (or just a company name for a business), and any number of **additional contacts**
  (first/last, phone, email each). The **display name** is a checkbox choice: the person's name, the company name, or a custom
  name, and it picks itself when only one of them is filled in. One contact is the **main contact** (a checkbox); the customer
  is the main contact by default, and a business with no person of its own makes its first additional contact the main one.
- A customer can be flagged as a **property manager**.
- A **property** (address) stands on its own, with dated history of its **owner**, **manager** and **tenant**
  (`property_parties`). The **work belongs to the owner**, who is a customer. A **property manager** represents the
  owner only while the property is a rental. If it is sold or stops being a rental, management ends and the history is kept.
  A managed rental can exist before its owner is known.
- Jobs, estimates and invoices reference the **property**, so records follow the address when it changes hands.
- **Billing rule** (`billingFor` in the customers public index): rentals are billed to the property manager but labeled as
  owed by the owner; with no owner listed the manager owes it; without a manager the owner is billed and owes it.
- **AI upkeep:** agents keep contacts, addresses and tenants current by calling the same `customers.*` actions as the UI.
  Their changes to existing records wait for a person's approval, are audit-logged as made by an agent, and announce
  `customer.updated` events.

### Importing customers

**Customers → Import** takes a CSV export from Housecall Pro (recognised automatically, including its repeated
`Address_N` column groups), Jobber or any customer list. It shows what will happen before anything is saved.
Each customer's old-system id is stored (`external_ref`), so importing the same file twice never duplicates; matching
on phone/email is only used for files without ids (two real customers can share a phone number). A property
manager's addresses become managed rentals with no owner listed yet; everyone else's become properties they own. A
billing-flagged address is kept as a note when the customer has other addresses. Import runs through the
`customers.import` action, so it is validated and audit-logged like everything else. Real customer exports are never
committed to this repository.

### Deleting and merging customers

- A customer can be **deleted only when they have no addresses**, now or in the past (the address history keeps its owners
  and managers). Contacts go with them. The app says why when it can't.
- **Merging duplicates** (Customers, then Duplicates, or from a customer's page): the duplicate's contacts and addresses
  (with their history) move to the kept customer, blank details are filled in, a different phone/email becomes an additional
  contact, notes are combined, and the old record is removed. The duplicate's old-system id is remembered so re-importing
  the same export never brings it back. The merge announces a `customer.merged` event; any module that keeps its own
  records about a customer (jobs, estimates, invoices, messages) must re-point them to the kept customer when it handles that event.
- Both are actions, so an AI agent can propose them but a person must approve.

### Price book and estimates

- The **price book** lists the services, materials and fees you quote from, each with what you charge, what it costs you
  (used later for job costing and pay-for-performance), a unit, and whether it's taxable. Items can be hidden without
  disturbing old estimates.
- An **estimate** gets a number per company (#1001, #1002, ...), line items (from the price book or custom), a tax rate
  (basis points; applies only to taxable lines), an optional "good until" date and notes. Only drafts can be edited; once sent
  the estimate is what the customer saw. Flow: draft, sent, approved or declined (a declined one can be sent again).
- **Billing comes from the property** using the customers module's rule: rentals are billed to the property manager and
  labeled as owed by the owner (the manager owes it when no owner is listed); otherwise the owner is billed.
- **Approving an estimate creates a job** for the same property through the `estimate.approved` event.
- Prices are integer cents everywhere; numbers come from `next_company_number()` in the database so two people creating
  estimates at once never get the same number.

### Jobs, scheduling and the time clock

- A **job** is numbered per company (#1001...), billed through the same property rule as estimates (billed to the manager,
  owed by the owner), and can come from an approved estimate or be created directly for a property or customer.
- **Scheduling** puts a job on the **Schedule** week view (with a "Needs a date" list and a crew filter); moving a job keeps
  its length. The scheduling module changes jobs only through the jobs module's public interface.
- **Crew:** assign team members to a job. **Tech time clock:** clock in / out of a job from the job page. A person can be
  clocked in to one job at a time (enforced by the database), only a real person can clock in or out (an AI agent cannot),
  and completing a job clocks out anyone still on it. Clock events (`timeclock.in` / `timeclock.out`) feed job costing later.
- A shared **customer + property picker** (exported by the customers module) is used wherever work is created, so the
  billing rule is shown the same way everywhere.

### Invoices and payments

- An **invoice** is numbered per company, created for a property or customer (billing follows the same property rule: billed to
  the manager, owed by the owner), or straight from a job (**Invoice this job** copies its estimate's lines, tax and billing).
  Only drafts can be edited; once sent it is what the customer received. Statuses: draft, sent, overdue, paid, void.
- **Payments** (cash, check, card, bank transfer) are recorded against a sent invoice and update its balance and status. A
  payment can never exceed what is owed, a paid invoice can't be voided, and a refund reopens the balance. Payments are stored
  as signed amounts, so the history is a ledger. **Stripe** card payments plug into the same `payments.record` action later.
- **Overdue:** `invoicing.check_overdue` flags every sent invoice past its due date and announces `invoice.overdue` (a daily
  automation will run it; there is also a button on the Invoices screen).
- **Roles** are enforced where actions run, for people and AI agents alike: techs can't touch estimates, invoices, payments or
  prices; office can invoice and take payments; only owners and admins can refund or change prices; only owners and admins
  approve an AI agent's requests. Techs keep jobs and the time clock. The database backs this up: techs can't read
  estimates, invoices, payments or the price book at all, and the menu hides those sections from them.

### Job costing

- Per job: **invoiced** (sent invoices, not drafts or void) and **collected**, versus **cost**: labor from the time clock (hours x each
  person's hourly cost) plus costs you record by hand (materials, subcontractors, dump fees), giving **profit and margin**. If the
  job came from an estimate, what the estimate *expected* it to cost (quantity x the price book's cost) is shown for comparison.
- **Pay rates are private:** only owners and admins can see or set what someone costs per hour (the database enforces it; a
  person can read only their own). Time from someone with no rate set counts as $0 and is flagged.
- Costs and the whole Job costing section are hidden from techs. Pay-for-performance distributions build on these numbers
  (rules to be defined with the owner).

### Pay-for-performance (P4P)

Set up under **Settings, Pay-for-performance** (owner and admins), in four plain steps:

1. **What the pool is based on:** revenue, gross profit (revenue minus materials and other non-labor costs) or net profit (revenue minus all costs including labor).
2. **What the company keeps first:** a protected percent comes off the top; the rest is the pool.
3. **How the pool is shared:** any number of **levels**, each with a name you choose and a percent of the pool. A level is one of:
   a **seller** level (paid to whoever sold the job), a **worker** level (shared by each person's share of the hours on the job: two techs at 5 hours
   each get 50% each, one tech gets all of it), or **supervisor** levels (each paid to whoever the people on the level before it report to, for example
   general foreman, then regional manager). Anything that can't be given to a person (no seller recorded, nobody set as a boss) stays with the company.
4. **Your team:** which level each person is on and who they report to. A "Try it out" box shows what the setup pays on an example job.

A job's payout is a **projection** until the job is completed and fully paid, then an owner or admin **locks it in** (once). Locking in saves a
snapshot, so changing the settings later never rewrites what was already earned. People see their own earnings under **My earnings**; owners and admins
see everyone's under Job costing, Payouts, and can mark them paid. A job with no profit pays nothing. The seller defaults to whoever created the
estimate or job and can be changed. The calculation is plain, tested code (`p4pCalc.ts`) with no money rounding drift: every cent is accounted for.

### Database (Supabase)

`supabase/migrations/` holds the schema; run the files in order. `20261102000000_initial_schema.sql` creates companies (tenants), users, customers, properties,
estimates, jobs, invoices and an append-only audit log, all with RLS. Apply it with the Supabase CLI
(`supabase link --project-ref <ref> && supabase db push`) or paste it into the Supabase SQL editor. The modules
currently use in-memory repositories; swapping them to Supabase is a change inside each module's `services/` only.

### Installable app and app stores

- **PWA**: installable to a phone's home screen, offline-capable shell (`vite-plugin-pwa`).
- **Capacitor**: `capacitor.config.ts` is in place; native projects are not generated yet. When ready:
  `npm run build && npx cap add ios && npx cap add android && npx cap sync`.

### Deploying (Vercel)

Import the repo in Vercel; `vercel.json` sets the build (`npm run build`, output `dist/`), SPA routing and cache
headers. Every pull request gets a preview link. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the
Vercel project's environment variables when the database is connected.

## Roadmap

1. ~~**Customers**: login, team access, contacts, properties, import, merge~~ (done)
2. **Estimates + price book**: price book and estimates done; next, a customer-facing approval link and PDF/print
3. ~~**Jobs, scheduling, tech clock in/out**~~ (done; next: tech-friendly mobile polish, photos, job checklists)
4. **Invoicing + payments**: invoices and manual payments are done; next, Stripe card payments and a customer-facing pay link
5. **Job costing + pay-for-performance (P4P) distributions**: job costing and P4P done
6. **Messaging**; then AI agents for error triage and customer support on top of the action registry

### Company hourly rate and the QuickBooks connection

The Profit and Loss also brings in the **income accounts** for each month (stored in `income_lines`, shown at the top of the P&L, never counted as costs).
Other modules read them with `monthlyIncome(companyId)` from `@/modules/jobcosting` (income and other income per month) for revenue per man-hour,
margins, and comparing what came in with what it cost.

**Job costing, then Company hourly rate** (owner and admins):

1. **Bring in costs.** Choose QuickBooks' **Profit and Loss by Month** report (cash basis; the Excel file or a CSV both work, read in the browser), which
   has a column per month, or connect QuickBooks and pull the months. Each account is sorted into *wages*, *payroll tax*, *other running costs* or
   *not counted* (cost of goods sold, job materials and non-operating items start as not counted so nothing is double counted). Choices are remembered per
   account, so the next import sorts itself. Two accounts with the same name in different places are kept apart.
2. **Choose the months to average** (usually the last 3 full months; part months are marked and left out by default).
3. A **QuickBooks-style Profit and Loss** shows the combined months (sections, indented groups, "Total for" lines, Gross Profit, Net Income, each account's
   tick box on each account, group and section), followed by what counts toward the hourly cost and a **check against QuickBooks' own printed totals** (a green tick per section).
4. **Man-hours**, either from the **time clock** (or hours typed per month, for months before the clock was in use), or from the **crew's schedule**:
   people x days a week x hours a day x **working weeks** (a year has 52 weeks, the crew works about 50), spread over the months.
5. The **cost per man-hour** is the months' combined counted costs divided by their combined hours (so a busy month counts for more than a quiet one), with
   the **hourly price** at your target margin and **where each hour's cost goes** (wages, payroll tax, other costs: the share of every job payment that keeps
   payroll funded).
6. Optionally, job costing then values labor at that hourly cost instead of each person's own pay rate.

**How the QuickBooks connection works.** Each company links its *own* QuickBooks (a standard "Connect to QuickBooks" sign-in; read-only, nothing is
written to QuickBooks). It needs a small server piece, which runs as Vercel functions in `api/` (deployed automatically with the site). Tokens are
encrypted before they are stored and can't be read from the app (only the server's service key can); the browser only ever sees the connection's
status and the cost accounts pulled for review. Connect, pull and disconnect are limited to owners and admins.

**One-time setup (the owner does this once; each customer company then just clicks Connect):**

1. Create a free developer account at developer.intuit.com, then **Dashboard, Create an app**, choose *QuickBooks Online and Payments*, and select
   the **Accounting** scope. Under **Keys and credentials** you will find a Client ID and Client Secret (start with the *Development* keys).
2. In the same place add this **Redirect URI**: `https://YOUR-SITE.vercel.app/api/qb/callback` (use your real address).
3. In Vercel (Project, Settings, Environment Variables) add the server-only variables listed in `.env.example`:
   `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `INTUIT_REDIRECT_URI`, `INTUIT_ENV` (`sandbox`), `APP_URL`, `INTEGRATIONS_SECRET` (any long random
   string) and `SUPABASE_SERVICE_ROLE_KEY` (Supabase, Project Settings, API Keys, the *secret* / service_role key). Mark the secrets as Sensitive.
   Never give any of these a `VITE_` prefix, which would expose them in the browser.
4. Redeploy. The Company hourly rate screen then shows **Connect QuickBooks**.

Development keys only connect to Intuit's **sandbox** test companies. To connect real QuickBooks files (yours and other companies'), Intuit requires the
app to pass its production review (privacy policy, terms of service and a short security questionnaire), after which you switch to the *Production*
keys and set `INTUIT_ENV=production`. Check Intuit's current requirements on developer.intuit.com when you get there.

### Planned: cash distribution and the wider integrations plan (decisions so far)

- **Burdened cost rate** = last month's total company costs (from QuickBooks, by the accounts the owner marks as overhead) divided by the man-hours
  clocked that same month. Job costing applies it to each job's hours; a target margin on top gives the **hourly price** (shop rate).
- **Wages and payroll tax** come from QuickBooks (Gusto feeds payroll into it), not typed into the app. Their share of total cost tells the owner what
  percent of each hourly cost needs to flow into the wages account as jobs are paid. Per-person wages are optional; Gusto's own API may be partner-only and
  needs checking before we depend on it.
- **Cash plan** (built): when a job is paid it suggests where the money goes: sales tax, materials, wages, payroll tax, running costs, the P4P pool, the
  company reserve, and what's left. Each payment pays its share of the job's costs. It only suggests; the owner moves money manually. The
  per-job numbers come from `jobEconomics()` in the job costing module; the split is `planPayment()` in `src/modules/cashplan`.
- **Integrations foundation** first: a small server piece (Supabase Edge Functions) to hold secrets, handle QuickBooks sign-in and scheduled syncs. Stripe,
  messaging and the AI agents need the same piece.
