# AwaazPay — Demo & Pitch Pack

*Razorpay Hackathon 2026 · Track 05 — Open Track*
*A Voice-First, Agentic Payment Companion for the Blind, Low-Literacy & Elderly*

Everything in this pack is demo-able with `npm install && npm run dev` and **zero API
keys** — Smart Demo Mode runs the whole loop locally. Add Razorpay + Groq keys and the
exact same UI drives live Server-to-Server mandate charges.

---

## ⭐ The Star Story (90 seconds — open with this)

**Cast.** Sarla Devi, 72, lives alone in Jaipur. She can barely read the small text on her
phone and has never once typed her UPI PIN without asking someone to look. Her daughter
Meera lives in Pune.

**The way it works today.** Last month Sarla tried to pay the kirana shop ₹500. She could
not read the PIN pad, asked a “helpful” stranger beside her, and ₹40,000 was gone before she
understood what happened. That is the real, daily, documented cost of a glass keypad:
**the people AwaazPay is built for are the people UPI PINs and OTPs fail most often.**

**The one-time fix (visual).** Meera comes home once. On the **caregiver setup screen** she:
1. puts in her own name, relationship and phone (so approval calls reach her),
2. sets the hands-free bounds — ₹15,000 per transaction, ₹50,000 a day (the RBI e-mandate
   ceiling, raised from ₹5,000 in April 2026 — and she can only tighten, never widen),
3. sets Sarla's **Voice PIN** and enrolls her voice once,
4. adds the three merchants Sarla actually pays to the **trusted-payee allowlist**,
5. enters the real UPI PIN **one time**, inside the bank's own secure surface, to register
   the Razorpay UPI AutoPay mandate.

**The daily fix (hands-free).** That evening Sarla holds the phone and says:

> **“Sharma kirana ko paanch sau rupaye bhejo.”**

The agent speaks the truth back: *“You are about to pay ₹500 to Sharma Kirana at
sharmakirana@ybl. This is a payment you started. Say yes to confirm, or no to cancel.”* —
and the microphone stays open. She says **“haan bhej do.”** It asks for her Voice PIN; she
says **“ek do teen char.”** Two seconds later: *“Done. Five hundred rupees paid to Sharma
Kirana. No PIN screen was opened.”**

**Why that is legal.** Sarla never bypassed the UPI PIN — she did it **once**, on a
mandate her daughter set up, inside the bank's secure surface. Every in-limit payment after
that is a pre-authorized **Razorpay Server-to-Server** charge on that mandate. The only
*new* thing AwaazPay adds is the device-level gate that replaces the glass keypad for
everyday life: a **Voice PIN + voiceprint** that a bystander shouting across the room cannot
provide.

---

## 🎬 The Live Demo Script (6 minutes, 6 scenes)

> **Tip for the presenter:** do the caregiver setup (Scene 0) once before going on stage so
> the live demo is the payment loop itself. Keep the tab on Chrome/Edge, mic allowed, served
> over `localhost` or HTTPS. The demo Voice PIN is **1234** (“one two three four” / “ek do
> teen char” / the word “PIN”).

### Scene 0 — Caregiver setup (the one visual moment) · 60s
Open **Replay caregiver setup** (right rail). Talk while it animates:
- “This is the *only* step that needs eyes on glass. Meera — the daughter — registers the
  mandate and enters the real UPI PIN once, in the bank app.”
- Edit the form live: change the elder to a name from the audience, set the per-transaction
  limit to ₹4,000, add a payee e.g. **Gupta Dairy / gupta.dairy@okhdfcbank**, save.
- Point out: *“She can set the limit lower than the RBI ceiling — never higher.”*
- Enroll the voice biometric (say “AwaazPay my kirana bill” when asked) and optionally a
  fingerprint/face. Leave “fingerprint skips PIN” **off** for the core demo — Voice PIN is
  the star.

### Scene 1 — The happy path, fully hands-free · 60s
1. Click the mic (or “Start speaking”).
2. Say: **“Sharma kirana ko paanch sau rupaye bhejo.”**
3. Wait for the spoken summary — and **don't touch anything**. The mic re-opens on its own.
4. Say: **“yes”** (or “haan bhej do”).
5. On the blue **🛡️ WAITING FOR VOICE PIN** badge, say: **“one two three four.”**
6. Green receipt: **“Paid hands-free · no PIN pad.”**
- Line to say: *“Zero taps after she started talking. The caregiver log at the bottom shows
  every decision — with the PIN redacted to dots.”*

