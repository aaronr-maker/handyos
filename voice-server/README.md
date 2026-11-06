# HandyOS voice server

A small always-on server. Twilio sends it the audio of connected calls; it has OpenAI type the call out as it happens, saves each line for the call screen in HandyOS, and writes a summary when the call ends. Audio is never saved.

Settings (all required): `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STREAM_SECRET` (a long random text; the same value must be set in Vercel).
Optional: `TRANSCRIBE_MODEL`, `SUMMARY_MODEL`.

Start command: `npm install && npm start`. Health check address: `/health`.
Then, in Vercel, set `VOICE_STREAM_URL` to `wss://<this server's address>/stream` and `STREAM_SECRET` to the same secret. Remove `VOICE_STREAM_URL` to turn live transcripts off.
