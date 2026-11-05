# Phone system setup

The **Phone** page has three tabs: the call tree (drag and drop), the number/hours/people, and calls with voicemails.

1. Run the SQL in `supabase/migrations/20261128000000_phone.sql` (Supabase, SQL editor).
2. In Vercel (Production) add `APP_URL` = `https://app.thathandymanvan.com`, and make sure `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set (used to check that calls really come from Twilio and to play voicemails).
3. In Twilio, open the phone number, set **A call comes in** to Webhook, POST, `https://app.thathandymanvan.com/api/voice/incoming`.
4. In HandyOS, Phone, "Number, hours & people": enter the Twilio number, hours, and each person's cell number.
5. Phone, "Call tree": pick who rings in each Ring block, then **Save and use this tree**. Use "Try it" to rehearse a call first.

Later: port the Housecall Pro number to Twilio; the AI receptionist block needs a small always-on server (`VOICE_AI_READY=1` once it exists). Until then that block follows its "unavailable" exit. Check recording/AI disclosure rules before turning those on.