### Scene 2 — Spoken refusal · 30s
1. Start the safe payment again.
2. When asked yes/no, say: **“exit — no transfer.”**
3. Show: payment cancelled, wallet unchanged, log line **“cancelled by voice.”**
- Line: *“Refusal is matched before approval. ‘No, don’t transfer’ can never be heard as a
  yes. Nothing moved.”*

### Scene 3 — The collect-request scam (the ₹50,000 pull) · 60s
1. Say (or click **Collect request**): **“A collect request for pachas hazar has arrived.”**
2. Agent, red: *“This is a collect request for ₹50,000. It would take money **from**
   you — this is not a payment you started. My mandate never covers pull requests.”*
3. Click **Say NO · decline request** (or say “no”).
- Line: *“This is the exact attack that drains elderly accounts. A normal payment app shows
  a PIN pad. AwaazPay refuses the direction itself — a collect request can never be charged
  on a push mandate.”*

### Scene 4 — The mandate guard (above ₹15,000) · 45s
1. Click **Above mandate limit** (₹25,000 to Mehta Utilities).
2. Acknowledge the spoken warning, then click **Ask caregiver** — the demo simulates Meera's
  signed, server-recorded approval.
3. Only now can the flow proceed, labelled **“caregiver assisted.”**
- Line: *“Above the mandate there is **no bypass**. The server returns `422
  amount_outside_mandate` until a caregiver approval it issued itself is presented — the
  browser cannot just claim one. In production this amount falls back to the bank's visual
  PIN screen.”*

### Scene 5 — Lookalike payee + wrong PIN lockout · 45s
1. Click **Lookalike payee**: ask for “Sharma Kirana” but the resolved VPA is
   “Sharma Kiran Store” at sharma.kirana@okaxis — flagged.
2. Then, on any safe payment, enter PIN **9999** three times via the keypad.
3. Show the **Voice PIN locked** screen: payment abandoned, nothing charged, lockout in the
   caregiver log.
- Line: *“Identity check is on the VPA, not the display name. And the PIN has three strikes —
  a bystander brute-forcing the phone just locks it.”*

### Wrap · 15s
Open the **Caregiver audit log** modal. *“Every request, every warning, every yes/no, every
charge — human-readable, replayable, PIN redacted. Meera can see the whole story of her
mother's money from 1,200 km away.”*

---

## 💥 Failure Stories (tell these — judges remember them)

Use these as “what happens when…”, and note each ends with **no money lost**.

1. **The stranger in the queue.** A bystander sees Sarla paying and shouts “pay five
   hundred!” at the phone. The agent recognizes her command shape, but the charge requires
   *her* Voice PIN / voiceprint. His shout cannot authorize anything. *Failure mode,
   defeated by the second factor.*

2. **The “one-time OTP” phone scam.** A caller says “Pension department — I've sent a
   collect request, just approve and enter the PIN.” AwaazPay identifies the request's
   **direction**: money would leave *her* account. It refuses it outright and tells her to
   say no — there is no PIN pad for the scammer to walk her through.

3. **The spoofed shop name.** Fraudster UPI ID “sharma.kirana@okaxis” sits next to the real
   “sharmakirana@ybl”. She says the shop's name; the resolved account name doesn't match and
   the VPA isn't on the caregiver allowlist → the server refuses `payee_not_on_mandate`
   without even burning a PIN attempt.

4. **The fat-fingered / inflated amount.** “Pachaas hazaar” instead of “paanch sau” lands
   as ₹50,000 — 100× her usual. The amount tripwire forces a spoken acknowledgement *and*
   the caregiver-approval gate; it never silently goes through.

5. **Mumbled, partial, misheard.** She says “ek do teen” and trails off. The agent says “I
   only caught 3 digits — say all four, or say cancel.” No attempt is burned, no half-charge.
   If she says “repeat?” it re-prompts for free.

6. **“No” sounds like “nine”.** At the PIN step the word “no” is deliberately **not** treated
   as the digit 9 — it means *stop*. Refusal always beats a digit stream.

