# AwaazPay

A voice-first, safety-first payment companion for blind, low-literacy, and elderly users. Built as a Razorpay Hackathon 2026 Track 05 — Open Track demo.

> “Sharma kirana ko paanch sau rupaye bhejo.”
>
> AwaazPay understands the intent, checks the payee and amount, speaks the truth back, and waits for a clear yes.

## Run the demo

This is a dependency-free browser prototype with a tiny Node static server:

```bash
npm start
```

Open `http://localhost:5173` in a browser. If you do not want to use Node, run `python3 -m http.server 5173 --bind 0.0.0.0` instead. For the Arena live preview, the same server is compatible with the preview host because it binds to `0.0.0.0`.

The demo uses browser speech recognition and speech synthesis when the browser exposes them. If a microphone is unavailable, select **Type a command**.

## Judge flow

1. Click **Safe payment**.
2. Let AwaazPay resolve the saved payee and amount.
3. Click **Say YES · confirm payment**.
4. The sandbox result and caregiver audit entry appear.
5. Click **Start another payment** and try **Collect request**.
6. The agent explains that a collect request pulls money from the user and offers **Say NO · decline request**.
7. Try **Inflated amount** or **Lookalike payee** to show the extra acknowledgement guardrail.

Useful voice or typed phrases:

- `Sharma kirana ko paanch sau rupaye bhejo`
- `Sharma kirana ko pachaas hazaar rupaye bhejo`
- `Sharma kirana ne pachaas hazaar ka collect request bheja hai`
- `Rakesh medical ko do hazaar rupaye bhejo`

## What is implemented in this prototype

- Voice-first payment console with Web Speech API progressive enhancement.
- Hinglish / Hindi-style phrase parsing for the demo intents and common numeric phrases.
- Synthetic saved payees and spending history.
- Explicit push-vs-pull / collect-request explanation.
- Amount anomaly detection against a payee’s usual amount.
- Payee-name / VPA mismatch warning.
- Spoken summary before execution and an explicit confirmation action.
- Razorpay test-mode payment simulator with no real money movement.
- Replayable caregiver audit log for requests, reasoning signals, warnings, user decisions, and outcomes.
- Keyboard fallback, responsive layout, accessible labels, `aria-live` status updates, and a clear no-money-moves boundary.

## Production wiring plan

The UI intentionally keeps the hackathon demo self-contained. For a production build:

1. Replace `parseCommand()` in `app.js` with a server-side intent endpoint backed by Claude (or the selected LLM). Keep the schema bounded to `intent`, `payee`, `amount`, `direction`, `confidence`, and `risk_signals`.
2. Move saved payees, transaction history, audit events, and risk policy to a secure backend. Never put provider secrets in the browser.
3. Create Razorpay Orders or Payment Links server-side in test mode first. Use verified webhooks for the final outcome rather than trusting the browser.
4. Keep authentication and UPI PIN / bank-app approval inside the bank or Razorpay-approved secure surface. AwaazPay should never ask the user to speak or type a PIN.
5. Add TalkBack and VoiceOver testing, Hindi and regional-language STT evaluation, replay consent, caregiver permissions, rate limits, and abuse monitoring with real users.

## Files

- `index.html` — product surface and accessible modal structure.
- `styles.css` — responsive visual system and interaction states.
- `app.js` — local agent loop, deterministic demo reasoning, speech hooks, and audit trail.
