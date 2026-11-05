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

### Updating the app in the field, with testing first
Techs have the app installed on their phones. They must not have to uninstall or reinstall: the app tells them an update is ready, downloads it quietly in the background, and they tap **Restart** when it suits them. Aaron must be able to **test any update before it goes out to the field**.
What exists today: the installed app (a web app) already updates itself, but silently (`registerType: 'autoUpdate'` in `vite.config.ts`), with no prompt, and every merge to `main` goes live to everyone at once.
What to build:
- **The prompt:** switch to prompt mode; a banner "A new version is ready: Restart now / Later". The new version downloads in the background first; Restart applies it. Check for updates when the app is opened and every few minutes.
- **A version file** (`/version.json`, built each release) so the app can also notice a newer version without waiting on the browser, and a **"must update" switch** for the rare change an old copy can't work with (a blocking screen: "Update required").
- **Testing before the field:** a staging copy of the app on its own web address that the team tests first, and a deliberate "release" step to send it to the field. Setup in Vercel: make a `release` branch the production one, let `main` build the staging address, and release by merging `main` into `release`. Ideally staging also gets its **own Supabase database** so tests never touch real jobs.
- **Database changes and old copies:** a phone running an old version must keep working while the database moves forward, so changes are made in two steps (add first, remove later). Record this rule in the reviewer guide.
- The automated checks already run on every change (lint, tests, build); add a short checklist of things to try by hand on staging before each release.
- If the app is later put in the app stores (Capacitor), updates to the store apps need a different path (store releases, or a live-update service). Decide when that happens.

### Job notes and photos (a place on every job)
Every job has a notes area. Each **note** can have an image or no image, and each **image** can have a note or no note: some notes describe the photo uploaded with them, some notes have no photo, some photos need no words.
- **Photo editor:** crop; draw on the image (squares, circles, arrows, straight lines, freehand); different colors; add text, with a choice of text background. Edit before posting; the original is kept next to the edited version.
- **Tagging:** type `@` in a note and team names appear as you type, or pick one from the list. Tagged people are **alerted** (a popup and a badge in the app, for techs too, not only managers).
- Photos also show up in the **documents hub** (below), filtered by that job.
- Notes for when it is built: Supabase Storage for the files (company-separated), notes in their own table, a notification table for tags, signed links for viewing, a tech's phone camera as an upload source, the editor as a canvas that works with touch, and a link to "Notes and photos" from the job screen. Decide: who may edit or delete a note (the author, and admins?) and whether tagged people also get a text or email later.

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