7. **No microphone / noisy street / permission off.** Every voice step has an on-screen
   keypad, keyboard digits, and a typed-command fallback — and the agent reads everything
   aloud, so a blind user never loses the flow.

8. **Wrong PIN ×3.** Three misses lock the PIN and abandon the payment. Balance untouched.
   Lockout is recorded for the caregiver.

9. **The mandate runs dry.** Daily utilisation or wallet balance exhausted → server refuses
   with `daily_limit_exhausted` / `insufficient_wallet_balance` rather than prompting the
   visual PIN.

10. **Bigger than daily life ever needs.** Anything above ₹15,000 cannot be done hands-free
    *at all*. The agent itself directs her to caregiver approval / the bank's PIN screen —
    AwaazPay refuses to pretend it can bypass the rule.

---

## ❓ Judge Q&A (the hard questions, pre-answered)

**“But RBI/Razorpay mandate a UPI PIN or OTP — how is this hands-free and compliant?”**
The PIN isn't bypassed — it is done **once**, visually by the caregiver, inside the bank's
own secure surface, to create a **UPI AutoPay mandate** (or load a closed-loop Razorpay
wallet). RBI's *Digital Payments – E-mandate Framework, 2026* (circular
RBI/DPSS/2026-27/396, dated 21 Apr 2026) allows e-mandate charges up to **₹15,000 per
transaction** without re-authentication — raised from ₹5,000 in April 2026 (₹1 lakh applies
only to mutual-fund SIPs, insurance premiums and credit-card bills). In-mandate payments are
therefore pre-authorized Server-to-Server Razorpay calls; no glass PIN pad is triggered.
Above the mandate, the charge is refused and falls back to the bank PIN screen — we never
automate that.

**“Couldn't someone just shout at the phone and spend?”**
No. The spoken command only *prepares* a payment. Two gates remain: a spoken confirmation
that is also matched against an enrolled **voiceprint**, and a **Voice PIN** hashed on the
server, plus optional hardware fingerprint/face (WebAuthn, `userVerification: required`,
assertion signature verified server-side). Three wrong PIN attempts lock it out.

**“Is the Voice PIN secure? It's just four spoken digits.”**
Digits are redacted at capture (never on screen, never in the log), hashed with a salt and
compared in constant time on the server, and paired with a voiceprint score. A successful
check returns an **HMAC-signed, 90-second token bound to that exact intent, amount and
payee**; `/api/payment/execute` refuses everything without it, and the token cannot be
replayed against a different payment. In production the voiceprint is an enrolled
speaker-verification model with liveness/anti-replay; the simulator is labelled honestly.

**“Why trust the app's safety checks? Can the AI hallucinate a payment?”**
The LLM only *explains*. A deterministic policy (`applyRiskPolicy`) decides risk, and the
**server re-checks everything independently** — per-transaction cap, daily utilisation,
wallet balance, and the caregiver payee allowlist. A hallucinated amount or a crafted API
call hits the same gates. Payee allowlist and limit refusals happen *before* the PIN is
even scored.

**“Where's the caregiver consent and audit?”**
The caregiver is a named profile with relationship and approval phone; above-mandate or
new-payee charges require a signed approval **issued by the server** for that exact intent
and amount — the browser can't self-declare one. Every request, warning, confirmation,
biometric/PIN result (digits redacted) and charge is in the replayable audit log.

**“What's real versus simulated right now?”**
Intent parsing → Groq (real) with a local simulator fallback. Payments → Razorpay S2S REST
flow (`/v1/orders` + `/v1/payments/create/recurring`), simulated with the identical
response shape when keys are absent. Fingerprint/face → **real WebAuthn** against the
platform authenticator where one exists, labelled simulator where not. Voiceprint and
caregiver approval decision are simulated with the decision logic living on the server.
Every receipt and log line names its engine.

**“What about screen readers / keyboard-only users?”**
The whole console is speech-driven, with `aria-live` status, giant touch targets, keyboard
shortcuts, on-screen keypad, and typed-command fallback. No information is conveyed by color
alone.

---

## 🗣 One-line pitch

> **“AwaazPay moves the UPI PIN to a one-time caregiver mandate and replaces the glass
> keypad with a spoken PIN and voiceprint — so the people who can't read the PIN pad never
> have to ask a stranger again.”**
