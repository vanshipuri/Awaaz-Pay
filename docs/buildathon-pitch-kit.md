# AwaazPay — Buildathon Pitch Kit

*Razorpay Hackathon 2026 · Track 05 — Open Track*
*A Voice-First, Agentic Payment Companion for the Blind, Low-Literacy & Elderly*

This is the judge-facing companion to [`docs/demo-script.md`](demo-script.md). It gives you:
a feature-by-feature demo map, the differentiator story against mainstream UPI apps and
accessible-checkout efforts, the compliance answer anchored to RBI's April-2026 e-mandate
rules, a 7-minute demo plan, and a **curl proof wall** you can run live against
`localhost:5173` to show the safety gates are real server code, not slideware.

Everything runs with **zero API keys**: `npm install && npm run dev` → Smart Demo Mode.

---

## 🎯 The one-liner

> **“AwaazPay moves the UPI PIN to a one-time caregiver mandate and replaces the glass
> keypad with a spoken PIN and voiceprint — so the people who can't read the PIN pad never
> have to ask a stranger again.”**

**The problem in one sentence.** UPI's authorization model is a *visual* PIN pad and a
*visual* OTP screen — for 30M+ blind and low-vision Indians and hundreds of millions of
low-literacy or elderly users, that turns every payment into a moment where they must trust
a stranger, and fraudsters know it.

**Who it's for.** Sarla Devi, 72, lives alone in Jaipur, can't read the PIN pad, and lost
₹40,000 after asking a "helpful stranger" at a kirana shop. Her daughter Meera lives in
Pune. AwaazPay is built for exactly that pair.

---

## 🗺 Feature-by-feature demo map

| # | Feature | Where to see it | What to say to a judge |
| --- | --- | --- | --- |
| 1 | **Natural-language intent (Hindi / English / Hinglish)** | Mic or demo chips — say `Sharma kirana ko paanch sau rupaye bhejo` | Groq parses code-switched speech into a structured intent (`pay`, payee, amountPaise, direction, confidence). No keys? A local simulator returns the identical shape. |
| 2 | **Speak the truth back** | The spoken summary + `#reviewContent` panel | The agent *always* repeats amount, payee, VPA and direction aloud before any confirmation is possible. No silent prepared payment. |
| 3 | **Spoken yes / no — refusal wins** | Scene 2: say `exit — no transfer` | The classifier reads “haan bhej do”, “theek hai” as approval and “exit”, “mat bhejo”, “ji nahi” as refusal — and inside a single breath, **refusal beats approval**. “No” is never misheard as digit 9. |
| 4 | **Voice PIN (replaces the glass PIN pad)** | Blue **🛡️ WAITING FOR VOICE PIN** badge → say `ek do teen char` | Digits are redacted at capture, salt-hashed, compared in constant time on the server, paired with a voiceprint score, and exchanged for an **HMAC-signed 90-second token bound to that exact intent, amount and payee**. Three misses → lockout. |
| 5 | **Caregiver mandate** | **Replay caregiver setup** (right rail) | The one visual moment: daughter sets bounds (per-txn **₹15,000** — the RBI e-mandate ceiling — tighten-only), a 4–6 digit Voice PIN, and the trusted-payee allowlist; enters the real UPI PIN **once**, in the bank's own surface, to register the AutoPay mandate. |
| 6 | **Collect-request direction guard** | Chip: `A collect request for pachas hazar…` | The agent classifies **direction**: a pull request takes money *from* her and is refused outright — never charged on a push mandate. This is the exact scam that drains elderly accounts. |
| 7 | **Lookalike-payee guard** | Chip: lookalike payee | Identity is checked on the **VPA**, not the display name — `sharma.kirana@okaxis` next to `sharmakirana@ybl` is flagged before a PIN attempt is even burned. |
| 8 | **Mandate ceiling guard (₹15,000)** | Chip: **Above mandate limit** (₹25,000) | Server returns `422 amount_outside_mandate` / `caregiver_approval_required`. No silent bypass, ever — in production the amount falls back to the bank's own visual PIN screen. |
| 9 | **Caregiver approval flow** | **Ask caregiver** button | Above-mandate or new-payee charges need an approval **issued and recorded by the server** for that exact intent + amount — the browser cannot self-declare one, and it can't be replayed for a different amount. |
| 10 | **Hardware biometrics (optional)** | Caregiver toggle `deviceBiometricSkipsPin` | Real **WebAuthn** platform authenticator (Touch ID / Windows Hello) with `userVerification: required`, assertion verified server-side; a *hardware* factor may skip the Voice PIN — a voiceprint never does. Where no authenticator exists it's an honestly-labelled simulator (`awaazpay-sim/1` vs `webauthn-platform/1`). |
| 11 | **Caregiver audit log** | Log modal (bottom right) | Every request, warning, yes/no, biometric/PIN result (digits redacted) and charge — human-readable, replayable, from 1,200 km away. |
| 12 | **Accessible everything** | Whole console | Speech-first, `aria-live` status, giant targets, keyboard shortcuts, on-screen keypad and typed-command fallbacks. No information conveyed by colour alone. |

