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

### Time tracking: the day, the job and the task

The **timetrack** module (`src/modules/timetrack`, migration `20261123000000_time_tracking.sql`) tracks time at three levels. The **day clock** (shift) is what
the company pays for and, with the job time, will give each tech's utilization (drive and shop time is company overhead). The **job clock** is the existing
one in the jobs module. **Task timers** measure one task of the job (made from the estimate's service lines, or added by hand); only one runs per person, and it
stops with the job time. A job's time is each tech's direct task time plus **overhead** (customer, cleanup, time between tasks), and the overhead is shared evenly
across the tasks that tech timed (or all the job's tasks when they timed none), then every tech is added together (`splitJobTime`). Each tech edits only their own
punches (others show greyed out); office, admins and owners can correct anyone's. Every edit keeps the old value, who changed it and why ("edited by AB").
Cross-checks flag forgotten clocks, overlaps, timers outside the job and multi-task jobs with no task timing (`checkJobTime`).

**Arrival reminders (geofencing).** A tech agrees on the My time screen, and jobs can have a location (`job_sites`). While the web app is open it offers to start job time on
arrival. Reminders with the app closed need the native phone app (Capacitor) with a background-location plugin and the tech's permission on their phone: that
part is not built yet, and the check lives in one place (`useArrival`) so the native version can replace it. Check your state's rules on employee location tracking.

**Timesheets** (`src/modules/timesheets`): each person's week, Monday to Sunday, day by day, with the same editable punches ("edited by AB"). Admins and owners can
open and correct anyone's week; everyone else sees and edits only their own. It shows hours clocked, the scheduled time still ahead this week, the person's
**efficiency rate** (their time on jobs finished in the last 90 days divided by the time scheduled for them; 1.00 until they have 3 such jobs) and the **projected
week** = clocked + scheduled ahead × efficiency rate. Over 40 hours turns red (`WEEK_LIMIT_MINUTES`).

**To-do** (the manager desk, `src/modules/desk`, migration `20261124000000_desk_alerts.sql`): alerts for a person projected over the limit (or a clock left running), and
tasks such as scheduled jobs nobody is assigned to. "Handy suggests" a fix with a button for each: move the latest upcoming jobs to people who are free then and
stay under the limit (`suggestReassignments`), or assign a free person. The suggestions are rule-based today, not an AI model. The to-do page is a checklist: tick an item when it is handled. While the app is open, HandyOS checks everyone's week every few minutes, shows each new alert once as a
popup, and puts the open count on the menu. (Modules can add a menu `Badge` and an always-on `Overlay` through their manifest.) Reaching a manager when the app is
closed needs a scheduled job and a messaging provider, which are not set up yet.

**Standard times** (`src/modules/timetrack/standards.ts`, page at `/time/standards` for owners and admins): how long each service takes per unit (minutes per foot, per each...), learned from the company's own
jobs. A task a tech timed gives the time directly (measured). A job where no task was timed gives one equation (all the time on the job = quantities x times + overhead per visit); those are solved together
by non-negative least squares (`nnls`), so a door-only job anchors the door and a gutters-and-door job then gives the gutters, as in the example. Each service shows how many jobs it rests on, the spread,
and a confidence (solid, getting there, learning); measured and inferred times that disagree by more than a third are flagged; finished jobs far from what the standards predict are listed as jobs that don't
fit; and each tech's timed tasks are compared with the standards (their speed). It is advisory: nothing uses these numbers for prices or pay yet.

**Dashboard** (`src/modules/dashboard`, owners and admins): the numbers that matter on one page for the last 30 days against the 30 before: sales (close rate, estimates sent, average job sold, a seller leaderboard),
production (booked work ahead in crew-weeks, time on jobs against paid time, revenue per man-hour against the cost per hour, a tech list with efficiency rates), profit (what finished jobs kept against the target margin)
and cash (owed, overdue, days to get paid). Each has a target and a green/amber/red status. At the top it names **the constraint**, the first stage, from work coming in to money coming back, that is holding the business
back (`findConstraint` in `kpis.ts`): a full schedule is capacity; an empty one is sales (estimates not closing) or leads (not enough estimates); thin profit is pricing and efficiency; slow money is cash. It
says so plainly when there is not enough data. The targets are common starting points (`TARGETS`) and can be changed in one place.

**Coming next (originally):** standard times per service per unit learned from these timers (and from single-service jobs), efficiency and pace, and the constraint dashboard.

### Sending invoices and payments to QuickBooks

The **QuickBooks sync** module (`src/modules/qbsync`, server code in `api/_lib/qbPush.ts`, `api/qb/push.ts`, `api/qb/setup.ts`; migration
`20261121000000_qb_sync.sql`) sends HandyOS invoices and payments into the connected QuickBooks: customer, lines, sales tax, and payments linked to their
invoice. It starts **off**. The owner chooses the income account, an optional deposit account and sales tax code, and a start date (default January 1,
2027, so old history is never sent); each item is sent once. Off switches: untick "Sending is on", set `QB_PUSH_DISABLED=1` on the server, or remove
`qbsyncModule` from `src/modules.ts`. Refunds and voids are not synced. Needs the same Intuit production approval as pulling the real books.
Reviewer notes: [docs/REVIEWER_GUIDE.md](docs/REVIEWER_GUIDE.md).

### Handy (the AI assistant): the rules he works under

Handy is just another caller of the action registry, so he can do anything a person can do in the app, and nothing more. Three rules are enforced in `src/core/actions`:
1. **He acts for a person.** A Handy call carries `onBehalfOf` (who asked, and their role); the action's `roles` are checked against that person's role, and the audit trail
   names both (`handy/for:<user id>`).
2. **Each action has a Handy level** (`handy` on `defineAction`): `auto` (he just does it: low-risk office changes only, never anything sent to a customer or about money
   or pay), `ask` (the default: his request waits in the approval queue for an owner or admin) or `never` (a person's own clocks and consent). Anything not marked asks first.
3. **Customer-facing actions always ask**, and the plan is for Handy to draft the message, show it, and send only after a person says it looks good.

**The chat** (`src/modules/handy`, `api/handy/chat.ts`, `api/_lib/handyChat.ts`, migration `20261125000000_handy_chat.sql`) is a floating Handy button with a text chat (and a
"Talk it over with Handy" button on each to-do item). How it works:
- The browser runs Handy's look-ups and actions *as the signed-in person* (so database rules and the action rules above apply) and keeps the conversation in the company's own
  tables (`handy_threads`, `handy_messages`). The server function only holds the OpenAI key and passes the conversation on.
- **Masking** (`mask.ts`): people in the company use real names everywhere; the IDs exist only on the way out. Before anything is sent, each customer, contact and property the company
  knows about becomes its own ID that is the same in every conversation (`C-4F2A1C3E`, `K-…` for a contact, `P-…` for a property: the start of the record's own id), so a job can be tied to its
  customer, owner, manager and address without a name leaving. Emails, phone numbers and long numbers become "Email 1", "Phone 1", "Number 1" (kept per conversation). All of it is put
  back into real names and addresses for the screen. Tools return only an approved set of fields.
- **A last check on the server** refuses to send anything that still looks like an email, phone number, Social Security number or card number.
- OpenAI is called with `store: false`; apply for zero data retention on the OpenAI account as well, and mention the AI provider in the privacy policy.
- **Confirmation:** Handy says what he will change; a card asks the person; nothing runs until they click *Do it*. Anything beyond Handy's "auto" level also waits in the approval queue.
- **Customer records** (`customerTools.ts`): Handy is the office assistant for customer information. He can look customers (`find_customer`, `customer_details`) and properties (`find_property`) up,
  create a customer, change any of a customer's details (names, company, display name, email, phone, notes, property-manager flag), add and change contacts, and correct an address. Each change shows a card with
  every old value and new value and is saved by the person who approved it (the same change by Handy alone would wait for approval). Searches tell Handy only whether someone can be texted or
  emailed, never the number or address. Not yet: changing owners, managers and tenants, merging and deleting customers.
- **Customer messages** (`send_message`): Handy drafts a text or email (with `{first_name}` filled in by the app, never an ID), and a card shows the person where it goes and the words, which they can
  edit; only their click saves it, and it is saved **by the person**, not by Handy (as an AI agent, `messaging.send` always waits for approval). Messages are now stored in the database
  (`messages`, migration `20261127000000_messages.sql`) with a status: `queued` until a sending service is connected, then `sent` or `failed`. Nothing is shown as sent that was not delivered, and Handy is
  told so. The Messages page lists them, with a **Send** button on each waiting message. Sending (`api/messages/send.ts`, `api/_lib/messageSend.ts`) happens only when a person taps it: the server reads
  the message and the customer's phone or email from the database itself, delivers it by email (Resend: `RESEND_API_KEY`, `RESEND_FROM`) or text (Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_FROM`), and records `sent` (with the service's reference) or `failed` (with the reason). `MESSAGES_DISABLED=1` stops all sending. Until those accounts are set up, Send says so and the message stays
  waiting. For US texts, Twilio requires registering the business (A2P 10DLC) before messages are delivered reliably; for email, the sending domain must be verified with the email service.
- **Voice** (`voice.ts`, `api/handy/voice.ts`): the mic button starts a live call with OpenAI's voice model. The server only hands out a short-lived pass (`/v1/realtime/client_secrets`); the audio
  goes straight from the phone to OpenAI and never through our server. Handy's look-ups and changes during a call use the same tools, permissions and "Do it" card as the text chat,
  and the call's words are written into the conversation. In a call customers are "Customer 1", "Property 2" (a spoken ID would be unusable) and mapped back on screen; **what a person says out
  loud reaches OpenAI as audio, so spoken names are not masked** (the app says so during a call). A call ends by itself after 10 minutes. The voice is `cedar` (set `HANDY_VOICE` on the server to change it; there is no picker). Optional settings: `HANDY_VOICE_MODEL` (default
  `gpt-realtime`). The browser connection (`connectVoice`) follows OpenAI's published WebRTC flow but has not yet been tried against the live service.
- Set `OPENAI_API_KEY` (and optionally `HANDY_MODEL`, default `gpt-4.1`) in Vercel. Never put the key in the repository or in a chat.

### Revenue history

**Revenue** (owner and admins) shows revenue by day, week (Monday to Sunday), month, quarter, year, job or customer. Past years are loaded from invoice or
payment exports (QuickBooks transaction lists, old CRMs, Excel or CSV; `revenue_history` table, migration `20261120000000_revenue_history.sql`), up to the
launch month (January 2027, `LAUNCH_MONTH`), and HandyOS payments (without sales tax) count from then on. Months that only have a QuickBooks Profit and Loss
total appear in the month, quarter and year views.

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
