# AI Business Receptionist

## Options evaluated

| Option | How it works | Pros | Cons | Fit |
|---|---|---|---|---|
| **Twilio Programmable Voice + `<Gather input="speech">`** *(built)* | Twilio transcribes each caller turn; LYONS AI replies with TwiML `<Say>` | Simple, robust, works with any LLM, every turn passes our safety filter and audit trail, falls back to voicemail cleanly | Turn-based (≈1–3 s pause per turn), robotic TTS | **Best first step**: easy to control, cheap |
| Twilio **ConversationRelay** | Twilio handles streaming STT/TTS; your server exchanges text over a WebSocket | Natural, low-latency conversation; same control over text | More moving parts (WebSocket service); newer product | **Upgrade path**: the same brain and guard plug in |
| Twilio Media Streams + your own STT/TTS | Raw audio over a WebSocket | Full control | Most engineering: barge-in, VAD, audio pipeline | Not worth it now |
| Hosted voice-agent platforms (Vapi, Retell, Bland, etc.) | Their stack runs the whole call | Fastest to a natural-sounding demo | Policy, transcripts and guardrails live in a third party. Harder to guarantee "never invent prices". Per-minute platform fees on top of telephony. | Possible later for voice quality, if their guardrails meet the same rules |

**Decision:** start with Twilio Voice and speech `<Gather>`, which is built and tested. Move to ConversationRelay once the call flow is proven.

## Call flow
1. **Answer:** the incoming call's Twilio signature is verified, and the call is recorded in `calls`. The caller is matched to a client by caller ID, but that match is only used in your summary and never disclosed to the caller. The caller then hears: *"Thanks for calling Lyons Cleaning Solutions. You're speaking with an automated AI assistant, and this call is transcribed so our team can follow up. How can I help you today?"*
2. **Each turn:**
   - **Deterministic check first:** emergency words (flood, fire, gas leak, locked out, …) or "talk to a person" → transfer to `OWNER_PHONE`, with an instant Telegram alert. If you don't answer, the caller goes to voicemail.
   - **Otherwise Claude replies** using only your knowledge base (services, area, hours, FAQs). It collects name, callback number, service, area, and preferred times.
   - **Safety filter on every spoken sentence:** prices, rates, availability, bookings, guarantees, contract or cancellation terms are replaced with "the owner will follow up to confirm." Every replacement is logged and reported to you.
3. **End:** after the caller is done, or after `RECEPTIONIST_MAX_TURNS` turns, you get a Telegram summary with the transcript and captured details. Known clients also get a timeline entry flagged "needs response".
4. **Fallbacks:**
   - **No speech twice, a model error, or the daily budget reached:** the caller goes to voicemail.
   - **Kill switch or `receptionist` paused:** voicemail only, with no AI on the call.

## Setup
1. Create a Twilio account and buy a local Detroit-area number (Voice).
2. Set the number's **A call comes in** webhook to `https://<LYONS_DOMAIN>/voice/incoming` (HTTP POST), and **Call status changes** to `https://<LYONS_DOMAIN>/voice/status`.
3. In `.env`: `RECEPTIONIST_ENABLED=true`, `TWILIO_AUTH_TOKEN=…` (used only to verify webhooks), and `OWNER_PHONE=+1313…`. `PUBLIC_BASE_URL` must be exactly the https URL Twilio calls, because signatures cover the full URL.
4. Edit what it may say: tell the bot, e.g. "update the receptionist: we also do post-construction cleaning; we answer calls 8am–6pm". It calls `receptionist_knowledge_update`, which needs your approval because it changes what callers hear. Prices in FAQs are still blocked by the safety filter.
5. Test-call from another phone. Check the Telegram summary and the Control Center → Receptionist calls.

## Compliance notes (not legal advice; confirm with an attorney)
- **Disclosure:** callers are told up front they're speaking with an AI and that the call is transcribed.
- **Recording:** turn-by-turn speech-to-text is used for the conversation, and audio is recorded only when the caller leaves a voicemail after being prompted. Michigan's eavesdropping law is generally applied as one-party consent for call participants, but callers may be in all-party-consent states, so the up-front disclosure is kept for everyone.
- **Outbound AI calls are not built.** The FCC treats AI-generated voices as "artificial" under the TCPA, which requires prior express consent for such calls. Any future outbound feature needs consent records first.
- **No commitments:** no prices, availability, contract terms or bookings are ever stated. Those always come from you.

## Costs (approximate; check twilio.com/pricing)
- **Phone number:** about $1–2/month.
- **Inbound minutes:** about $0.01 per minute.
- **Speech recognition:** a few cents per call minute.
- **Voicemail transcription:** a few cents per minute.
- **Claude:** one short call at low effort per turn, about $0.01–0.05 per call on Opus 5.5.

At 100 calls a month averaging 3 minutes, that's roughly **$10–25 per month**.

## Status
Built and tested with signed fake Twilio requests (signatures cross-checked against the official `twilio` library) and a scripted model. **Not yet tested on a real phone call.** That needs your Twilio account.