---

## ⚔️ Differentiators

### vs. mainstream UPI apps (GPay / PhonePe / Paytm)

| Capability | Mainstream UPI apps | AwaazPay |
| --- | --- | --- |
| Authorization | Visual UPI PIN pad + visual OTP — eyes on glass, every time | One-time visual setup; daily authorization is a **spoken Voice PIN + voiceprint** |
| Who it's designed for | The seeing, literate, dexterous default user | Blind, low-literacy and elderly users as the **primary** user, not an afterthought |
| Caregiver model | None (screen-share/workarounds at best) | Named caregiver profile: tighten-only bounds, payee allowlist, server-issued approvals, full audit log |
| Scam defense | Post-fact fraud reporting | Direction-aware **collect-request refusal**, lookalike-VPA flags, amount tripwires, PIN lockout — *before* money moves |
| Agent integrity | LLM features answer questions | **The LLM only explains; a deterministic policy and the server decide.** Every charge is re-checked server-side against the mandate |

### vs. accessible-checkout & voice-payment efforts

| Effort | What it does | The gap AwaazPay fills |
| --- | --- | --- |
| Screen readers (TalkBack/VoiceOver) on UPI apps | Narrate the visual UI | The UPI PIN pad and OTP screens remain **visual secret-entry surfaces**; narrating them is still eye-and-ear gymnastics, and speaking a bank PIN aloud into a generic screen reader has no voiceprint binding |
| Accessibility checkouts (WCAG fixes, larger fonts, focus order) | Make the glass easier to see | Doesn't remove the glass — AwaazPay **replaces** the PIN pad interaction itself |
| Bank voice assistants (chat/voice FAQ bots) | Balance queries, branch info | They don't execute mandate-gated payments and have no caregiver consent model |
| NPCI **UPI123Pay** (feature phones) | IVR-based payments via keypad tones | Still a **keypad PIN (DTMF)**, still per-call menus — no caregiver mandate, no agentic guardrails, no collect-request direction refusal; AwaazPay targets smartphones the user already owns and adds the trust layer |
| autopay/e-mandate rails (UPI AutoPay, cards) | PIN-free *recurring* charges within limits | Rails only — AwaazPay is the **voice agent + policy + caregiver consent layer** that makes those rails usable hands-free and safely |

**The moat in one line:** everyone else makes the *visual* flow tolerable; AwaazPay is the
only end-to-end, mandate-gated, refusal-first voice flow where the honest answer is spoken
and the money can only move inside bounds a caregiver set.

---

## ⚖️ The compliance answer (RBI E-Mandate Framework 2026)

> **Judge question:** “RBI and Razorpay mandate a UPI PIN or OTP. How is this hands-free
> *and* legal?”

**The precise answer, with the citation:**

1. **The rule.** RBI's *Digital Payments – E-mandate Framework, 2026* (circular
   **RBI/DPSS/2026-27/396, dated 21 April 2026**) lets pre-authorised recurring/e-mandate
   transactions run **without additional factor of authentication up to ₹15,000 per
   transaction** across cards, UPI and prepaid instruments — raised from the ₹5,000 cap
   that stood since October 2021. (A ₹1,00,000 AFA-free limit exists only for mutual-fund
   SIPs, insurance premiums and credit-card bills.) Mandate **registration** still requires
   AFA, and a **24-hour pre-debit notification** remains mandatory.
