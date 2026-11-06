# Phone system setup

The **Phone** page has three tabs: the call tree (drag and drop), the number/hours/people, and calls with voicemails.

1. Run the SQL in `supabase/migrations/20261128000000_phone.sql` (Supabase, SQL editor).
2. In Vercel (Production) add `APP_URL` = `https://app.thathandymanvan.com`, and make sure `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set (used to check that calls really come from Twilio and to play voicemails).
3. In Twilio, open the phone number, set **A call comes in** to Webhook, POST, `https://app.thathandymanvan.com/api/voice/incoming`.
4. In HandyOS, Phone, "Number, hours & people": enter the Twilio number, hours, and each person's cell number.
5. Phone, "Call tree": pick who rings in each Ring block, then **Save and use this tree**. Use "Try it" to rehearse a call first.

Later: port the Housecall Pro number to Twilio; the AI receptionist block needs a small always-on server (`VOICE_AI_READY=1` once it exists). Until then that block follows its "unavailable" exit. Check recording/AI disclosure rules before turning those on.

## Live transcripts and AI call summaries
The **Call screen** tab shows the prompt for whoever answers and, when a call connects, what is being said (updates by itself). After the call, an AI summary appears. Audio is never saved; only the typed words and the summary.

It needs the small server in [voice-server](../voice-server/README.md), deployed somewhere that stays on (for example Render, a few dollars a month).
1. Run `supabase/migrations/20261130000000_call_transcripts.sql` in Supabase.
2. Deploy `voice-server` (root directory `voice-server`, build `npm install`, start `npm start`) with: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STREAM_SECRET` (a long random text).
3. In Vercel add `STREAM_SECRET` (the same text) and `VOICE_STREAM_URL` = `wss://<the server's address>/stream`, then redeploy. Remove `VOICE_STREAM_URL` to switch live transcripts off.

Not yet tested against live OpenAI/Twilio: expect to adjust after the first real call.
