# HandyOS roadmap: things decided but not built yet

Kept here so nothing gets lost. Newest requests at the top of each section. (Built features are described in the README.)

## Asked for, not started

### Documents hub
One place where every image and upload lives. It can be viewed all together, or filtered **by customer, by job, by estimate, or by address (property)**.
Notes for when it is built:
- Files go in Supabase Storage with a database row per file (what it is, who uploaded it, when, and which customer, job, estimate, invoice or property it belongs to; one file can belong to several).
- Company separation and roles apply as everywhere else (techs would see files on their own jobs; billing documents for owners, admins and office).
- Photos taken by techs on a job attach to that job automatically (the tech's phone camera), with a caption.
- Limits to decide: file size, allowed types, how long to keep them, and a storage cost estimate.
- Handy could answer "show me the photos from the Oak Street job" and attach a document to a customer message.

### Phone system: call tree and AI receptionist
Drag-and-drop call tree (greeting, "press 1 for…", ring a person, forward to Aaron if a tech doesn't answer, business hours, voicemail with transcription, call log), then an AI receptionist that takes down information and books estimates in time slots Aaron sets aside, with overrides sent to him.
Open questions: the current business phone number and its provider (forwarding or porting to Twilio), who is on the menu, the after-hours plan, whether an extra always-on server is acceptable for the AI receptionist, and the state's rules on recording and AI disclosure.

### Texts (Twilio)
Code is ready (`api/_lib/messageSend.ts`). Needs the Twilio account, a number, carrier registration (toll-free verification or 10DLC) and three settings in Vercel. Also add an "OK to text" setting on each customer so Handy only drafts texts to people who agreed.

## Ideas parked

- Inbound email into the app so Handy can see customer inquiries (parked by Aaron).
- Notes that Handy remembers about people and customers (visible, editable, deletable).
- Handy: change who owns, manages or rents a property; merge and delete customers (with stricter approval).
- A usage cap inside the app for Handy, in addition to the OpenAI billing limit.
- Sending the manager's alerts to a phone or email when the app is closed (needs a scheduled job and the messaging services).
- Scheduled QuickBooks sync, and production approval from Intuit to pull the real books.
- Native phone app (Capacitor) for background arrival reminders.
- Stripe card payments and customer-facing links to approve an estimate or pay an invoice.
- A launch checklist for January 1.