2. **What AwaazPay does with it.** The caregiver registers the UPI AutoPay mandate **once**,
   entering the real UPI PIN **inside the bank's own secure surface** — that's the only
   visual secret in the system. Every in-mandate charge after that is a pre-authorized
   **Razorpay Server-to-Server** call (`/v1/orders` + `/v1/payments/create/recurring`) —
   no glass PIN pad is ever shown, exactly what the framework intends for e-mandates.
3. **Where AwaazPay is *stricter* than RBI.** RBI allows ₹15,000 AFA-free per transaction;
   AwaazPay additionally requires, per charge, a spoken confirmation bound to a voiceprint
   **and** a server-verified Voice PIN (or hardware WebAuthn factor), inside a
   **caregiver-set tighten-only bound and payee allowlist**. A profile edit can never widen
   the compliant cap — the server clamps it (`₹100 … ₹15,000`).
4. **Above the ceiling, there is no bypass.** The server refuses with
   `422 amount_outside_mandate` / `caregiver_approval_required`. In production that amount
   falls back to the **bank's own visual UPI PIN screen** — AwaazPay never automates it.
   Collect requests are refused on **direction**, matching NPCI's own scam guidance that a
   collect request is never authorization to pay.
5. **Data care.** Voice PIN digits are never stored or logged in clear (salted hash,
   constant-time compare, digits redacted in every transcript and log); the PIN has no
   recovery bypass — the caregiver re-sets it. Web Speech recognition runs on-device in
   Chrome; voice samples are not persisted by the demo. Caregiver consents and approvals are
   recorded server-side with an id, timestamp and signature — the paper trail DPDP-style
   consent expects.

**Sound-bite version:** *“We don't bypass the PIN — we relocate it: once, into the bank's
own screen, by the caregiver, when the mandate is created. RBI says charges inside a
₹15,000 e-mandate don't need re-authentication; what replaces it in AwaazPay is a stronger,
spoken, server-verified factor — and above that line we refuse and hand back to the bank.”*

---

## 🎬 The 7-minute live demo plan

Timings assume the caregiver setup was pre-staged (Scene 0 optional live). Full dialogue
lives in [`demo-script.md`](demo-script.md).

| Clock | Beat | What happens |
| --- | --- | --- |
| 0:00–0:40 | **Star story** | Sarla, the stranger at the kirana shop, ₹40,000 gone. One sentence on who fails today: *“the people UPI PINs and OTPs fail most.”* |
| 0:40–1:40 | **Caregiver setup (Scene 0)** | Replay caregiver setup: bounds (₹15,000/₹50,000, tighten-only), Voice PIN, payee allowlist, one-time real UPI PIN in the bank's surface. *“The only visual moment in AwaazPay.”* |
| 1:40–2:40 | **Happy path, fully hands-free (Scene 1)** | `Sharma kirana ko paanch sau rupaye bhejo` → truth spoken back → **“yes”** → Voice PIN → green receipt *“Paid hands-free · no PIN pad”*. Zero taps after she starts talking. |
| 2:40–3:10 | **Refusal beats approval (Scene 2)** | `exit — no transfer` mid-flow → cancelled, nothing moved. *“'No' can never be heard as a yes.”* |
| 3:10–4:10 | **The ₹50,000 collect-request scam (Scene 3)** | Agent explains the **direction**: money would leave her account → refuses outright. *“The exact attack that drains elderly accounts.”* |
| 4:10–5:00 | **The mandate ceiling (Scene 4)** | Chip: ₹25,000 → `422 amount_outside_mandate` → **Ask caregiver** → server-issued approval → caregiver-assisted flow. *“Above ₹15,000 there is no bypass — in production, the bank's PIN screen.”* |
| 5:00–5:45 | **Lookalike payee + PIN lockout (Scene 5)** | VPA mismatch flagged without burning a PIN attempt; three wrong PINs → lockout, payment abandoned. |
| 5:45–6:45 | **Proof wall (curl, below)** | Two live curls: *no token → 401 no charge* and *₹25,000 → 422 even with the correct PIN*. *“The gates are server code — curl can't talk its way past them either.”* |
| 6:45–7:00 | **Close** | Open the audit log, one line: the one-liner above. |

---

## 🧱 The proof wall (curl it live, no keys needed)

