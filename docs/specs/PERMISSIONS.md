# Positions and permissions (from Aaron, 2026-11-13; planned)

## What Aaron asked for
- In **Settings**, build out company **positions** (like Owner, Office manager, Estimator, Technician).
- Every screen and every kind of information in the app is listed with a **checkbox**. A position is a saved set of checked boxes (a preset).
- An employee is given a position. Their profile also shows every option they do **not** have, so extra permissions can be given to one person on top of their position (and, if needed, taken away).
- **Handy** can edit these (with approval) when asked, and has access to everything.
- Timesheets: everyone's timesheets appear on the manager's dashboard, not the techs'. (A tech sees only their own time.)

## Proposed design
- **Permissions** are a fixed list the app defines, grouped by screen: view, change, and sensitive information (pay rates, profit, customer contact details, QuickBooks, phone settings, team settings...). Each has a plain-language name.
- **Positions** are named presets. The four built-in roles (owner, admin, office, tech) become starter positions. The owner always has everything and cannot be locked out.
- **Per-person overrides:** extra allowed, and explicitly removed.
- **Menu and screens** show only what a person is allowed to see. **Actions** (change customer, send message...) check the permission before they run, for people and for Handy.
- **Security:** screen hiding alone is cosmetic. The sensitive tables are protected in the database itself (row level security checking the permission), done in a second phase so it is not skipped.
- **Handy:** editing positions and permissions is an action that always needs approval; he sees everything the company has, but answers each person only with what that person is allowed to see (otherwise any tech could ask him for payroll).
- Every change to a position or a person's permissions is written to the audit log.

## Phases
1. The permission list, positions, per-person overrides, Settings screens, menu and screen gating, action checks, Handy's edit action.
2. Database-level protection for the sensitive tables.
3. Move the existing role checks onto permissions, then retire the old four-role checks.

## Decided (Aaron, 2026-11-13)
- Aaron can **create his own positions** and give them presets (not only the starter ones).
- **Timesheets:** the manager's dashboard (owner/admin) shows everyone's timesheets. Techs see only **My time**, which contains their own timesheet; there is no separate Timesheets item for them. Time punches can be edited (as today): every edit is posted as an edit and asks for a reason, and the reason is posted too.
- **Database lock:** sensitive information (pay rates, profit, customer details, financials) is protected in the database itself, not only hidden on screen, and nothing may be able to leak it (screens, Handy, exports, the server's own functions).
- **Handy** looks at who is asking and what they are allowed to see first. If they lack the permission he says plainly "I don't have access to that." He has access to everything himself, but answers each person only within their permissions.
- "GFs dash" meant the manager's dashboard.

## Open questions (closed)
- "GFs dash" in the timesheets note: assumed to mean the manager's (GM's) dashboard. Confirm.
- Should a tech see the "Timesheets" menu item at all, or only "My time"?
