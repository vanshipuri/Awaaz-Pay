# AwaazPay — Razorpay Hackathon 2026 (Track 05: Open Track)

**A Voice-First, Agentic Payment Companion for the Blind, Low-Literacy & Elderly**

> “Sharma kirana ko paanch sau rupaye bhejo.”
>
> AwaazPay understands the intent, checks the payee and amount against a caregiver mandate, speaks the truth back, waits for a clear **yes**, then authorizes the charge with a spoken **Voice PIN** — no PIN pad, no OTP, no eyes on glass.

---

## 🛡️ Security & Bypassing Visual OTPs (For the Judges)

*How do we bypass 3D Secure / UPI PIN screens for true hands-free use — and stay compliant?*

In production, **AwaazPay** leverages **Caregiver Mandates**:

1. **Visual Setup (one time).** A caregiver uses Razorpay to set up a trusted **UPI AutoPay mandate** (or loads a **Razorpay closed-loop prepaid wallet**) for the elderly user. The UPI PIN is entered **once**, inside the bank's own secure surface.
2. **Hands-Free Execution (daily).** Because the mandate is pre-authorized up to a limit (**₹5,000 per transaction** in India, per RBI's UPI AutoPay rules), subsequent payments are executed via direct **Razorpay Server-to-Server API calls** — the UI glass PIN pad is never triggered.
3. **Biometric Confirmation (device-level security).** To ensure a bystander cannot just grab the phone and shout “Pay ₹500”, the *yes* is never a bare button press. It has to be backed by a biometric factor: a **voiceprint** match on the spoken confirmation itself, a **fingerprint**, or a **face scan** through the device's platform authenticator (Windows Hello / Touch ID) with `userVerification: required` and the assertion signature verified on the server. The **Voice PIN + voiceprint** check then authorizes the charge.

**The caregiver decides how many factors.** A toggle recorded server-side (`deviceBiometricSkipsPin`) lets a *hardware-backed* fingerprint or face scan authorize the charge outright and skip the Voice PIN. A voiceprint never skips it — a voice sample is not hardware-backed, so it confirms the yes and still hands off to the PIN.

**Everything is honestly labelled.** Where no platform authenticator is reachable (a sandboxed iframe, Firefox, or no Windows Hello enrolled), fingerprint and face fall back to a simulator, and every response, receipt, and log line names the engine: `webauthn-platform/1` versus `awaazpay-sim/1`.

**Above the mandate limit, there is no bypass.** The server refuses the charge (`422 amount_outside_mandate`) and requires caregiver authorization; in production that amount falls back to the bank's visual UPI PIN screen. The same is true for a payee the caregiver never authorized (`422 payee_not_on_mandate`) — a lookalike merchant cannot be charged silently even if the client-side gate is skipped.

### When the judges ask

> *“But wait — Razorpay and RBI mandate a UPI PIN or OTP. How can this be hands-free?”*

> **“AwaazPay replaces the visual UPI PIN with a combination of Caregiver Mandates and Voice Biometrics. During an initial visual setup, a caregiver creates a Razorpay UPI AutoPay mandate (or loads a Razorpay closed-loop wallet) for the elderly user. Because these recurring mandates are pre-authorized for daily bounds (like under ₹5,000), AwaazPay can execute those payments via Razorpay Server-to-Server API calls without triggering the UI glass PIN pad. To ensure local device security, AwaazPay inserts its own Voice PIN check before executing the charge.”**

---

## 🚀 The Killer Demo

This repository is configured to demonstrate the core value of AwaazPay **out of the box**. A **Smart Demo Mode** (local AI simulator + simulated Razorpay S2S capture) runs every flow with **no API keys**.

1. Click the **Microphone Button** and allow microphone permissions (or use **Type a command** / the demo chips).
2. **Scenario 1 (Normal Payment)**: Speak *“Sharma kirana ko paanch sau rupaye bhejo”*.
3. **Say yes — or say exit**: The agent confirms payee, amount, direction, and mandate headroom, and you answer *out loud*. “Yes” / “haan bhej do” confirms; **“exit”, “no transfer”, “cancel”, or “nahi” abandons the payment and charges nothing**. Clicking **Say YES · confirm payment** still works and goes through the identical gate.
4. **Biometric confirmation**: The console switches to a blue **🛡️ WAITING FOR BIOMETRIC** state. With a voiceprint enrolled, your spoken “yes” already matched it, so nothing further is needed; otherwise pick **Voice biometric**, **Fingerprint**, or **Face scan**. Enroll all three once from **Replay caregiver setup**, where the caregiver also decides whether a device biometric may skip the PIN.
5. **Voice PIN**: The badge switches to **🛡️ WAITING FOR VOICE PIN** and the agent asks: *“Confirmed. Please say your 4 digit Voice PIN to authorize this payment hands-free.”* Say **“One Two Three Four”** (or **“ek do teen char”**, or just the word **“PIN”** in Smart Demo Mode).
6. **Scenario 2 (Scam Guard)**: Say *“A collect request for pachas hazar has arrived”*. The agent detects the pull-request attack and explicitly warns you to cancel.
7. **Scenario 3 (Mandate Guard)**: Click **Above mandate limit** (₹6,000). The agent refuses to bypass the visual PIN and demands caregiver approval first.
8. **Caregiver Log**: Notice the complete transparent event log at the bottom of the page — and the replayable full log in the **Audit log** button.

Demo Voice PIN: **1234** (configurable via `AWAAZPAY_VOICE_PIN`). Three wrong attempts lock the PIN and abandon the payment.

---

## 🛠 Features

- **Voice First** — massive touch target, audio orchestration, and auto-reopening mic mean you never need to look at the screen.
- **Agentic Intent Parsing** — natural language / Hinglish payment intents, with a no-guess clarification flow when the amount or payee is missing.
- **Caregiver Mandate** — live mandate card showing per-transaction and daily bounds, wallet balance, authorized instrument, and a replay of the one-time visual caregiver setup.
- **Fraud Guard** — intercepts “collect request” pull scams, inflated amounts, and lookalike payees via explicit context reasoning.
- **Voice PIN** — spoken passcode engine (`1234`, “one two three four”, “ek do teen char”, or the word “PIN”) + simulated voiceprint match, securing the hands-free loop in place of a visual UPI PIN.
- **Biometric Confirmation** — the yes is backed by a voiceprint match on the utterance, a fingerprint, or a face scan via WebAuthn against the device's platform authenticator (`userVerification: required`), with the assertion signature verified server-side. No platform authenticator? It falls back to a simulator that says so in the receipt and the log.
- **Spoken Refusal at Every Step** — “exit”, “no transfer”, “cancel”, “nahi”, and “band karo” abandon the payment at the confirmation step and charge nothing. Refusal is matched before approval, so “no, don't transfer” can never be read as a yes.
- **Caregiver-Controlled Factor Policy** — the caregiver chooses whether a hardware biometric may skip the Voice PIN. The choice is stored server-side; the browser cannot assert it.
- **Refusal Beats Digits** — saying “no”, “cancel”, or “band karo” at the PIN prompt abandons the payment immediately, even if digits follow in the same breath. “Repeat” / “help” re-prompts without burning an attempt.
- **Server-Side Authorization** — the PIN is hashed on the server and exchanged for an **HMAC-signed, 90-second, intent-bound mandate-auth token**. `/api/payment/execute` refuses to run without it.
- **Mandate Enforcement on the Server** — per-transaction cap, daily utilisation, wallet balance, and the **payee allowlist** the caregiver authorized are all re-checked server-side, so neither the language model nor a crafted API call can talk its way past policy.
- **Caregiver Audit Trail** — full transparent text log of what the user requested, what the agent reasoned, and what was charged. PIN digits are redacted at capture and never stored.
- **Accessible Fallbacks** — on-screen keypad, physical keyboard digits, typed commands, `aria-live` status, and keyboard shortcuts for environments without a microphone.

---

## 💻 Tech Stack & Real Integration

- **Frontend**: dependency-free HTML/CSS/JS single-page console (`index.html`, `styles.css`, `app.js`) with an SVG icon system and a responsive, accessible layout.
  *(The pitch deck describes a Next.js App Router + Tailwind port; this repository ships the same flows as a zero-build app so judges can run it with one command.)*
- **Speech**: Browser Web Speech API — `SpeechRecognition` + `speechSynthesis`, switchable between `en-IN` and `hi-IN` for Hindi/Hinglish input and spoken confirmations.
- **Backend**: Node.js `http` server (`server.js`) — static hosting plus the intent, mandate, Voice PIN, and payment endpoints.
- **Intent AI**: Groq (OpenAI-compatible chat completions) with a bounded JSON schema and a deterministic local simulator fallback (**Smart Demo Mode**).
- **Payments**: Razorpay **Server-to-Server REST API** (`/v1/orders` + `/v1/payments/create/recurring` for tokenized UPI AutoPay). The `razorpay` Node SDK is a drop-in replacement for `razorpayRequest()`; no dependency is installed so the demo runs anywhere.
- **Security primitives**: Node `crypto` — salted SHA-256 PIN hashing, `timingSafeEqual` comparison, HMAC-SHA256 auth tokens, per-session attempt throttling with lockout.

---

## 🏃 Running Locally

```bash
npm install   # runtime has zero dependencies; jsdom is a dev-only test dependency
npm run dev   # or: npm start
```

Open **http://localhost:3000** if you set `PORT=3000`, otherwise the default is **http://localhost:5173**. Use Chrome or Edge for Web Speech support, and serve over `localhost` or HTTPS so microphone permissions are granted.

Check the server mode:

```bash
curl http://localhost:5173/api/health
curl http://localhost:5173/api/mandate
```

Without any keys you get:

```json
{ "ok": true, "paymentMode": "smart-demo", "intentMode": "smart-demo-local-simulator" }
```

### Optional keys

```bash
cp .env.example .env   # then fill in only what you have
npm start
```

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` / `GROQ_MODEL` | Real LLM intent parsing instead of the local simulator. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Live S2S order + tokenized recurring UPI AutoPay charge. |
| `RAZORPAY_UPI_TOKEN_ID` | The mandate token registered during caregiver setup. |
| `MANDATE_PER_TXN_LIMIT` / `MANDATE_DAILY_LIMIT` | Hands-free bounds (defaults ₹5,000 / ₹15,000). |
| `AWAAZPAY_VOICE_PIN` | Demo Voice PIN (default `1234`). |
| `AWAAZPAY_PIN_SALT` / `AWAAZPAY_AUTH_SECRET` | PIN hashing salt and mandate-auth token signing key. |

Never commit `.env` — it is git-ignored. Razorpay secret keys and the auth secret must stay server-side; only the mandate-auth token ever reaches the browser.

---

## 🔌 API surface

| Method | Route | What it does |
| --- | --- | --- |
| `GET` | `/api/health` | Reports intent mode, payment mode, PIN policy, and mandate id. |
| `GET` | `/api/mandate` | The caregiver-created mandate: bounds, utilisation, wallet, instrument, authorized payees, and enrolled biometrics. |
| `POST` | `/api/intent` | Groq-backed Hinglish intent parsing with a bounded JSON schema (`fallback` when no key). |
| `POST` | `/api/caregiver/approve` | Records and signs a caregiver approval for an above-mandate amount (intent + amount bound). |
| `POST` | `/api/biometric/challenge` | Issues a single-use WebAuthn challenge (`register` or `assert`) for the platform authenticator. |
| `POST` | `/api/biometric/enroll` | Enrolls a voiceprint sample, or a fingerprint/face credential from a real WebAuthn attestation (COSE key parsed server-side). Falls back to a labelled simulation. |
| `POST` | `/api/biometric/verify` | Verifies a factor for a specific intent. Voiceprint → confirms and hands off to the PIN. Fingerprint/face → issues the mandate-auth token when the caregiver allowed skipping the PIN. Enforces the payee allowlist and per-transaction cap first. |
| `POST` | `/api/biometric/settings` | Records the caregiver's `deviceBiometricSkipsPin` choice. |
| `POST` | `/api/voice-pin/verify` | Hashed PIN compare + simulated voiceprint match → HMAC mandate-auth token (90s TTL). 3 strikes → `423`. Above the cap without an approval → `422`. |
| `POST` | `/api/payment/execute` | Requires a valid token; re-checks the payee allowlist, per-transaction cap, daily utilisation, and wallet balance; charges via Razorpay S2S (or simulates it). |
| `POST` / `GET` | `/api/payment/verify`, `/api/payment/session` | Payment status lookup by `payment_id`. |

---

## ✅ Tests

Every security claim above is asserted by a test, not just described:

```bash
npm install
npm test
```

| File | What it proves |
| --- | --- |
| `tests/voice-pin-engine.test.js` | The confirmation classifier reads “yes”, “haan bhej do”, “theek hai” as approval and “exit”, “no transfer”, “cancel”, “mat bhejo”, “ji nahi” as refusal, with refusal winning inside a single breath and substring lookalikes (“yesterday”, “known”) ignored. The Voice Passcode Engine parses “one two three four”, “ek do teen char”, `1234`, and `1 2 3 4`; ignores filler; treats the bare word “PIN” as a Smart Demo Mode shortcut; never mistakes a payment phrase or a partial PIN for authorization; and classifies a spoken refusal (“no”, “cancel”, “band karo”) as a cancellation that beats any digit stream. It runs the **real shipped `app.js` code**, sliced into a VM sandbox. |
| `tests/mandate-api.test.js` | Boots `server.js` and asserts: no token → no charge; wrong PIN → rejected then locked after three attempts; correct PIN → signed token → S2S capture with `visualPinPadShown: false`; above ₹5,000 → refused without a server-recorded caregiver approval; a payee outside the mandate allowlist → refused without burning an attempt; tokens cannot be replayed on another intent or forged; wallet and daily utilisation move correctly. Biometrics: an unenrolled factor is refused, a voiceprint confirms but can never issue a charge token even with the caregiver toggle on, a fingerprint with the toggle on yields a token that captures with `authorizationFactor: fingerprint`, and no biometric can bypass the payee allowlist or the ₹5,000 cap. |
| `tests/biometric-flow.e2e.test.js` | Drives the real DOM in jsdom: caregiver enrollment from the mandate modal → a spoken “yes” matched by the enrolled voiceprint → blue **🛡️ WAITING FOR BIOMETRIC** → fingerprint authorizes the charge with **no PIN at all** once the caregiver allows it, and the receipt names the factor. Also covers the unenrolled-factor detour, the Voice PIN fallback, and cancelling from the biometric step. |
| `tests/voice-flow.e2e.test.js` | Drives the real DOM in jsdom: demo chip → **Say YES** → blue **🛡️ WAITING FOR VOICE PIN** → keypad/spoken PIN → green hands-free success, and checks the caregiver log contains the full chain **with the PIN redacted**. Also covers the spoken yes (which used to be re-parsed as a new command and destroy the payment), spoken “exit no transfer”, unrelated speech keeping the payment open, the wrong-PIN retry, cancelling at the PIN step, the collect-request scam (including the README's exact payee-less phrase), the above-mandate gate, clarification, and the caregiver setup replay. |

68 assertions pass with no provider keys configured (Smart Demo Mode).

---

## 🧭 Judge flow (clickable)

1. **Safe payment** — ₹500, inside the mandate → say yes → biometric confirmation → Voice PIN → hands-free capture.
2. **Collect request** — ₹50,000 pull scam → the agent explains money would *leave* the account → **Say NO**.
3. **Inflated amount** — ₹50,000, 100× usual → warning acknowledgement + caregiver approval required.
4. **Lookalike payee** — name/VPA mismatch → warning before any authorization.
5. **Above mandate limit** — ₹6,000 → the server refuses a silent bypass; caregiver approval first.
6. **Clarification** — say `Rakesh Medical ko pay karo` → AwaazPay asks for the missing amount instead of guessing.

Useful voice or typed phrases:

- `Sharma kirana ko paanch sau rupaye bhejo`
- `Mehta utilities ko chhe hazaar rupaye bhejo`
- `Sharma kirana ko pachaas hazaar rupaye bhejo`
- `Sharma kirana ne pachaas hazaar ka collect request bheja hai`
- `Rakesh medical ko do hazaar rupaye bhejo`
- `Rakesh Medical ko pay karo` — clarification test
- `yes` / `haan bhej do` — spoken confirmation at the review step
- `exit` / `no transfer` / `cancel` / `nahi` — spoken refusal; the payment is abandoned and nothing is charged
- `One two three four` / `ek do teen char` / `PIN` — Voice PIN responses

---

## 🏗 The agentic loop

`01 Understand → 02 Resolve & check → 03 Confirm aloud → 04 Guard → 05 Biometric + Voice PIN → 06 Execute (Razorpay S2S)`

The LLM **explains**; the deterministic policy **decides**. Every Groq intent is re-run through `applyRiskPolicy()` in the browser, and every charge is re-checked against the mandate in `server.js`, so a hallucinated amount can never produce a payment.

---

## 🚧 Production safety boundaries

1. Move saved payees, mandate state, wallet ledger, PIN hashes, and audit events into a secure database with real key management (KMS/HSM), not in-memory demo state.
2. Replace the simulated voiceprint matcher with an enrolled speaker-verification model and anti-spoofing (replay detection), plus liveness checks. Fingerprint and face already run real WebAuthn against the platform authenticator where one is reachable; keep the simulator strictly for environments without one, and add face liveness/anti-spoofing before trusting a camera-only path.
3. Use verified **Razorpay webhooks** as the source of truth for final payment status; the `/api/payment/verify` lookup here is for the hackathon flow.
4. Register mandates through Razorpay's real UPI AutoPay subscription/tokenization flow, with mandate pause/resume, expiry, and revocation surfaced to the user and caregiver.
5. Add real caregiver permissions, consent records, co-signing, and revocation instead of the simulated approval.
6. Keep the one-time visual UPI PIN inside the bank/Razorpay-approved secure surface; never attempt to automate it.
7. Test with TalkBack and VoiceOver, and run usability sessions with blind and elderly users.
8. Build a 30–50 phrase Hindi/Hinglish evaluation set and report measured parsing, payee resolution, risk detection, PIN capture, and confirmation metrics.

---

## 📁 Files

- `index.html` — product surface: voice console, mandate card, trust centre, review states, biometric/Voice PIN badge, caregiver log, and accessible modals including biometric enrollment.
- `styles.css` — responsive visual system, including the blue `authenticate` state, PIN keypad, and caregiver log.
- `app.js` — voice flow, Hinglish parser, confirmation-intent classifier, biometric confirmation (WebAuthn + simulator), Voice PIN engine, mandate policy, Razorpay handoff, caregiver approval, and audit trail.
- `server.js` — static server plus `/api/health`, `/api/mandate`, `/api/intent`, `/api/caregiver/approve`, `/api/biometric/*` (challenge, enroll, verify, settings — including CBOR/COSE parsing and WebAuthn assertion verification), `/api/voice-pin/verify`, `/api/payment/execute`, `/api/payment/verify`, `/api/payment/session`.
- `tests/` — confirmation-classifier and Voice Passcode Engine units, mandate/PIN/biometric API integration tests, and two jsdom end-to-end runs: the killer demo and the biometric confirmation flow (`npm test`).
- `.env.example` — provider, mandate, and Voice PIN variable template; safe to commit.

---

*Nothing real moves in Smart Demo Mode. Built for Razorpay Hackathon 2026 · Track 05 Open Track.*
