# AwaazPay

A voice-first, safety-first payment companion for blind, low-literacy, and elderly users. Built as a payment-accessibility demo for Razorpay Hackathon 2026 Track 05 — Open Track.

> “Sharma kirana ko paanch sau rupaye bhejo.”
>
> AwaazPay understands the intent, checks the payee and amount, speaks the truth back, and waits for a clear yes.

## Run locally

This project has no npm dependencies. It includes a tiny Node server for static files and optional server-side provider calls:

```bash
npm start
```

Open `http://localhost:5173` in Chrome or Edge. For microphone testing, use `localhost` or an HTTPS deployment rather than opening `index.html` directly.

Without provider keys the demo still works with its local parser and simulated Stripe test result.

Check the server mode with:

```bash
curl http://localhost:5173/api/health
```

## Optional Groq and Stripe setup

Copy the example file and fill in keys only on your own machine or deployment server:

```bash
cp .env.example .env
npm start
```

The included server loads `.env` automatically for local development. Never commit `.env`; it is ignored by Git. On a hosted deployment, use the platform's secret/environment-variable settings.

`.env` should contain:

```env
GROQ_API_KEY=gsk_your_free_key
GROQ_MODEL=llama-3.3-70b-versatile

STRIPE_PUBLIC_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
```

The Groq endpoint uses the OpenAI-compatible chat-completions API and asks the model for a bounded JSON intent object. The models can be changed through `GROQ_MODEL` if a different Llama, Mixtral, or Gemma model is available in your account.

With `STRIPE_SECRET_KEY`, the server creates a Stripe Checkout Session in test mode after the user confirms. The browser is redirected to hosted Stripe Checkout and returns to AwaazPay for server-side session verification. Without Stripe credentials, the server returns a simulated test session so the judge flow remains runnable.

The public Stripe key is safe to expose to the browser when needed; the secret Stripe key and Groq key must remain server-side. AwaazPay never asks for UPI PINs or OTPs.

## Judge flow

1. Click **Safe payment**.
2. Let AwaazPay resolve the saved payee and amount.
3. Click **Say YES · confirm payment**.
4. With no Stripe credentials, the simulated test result appears. With Stripe test credentials, hosted Stripe Checkout opens.
5. Click **Start another payment** and try **Collect request**.
6. The agent explains that a collect request pulls money from the user and offers **Say NO · decline request**.
7. Try **Inflated amount** or **Lookalike payee**. A high-risk flow asks the user to acknowledge the warning and requests a simulated caregiver approval before it exposes the final payment action.
8. Try an incomplete command such as `Rakesh Medical ko pay karo`. AwaazPay asks for the missing amount instead of guessing.

Useful voice or typed phrases:

- `Sharma kirana ko paanch sau rupaye bhejo`
- `Sharma kirana ko pachaas hazaar rupaye bhejo`
- `Sharma kirana ne pachaas hazaar ka collect request bheja hai`
- `Rakesh medical ko do hazaar rupaye bhejo`
- `Rakesh Medical ko pay karo` — clarification test

## What is implemented

- Voice-first payment console with Web Speech API progressive enhancement.
- Typed-command fallback for unsupported browsers and microphone permissions.
- Hinglish / Hindi-style phrase parsing for common numeric phrases.
- Optional Groq-backed intent endpoint with a bounded JSON schema and local fallback.
- No-guess clarification flow when amount or payee is missing.
- Synthetic saved payees and spending history.
- Explainable payee, amount, and direction signals.
- Explicit push-vs-pull / collect-request warning.
- Amount anomaly detection against a payee's usual amount.
- Payee-name / VPA mismatch warning.
- Caregiver approval gate for high-risk payments.
- Optional Stripe test-mode Checkout Session creation and server-side session verification.
- Simulated Stripe result when credentials are not configured.
- Replayable caregiver audit log for requests, reasoning signals, warnings, user decisions, and outcomes.
- Trust centre with the no-PIN/no-OTP and no-silent-payment promises.
- Demo coverage panel, responsive layout, keyboard fallback, accessible labels, `aria-live` status updates, and a clear no-money-moves boundary.

## Production safety boundaries

Groq understands and explains. The deterministic safety policy decides whether the flow can continue. The payment server is the only component allowed to create a Stripe Checkout Session. Keep this separation in production.

1. Move saved payees, transaction history, audit events, and risk policy to a secure database.
2. Use verified Stripe webhooks as the source of truth for final payment status; the return-page session lookup in this demo is for the hackathon flow.
3. Keep authentication and UPI PIN / bank-app approval inside the bank or Stripe-approved secure surface.
4. Add real caregiver permissions, consent, expiry, and revocation rather than the simulated approval in this demo.
5. Test TalkBack and VoiceOver with blind and elderly users.
6. Build a 30–50 phrase Hindi / Hinglish evaluation set and report measured parsing, payee resolution, risk detection, and confirmation metrics.

## Files

- `index.html` — product surface, trust centre, review states, and accessible modals.
- `styles.css` — responsive visual system and interaction states.
- `app.js` — voice flow, local parser, optional Groq call, safety policy, Stripe handoff, caregiver approval, and audit trail.
- `server.js` — static server plus optional `/api/health`, `/api/intent`, `/api/payment/create-intent`, `/api/payment/verify`, and `/api/payment/session` endpoints.
- `.env.example` — provider variable template; safe to commit.