Server: `npm install && npm run dev` → `http://localhost:5173`. Smart Demo PIN is `1234`.
Every command below runs against the **shipped server code** — same endpoints, same gates
the UI uses.

```bash
BASE=http://localhost:5173
```

**1. Mode honesty — what's configured, what's simulated:**

```bash
curl -s $BASE/api/health | jq
# { ok: true, paymentMode: "smart-demo", intentMode: "smart-demo-local-simulator",
#   mandate: { perTransactionLimit: 15000, status: "active" }, ... }
```

**2. The mandate is the compliance boundary — bounds, wallet, allowlist:**

```bash
curl -s $BASE/api/mandate | jq '{perTransactionLimit, dailyLimit, usedToday,
  authorizedPayees: [.authorizedPayees[].name]}'
# perTransactionLimit: 15000  ·  dailyLimit: 50000
```

**3. No Voice PIN token → no charge. Raw curl gets the same answer as a stolen phone:**

```bash
curl -s -X POST $BASE/api/payment/execute \
  -H 'content-type: application/json' \
  -d '{"intentId":"INT-DEMO","amountPaise":50000,"payee":"Sharma Kirana"}' | jq
# 401 { "code": "missing_or_expired_auth_token",
#       "error": "A valid Voice PIN mandate-auth token is required. No token means no hands-free charge." }
```

**4. Above the ₹15,000 ceiling → refused before the PIN is even scored** (correct PIN in
hand — still refused, no attempt burned, no token issued):

```bash
curl -s -X POST $BASE/api/voice-pin/verify \
  -H 'content-type: application/json' \
  -d '{"sessionId":"SES-CURL-1","pinDigits":"1234","intentId":"INT-BIG",
       "amountPaise":2500000,"payee":"Mehta Utilities","payeeVpa":"mehta.utility@ybl"}' | jq
# 422 { "verified": false, "code": "caregiver_approval_required",
#       "reason": "₹25,000 is above the ₹15,000 hands-free mandate limit. A caregiver must approve it before a Voice PIN can authorize it." }
```

**5. A payee outside the allowlist → refused without burning a PIN attempt:**

```bash
curl -s -X POST $BASE/api/voice-pin/verify \
  -H 'content-type: application/json' \
  -d '{"sessionId":"SES-CURL-2","pinDigits":"1234","intentId":"INT-LOOKALIKE",
       "amountPaise":50000,"payee":"Sharma Kiran Store","payeeVpa":"sharma.kirana@okaxis"}' | jq
# 422 { "code": "payee_not_on_mandate", "authorizedPayees": ["Sharma Kirana", "Rakesh Medical", "Mehta Utilities"] }
```

**6. Three wrong PINs → lockout, payment abandoned:**

```bash
for i in 1 2 3; do curl -s -X POST $BASE/api/voice-pin/verify \
  -H 'content-type: application/json' \
  -d '{"sessionId":"SES-BRUTE","pinDigits":"9999","intentId":"INT-BRUTE",
       "amountPaise":50000,"payee":"Sharma Kirana","payeeVpa":"sharmakirana@ybl"}' \
  | jq -c 'if .locked then {locked, retryInSeconds} else {attemptsLeft, locked} end'; done
# {"attemptsLeft":2,"locked":false}  →  {"attemptsLeft":1,"locked":false}  →  {"locked":true,"retryInSeconds":60}
```

**7. The full hands-free charge, end to end** — correct PIN in-mandate → signed,
intent-bound token → S2S capture, `visualPinPadShown: false`:

```bash
TOKEN=$(curl -s -X POST $BASE/api/voice-pin/verify -H 'content-type: application/json' \
  -d '{"sessionId":"SES-PAY","pinDigits":"1234","intentId":"INT-OK","amountPaise":50000,
       "payee":"Sharma Kirana","payeeVpa":"sharmakirana@ybl"}' | jq -r .authToken)
curl -s -X POST $BASE/api/payment/execute -H 'content-type: application/json' \
  -d "{\"authToken\":\"$TOKEN\",\"intentId\":\"INT-OK\",\"amountPaise\":50000,
       \"payee\":\"Sharma Kirana\",\"payeeVpa\":\"sharmakirana@ybl\"}" \
  | jq -c '{payment: .payment.status, authorizationMode, visualPinPadShown, walletBalance, usedToday}'
# {"payment":"captured","authorizationMode":"voice-pin-hands-free","visualPinPadShown":false,"walletBalance":39500,"usedToday":500}
```

