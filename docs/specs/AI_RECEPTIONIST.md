# AI receptionist (from Aaron, 2026-11-08; planned)

**When it answers:** the call tree decides (an "AI receptionist" block; the direct-to-me list, the clock and area code blocks all sit in front of it). It never answers callers on the direct list.
**Voice:** a woman's voice, warm and relaxed (a different voice from Handy).

## What it does
1. Greets the caller, says it is the company's assistant, and finds out what they need.
2. Takes their name, best number, and the service address.
3. **Books free in-home estimates** in the time blocks Aaron sets aside for estimates, with team members who are signed off as sellers. It checks the calendar and offers two choices, for example: "We have next Tuesday at 4 PM with Aaron Ross, or Wednesday at 8 AM with Aaron Chamernick. Would one of those work?"
4. If they need a time outside the blocks: "Yeah, no problem. We can have a technician call you and set up a time outside our normal estimate times to get you taken care of." That creates a callback task for the office.
5. **Pricing questions:** it never quotes prices. It says in-home estimates are free and that estimates are not done over the phone, because there may be materials, service minimums or trip charges; a technician will get the quote to them.
6. It saves the call: a transcript and summary (already built), and the booked estimate or callback task.

## Settings it needs
- **Estimate time blocks** (company setting): which days and hours are set aside for in-home estimates, how long each takes, and any travel buffer.
- **Seller** (employee setting): team members signed off to do in-home estimates. The assistant only books with sellers.
- The few facts it may answer (hours, service area, what the company does).

## Rules
- Never quote or negotiate a price. Never promise a repair or a technician time outside the blocks.
- Say it is an automated assistant. Calls already begin with the recording notice.
- Anything it cannot handle becomes a callback task for the office, never a dropped call.

## Build order
1. The availability logic (which estimate slots are open, with which seller): pure and tested. **Done.**
2. Settings and data: estimate time blocks, the seller flag, estimates booked by the assistant on the calendar and the to-do list.
3. The voice server: the live conversation over the phone (Twilio audio to OpenAI's voice model), using the availability logic, booking and callback tools.
4. Fit it into the call tree's "AI receptionist" block (replaces the "unavailable" exit).