**8. Caregiver upgrade, server-issued** — approve the ₹25,000 from step 4, then the same
Voice PIN succeeds as *caregiver-assisted*:

```bash
AID=$(curl -s -X POST $BASE/api/caregiver/approve -H 'content-type: application/json' \
  -d '{"intentId":"INT-BIG","amountPaise":2500000}' | jq -r .approvalId)
TOKEN=$(curl -s -X POST $BASE/api/voice-pin/verify -H 'content-type: application/json' \
  -d "{\"sessionId\":\"SES-BIG\",\"pinDigits\":\"1234\",\"intentId\":\"INT-BIG\",
       \"amountPaise\":2500000,\"caregiverApprovalId\":\"$AID\",
       \"payee\":\"Mehta Utilities\",\"payeeVpa\":\"mehta.utility@ybl\"}" | jq -r .authToken)
curl -s -X POST $BASE/api/payment/execute -H 'content-type: application/json' \
  -d "{\"authToken\":\"$TOKEN\",\"intentId\":\"INT-BIG\",\"amountPaise\":2500000,
       \"payee\":\"Mehta Utilities\",\"payeeVpa\":\"mehta.utility@ybl\"}" | jq -c '{authorizationMode, visualPinPadShown}'
# { "authorizationMode": "caregiver-assisted", "visualPinPadShown": false }
```

**9. And the token from step 7 is dead** — it was bound to `INT-OK` only, and expires in
90 seconds:

```bash
curl -s -X POST $BASE/api/payment/execute -H 'content-type: application/json' \
  -d "{\"authToken\":\"$TOKEN\",\"intentId\":\"INT-SOMEONE-ELSE\",\"amountPaise\":50000}" | jq -c '{code}'
# { "code": "intent_mismatch" }
```

> Presenting tip: run 3 → 4 → 9 in that order. They prove, in twenty seconds, that the
> three claims judges probe hardest — *no silent charges*, *the ceiling is real*, *tokens
> can't be replayed* — are enforced in server code, not in the pitch.

---

## 🧪 Real vs simulated (say this before they ask)

| Layer | Status today | In production |
| --- | --- | --- |
| Speech-to-text | Real, on-device (Web Speech API in Chrome/Edge) | Same |
| Intent parsing | **Real Groq** (`llama-3.3-70b`) with keys; local simulator without — identical JSON shape | Groq or an on-device SLU |
| Payments | Razorpay **S2S REST flow simulated** with the identical response shape (`/v1/orders` → `/v1/payments/create/recurring`) | Same calls, Razorpay keys |
| Voiceprint | Simulator, labelled `awaazpay-voiceprint-sim/1` | Enrolled speaker-verification model with liveness/anti-replay |
| Fingerprint / face | **Real WebAuthn** against the platform authenticator where available; labelled simulator otherwise | Same, plus attestation |
| Caregiver approval | Server-issued and recorded (decision simulated) | Caregiver's own auth event on their device |

Every receipt and log line names its engine. The demo never pretends a simulator is a
biometric sensor — that honesty is itself part of the pitch.

---

## 🧭 What we'd build next (30/60/90)

- **30 days:** Razorpay test-mode end-to-end (real UPI AutoPay mandate registration in the
  sandbox), enrolled speaker-verification model behind the existing `verifyVoicePin`
  interface, Hindi-first TTS tuning.
- **60 days:** Caregiver app (PWA) with push approvals + the 24-hour pre-debit notification
  feed the e-mandate framework requires; multi-language (Tamil, Telugu, Bengali) intent
  packs.
- **90 days:** Pilot with an NGO for the visually impaired + one bank's UPI AutoPay stack;
  DPDP-aligned consent vault for caregiver mandates; fraud-signal sharing with the bank's
  risk engine.

## 🙏 The ask

Track 05 — Open Track. Looking for: Razorpay API mentorship to take the mandate flow to
test-mode live, accessibility partners for user testing, and a bank/NPCI conversation about
voice-factor standards for mandate-based charges.
