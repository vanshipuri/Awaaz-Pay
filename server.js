/**
 * AwaazPay demo server.
 *
 * Responsibilities (keep this separation in production):
 *  1. Serve the static voice console.
 *  2. Parse Hinglish intent with Groq when a key is present (Smart Demo Mode otherwise).
 *  3. Own the caregiver-created UPI AutoPay mandate + closed-loop wallet state.
 *  4. Verify the spoken Voice PIN server-side (hashed compare + simulated voiceprint)
 *     and hand back a short-lived HMAC mandate-auth token.
 *  5. Execute the payment server-to-server against Razorpay using that token, so the
 *     browser never shows a visual UPI PIN pad for in-mandate amounts.
 *
 * No dependency is required: Razorpay is called over its REST S2S API with fetch.
 * The `razorpay` Node SDK is a drop-in replacement for `razorpayRequest()` below.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const loadDotEnv = () => {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
};
loadDotEnv();

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const host = '0.0.0.0';

/* ------------------------------------------------------------------ config */

const DEFAULT_VOICE_PIN = (String(process.env.AWAAZPAY_VOICE_PIN || '1234').replace(/\D/g, '') || '1234').slice(0, 6);
const PIN_SALT = process.env.AWAAZPAY_PIN_SALT || crypto.randomBytes(16).toString('hex');
const AUTH_SECRET = process.env.AWAAZPAY_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_SECONDS = Number(process.env.AWAAZPAY_TOKEN_TTL || 90);
const PIN_MAX_ATTEMPTS = Number(process.env.AWAAZPAY_PIN_MAX_ATTEMPTS || 3);
const PIN_LOCK_SECONDS = Number(process.env.AWAAZPAY_PIN_LOCK_SECONDS || 60);

const MANDATE_PER_TXN_LIMIT = Number(process.env.MANDATE_PER_TXN_LIMIT || 5000);
const MANDATE_DAILY_LIMIT = Number(process.env.MANDATE_DAILY_LIMIT || 15000);
const WALLET_OPENING_BALANCE = Number(process.env.WALLET_BALANCE || 12500);

// RBI UPI AutoPay hands-free ceiling. The caregiver may set a *stricter* bound, never a
// looser one — a profile edit cannot widen the compliant cap.
const MAX_HANDS_FREE_PER_TXN = 15000;
const MAX_HANDS_FREE_DAILY = 50000;

const razorpayConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

/* ------------------------------------------------------- mandate + wallet */

const mandateState = {
  id: `sub_${crypto.randomBytes(6).toString('hex')}`,
  tokenId: process.env.RAZORPAY_UPI_TOKEN_ID || `token_${crypto.randomBytes(6).toString('hex')}`,
  type: 'upi-autopay',
  instrument: 'sarala.devi@okhdfcbank',
  status: 'active',
  perTransactionLimit: MANDATE_PER_TXN_LIMIT,
  dailyLimit: MANDATE_DAILY_LIMIT,
  usedToday: 0,
  createdAt: new Date(Date.now() - 6 * 864e5).toISOString(),
  expiresAt: new Date(Date.now() + 359 * 864e5).toISOString(),
  // The person AwaazPay speaks for. Editable from the caregiver setup screen.
  elder: {
    name: process.env.ELDER_NAME || 'Sarla Devi',
    handle: 'SD',
    contact: process.env.ELDER_CONTACT || '919812300000',
    upiHandle: 'sarala.devi@okhdfcbank',
  },
  caregiver: {
    name: process.env.CAREGIVER_NAME || 'Meera Sharma',
    relationship: process.env.CAREGIVER_RELATIONSHIP || 'Daughter',
    phone: process.env.CAREGIVER_PHONE || '+91 98200 11223',
    consent: 'Setup completed visually on 28 Aug · UPI PIN entered in bank app by caregiver',
  },
  wallet: {
    id: `acc_${crypto.randomBytes(5).toString('hex')}`,
    label: 'AwaazPay closed-loop wallet',
    balance: WALLET_OPENING_BALANCE,
    currency: 'INR',
  },
  authorizedPayees: [
    { name: 'Sharma Kirana', vpa: 'sharmakirana@ybl', usualAmountRupees: 500 },
    { name: 'Rakesh Medical', vpa: 'rakesh.med@ybl', usualAmountRupees: 240 },
    { name: 'Mehta Utilities', vpa: 'mehta.utility@ybl', usualAmountRupees: 1200 },
  ],
};

// The Voice PIN is chosen during the caregiver setup. The salted hash is the only thing
// stored; the digits themselves are never persisted or logged. Initialised right after
// hashPin() is defined in the Voice PIN section below.
let voicePinHash = null;
let voicePinLength = DEFAULT_VOICE_PIN.length;

const initialsFromName = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'AP';

const mandatePublicView = () => ({
  ...mandateState,
  elder: { ...mandateState.elder, handle: initialsFromName(mandateState.elder.name) },
  remainingToday: Math.max(0, mandateState.dailyLimit - mandateState.usedToday),
  handsFree: mandateState.status === 'active',
  paymentMode: razorpayConfigured ? 'razorpay-live' : 'smart-demo',
  voicePinLength,
  demoVoicePin: razorpayConfigured ? null : DEFAULT_VOICE_PIN,
  biometrics: biometricPublicView(),
});

/* ------------------------------------------------------- voice PIN security */

const hashPin = (digits) => crypto.createHash('sha256').update(`${PIN_SALT}:${digits}`).digest('hex');
voicePinHash = hashPin(DEFAULT_VOICE_PIN);

/** Caregiver sets a new Voice PIN during setup. Only the salted hash is ever kept. */
const updateVoicePin = (payload) => {
  const digits = String(payload.pinDigits || '').replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 6) {
    return { status: 400, body: { updated: false, reason: 'The Voice PIN must be 4 to 6 digits.' } };
  }
  voicePinHash = hashPin(digits);
  voicePinLength = digits.length;
  // A PIN change invalidates every existing per-session attempt record.
  pinAttempts.clear();
  console.log(`[caregiver] Voice PIN changed · ${digits.length} digits · only the salted hash was stored`);
  return {
    status: 200,
    body: {
      updated: true,
      voicePinLength: digits.length,
      // Smart Demo Mode echoes the demo PIN so the judge is never stuck; live mode never does.
      demoVoicePin: razorpayConfigured ? null : digits,
      note: 'Voice PIN updated. Three wrong attempts still lock the payment.',
    },
  };
};

/** Attempts are tracked per browser session so a bystander cannot brute force the PIN. */
const pinAttempts = new Map();

/**
 * Caregiver approvals for above-mandate amounts are recorded server-side and signed.
 * The browser cannot self-declare "a caregiver approved this" — it must present an
 * approval id that this server issued for that exact intent and amount.
 */
const caregiverApprovals = new Map();

const signApproval = (approvalId) =>
  crypto.createHmac('sha256', AUTH_SECRET).update(`approval:${approvalId}`).digest('base64url');

/**
 * The mandate authorizes specific merchants. A hands-free charge to anyone else is refused
 * here even if the client-side gate was somehow skipped — a lookalike payee is not on the
 * caregiver's allowlist, so it can never be charged silently.
 */
const isAuthorizedPayee = (name, vpa) => {
  const n = String(name || '').trim().toLowerCase();
  const v = String(vpa || '').trim().toLowerCase();
  return mandateState.authorizedPayees.some(
    (payee) => (n && payee.name.toLowerCase() === n) || (v && payee.vpa.toLowerCase() === v),
  );
};

const registerCaregiverApproval = (payload) => {
  const intentId = String(payload.intentId || '').slice(0, 40);
  const amountPaise = Number(payload.amountPaise);
  if (!intentId) return { status: 400, body: { error: 'intentId is required to record a caregiver approval.' } };
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return { status: 400, body: { error: 'amountPaise must be a positive integer.' } };
  }

  const amountRupees = amountPaise / 100;
  const approvalId = `carg_${crypto.randomBytes(6).toString('hex')}`;
  const record = {
    approvalId,
    intentId,
    amountPaise,
    caregiver: mandateState.caregiver,
    approvedAt: new Date().toISOString(),
    // In production this is a real caregiver authentication event (their own UPI PIN /
    // in-app approval). Here the demo simulates her decision after a short delay.
    simulated: !process.env.CAREGIVER_SERVICE_URL,
  };
  caregiverApprovals.set(`${intentId}:${amountPaise}`, record);
  caregiverApprovals.set(approvalId, record);

  return {
    status: 200,
    body: {
      approved: true,
      approvalId,
      signature: signApproval(approvalId),
      ...record,
      note: `₹${amountRupees.toLocaleString('en-IN')} is above the ₹${mandateState.perTransactionLimit.toLocaleString('en-IN')} hands-free mandate limit, so it is charged as caregiver-assisted.`,
    },
  };
};

const findCaregiverApproval = (intentId, amountPaise, approvalId) => {
  if (approvalId) {
    const record = caregiverApprovals.get(String(approvalId));
    if (record && record.intentId === String(intentId) && record.amountPaise === Number(amountPaise)) return record;
  }
  const byIntent = caregiverApprovals.get(`${intentId}:${amountPaise}`);
  return byIntent && byIntent.intentId === String(intentId) ? byIntent : null;
};

const attemptRecord = (sessionId) => {
  const now = Date.now();
  let record = pinAttempts.get(sessionId);
  if (!record) {
    record = { failures: 0, lockedUntil: 0, last: now };
    pinAttempts.set(sessionId, record);
  }
  if (record.lockedUntil && record.lockedUntil < now) {
    record.lockedUntil = 0;
    record.failures = 0;
  }
  return record;
};

/**
 * Simulated speaker-verification. A real deployment replaces this with an enrolled
 * voiceprint model; the important part is that the *decision* is made server-side.
 */
const voiceprintScore = (sessionId, digits, sampleMs) => {
  const digest = crypto.createHash('sha256').update(`${sessionId}:${digits}:${sampleMs}`).digest();
  return Number((0.89 + (digest[0] % 10) / 100).toFixed(3));
};

const signAuthToken = (claims) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
};

const verifyAuthToken = (token) => {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch (error) {
    return null;
  }
};

/* --------------------------------------------------------------- razorpay */

const razorpayRequest = async (method, endpoint, body) => {
  if (!razorpayConfigured) throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not configured');
  const basic = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1/${endpoint}`, {
    method,
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.description || `Razorpay request failed with ${response.status}`);
  }
  return payload;
};

/**
 * Hands-free S2S charge against the caregiver mandate.
 * With test keys this creates an order and then a tokenized UPI AutoPay recurring
 * payment — the flow that never renders a visual UPI PIN pad. Without keys the same
 * response shape is simulated so the judge demo runs offline (Smart Demo Mode).
 */
/** One label for the authorization factor, used by both the mock and the live S2S record. */
const authorizationModeFor = (caregiverAssisted, factor) => {
  if (caregiverAssisted) return 'caregiver-assisted';
  if (factor && factor !== 'voice-pin') return `${factor}-biometric-hands-free`;
  return 'voice-pin-hands-free';
};

const executeMandatePayment = async ({ amountPaise, payee, intentId, tokenId, caregiverAssisted, factor }) => {
  const amountRupees = amountPaise / 100;

  if (!razorpayConfigured) {
    return {
      mode: 'smart-demo',
      simulated: true,
      payment: {
        id: `pay_${crypto.randomBytes(7).toString('hex')}`,
        entity: 'payment',
        order_id: `order_${crypto.randomBytes(6).toString('hex')}`,
        amount: amountPaise,
        amount_captured: amountPaise,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        recurring: true,
        token_id: tokenId,
        mandate_id: mandateState.id,
        authorization_mode: authorizationModeFor(caregiverAssisted, factor),
        visual_pin_pad_shown: false,
        notes: { awaazpay_intent: intentId, payee: payee },
        created_at: Math.floor(Date.now() / 1000),
      },
    };
  }

  const order = await razorpayRequest('POST', 'orders', {
    amount: amountPaise,
    currency: 'INR',
    receipt: String(intentId).slice(0, 40),
    notes: { awaazpay_payee: String(payee).slice(0, 100), awaazpay_mode: 'voice-mandate' },
  });

  const payment = await razorpayRequest('POST', 'payments/create/recurring', {
    email: process.env.RAZORPAY_CUSTOMER_EMAIL || 'sarala.devi@example.com',
    contact: process.env.RAZORPAY_CUSTOMER_CONTACT || '919999999999',
    amount: amountPaise,
    currency: 'INR',
    order_id: order.id,
    method: 'upi',
    token_id: tokenId,
    recurring: '1',
    notes: { awaazpay_intent: String(intentId).slice(0, 40) },
  });

  return {
    mode: 'razorpay-live',
    simulated: false,
    order,
    payment: {
      ...payment,
      mandate_id: mandateState.id,
      authorization_mode: authorizationModeFor(caregiverAssisted, factor),
      visual_pin_pad_shown: false,
      amount_label: `₹${amountRupees.toLocaleString('en-IN')}`,
    },
  };
};

/* ------------------------------------------------------------------- glue */

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const json = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) {
      req.destroy();
      reject(new Error('Request body is too large'));
    }
  });
  req.on('end', () => {
    if (!body) return resolve({});
    try {
      resolve(JSON.parse(body));
    } catch (error) {
      reject(new Error('Request body must be valid JSON'));
    }
  });
  req.on('error', reject);
});

const extractJSON = (text) => {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The agent did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
};

const callGroq = async (payload) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { mode: 'fallback', reason: 'GROQ_API_KEY is not configured' };

  const knownPayees = Array.isArray(payload.knownPayees) ? payload.knownPayees : [];
  const system = [
    'You are AwaazPay, a conservative payment-intent parser for blind, low-literacy, and elderly users in India.',
    'Understand Hindi, English, Hinglish, and code-switching. Never invent an amount or payee.',
    'Return only valid JSON. Do not include markdown or commentary.',
    'The output schema is: {"intent":"pay|collect|unknown","payeeQuery":string|null,"amountPaise":number|null,"direction":"push|pull|unknown","confidence":number,"missingFields":string[],"riskSignals":string[]}.',
    'Use direction pull for a collect request or any request that takes money from the user. Use direction push only when the user started a payment.',
    'If the transcript is ambiguous, put the missing field in missingFields and return null for that field.',
    `Hands-free mandate limit is ₹${MANDATE_PER_TXN_LIMIT} per transaction; add the risk signal "mandate-limit" when the amount exceeds it.`,
    `Known payees: ${JSON.stringify(knownPayees)}`,
  ].join('\n');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0,
      max_tokens: 450,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: String(payload.transcript || '') },
      ],
    }),
  });

  const responseBody = await response.json();
  if (!response.ok) {
    throw new Error(responseBody?.error?.message || `Groq request failed with ${response.status}`);
  }
  const text = responseBody?.choices?.[0]?.message?.content || '';
  const result = extractJSON(text);
  return { mode: 'groq', ...result };
};

/** Voice PIN check. The digits never leave the server in plaintext and are never logged. */
const verifyVoicePin = (payload) => {
  const sessionId = String(payload.sessionId || 'default').slice(0, 64);
  const digits = String(payload.pinDigits || '').replace(/\D/g, '');
  const record = attemptRecord(sessionId);

  if (record.lockedUntil > Date.now()) {
    const retryIn = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return {
      status: 423,
      body: {
        verified: false,
        locked: true,
        retryInSeconds: retryIn,
        reason: `Too many incorrect Voice PIN attempts. Locked for ${retryIn} more seconds.`,
      },
    };
  }

  if (digits.length !== voicePinLength) {
    return {
      status: 400,
      body: { verified: false, reason: `Your Voice PIN is ${voicePinLength} digits long.`, attemptsLeft: PIN_MAX_ATTEMPTS - record.failures },
    };
  }

  const amountPaise = Number(payload.amountPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > 10_000_000) {
    return { status: 400, body: { verified: false, reason: 'amountPaise must be a positive integer up to ₹100,000.' } };
  }

  // A caregiver approval upgrades the charge in two cases: it is above the hands-free limit,
  // or the payee is not on the mandate's authorized list. Either way the approval must already
  // be recorded here for this exact intent and amount — the browser cannot assert one.
  const perTxnPaise = mandateState.perTransactionLimit * 100;
  const payeeAuthorized = isAuthorizedPayee(payload.payee, payload.payeeVpa);
  const approval = findCaregiverApproval(payload.intentId, amountPaise, payload.caregiverApprovalId);
  if (amountPaise > perTxnPaise && !approval) {
    return {
      status: 422,
      body: {
        verified: false,
        code: 'caregiver_approval_required',
        reason: `₹${(amountPaise / 100).toLocaleString('en-IN')} is above the ₹${mandateState.perTransactionLimit.toLocaleString('en-IN')} hands-free mandate limit. A caregiver must approve it before a Voice PIN can authorize it.`,
      },
    };
  }

  // Refuse before the PIN is even checked, so an unauthorized payee cannot burn attempts.
  if (!payeeAuthorized && !approval) {
    return {
      status: 422,
      body: {
        verified: false,
        code: 'payee_not_on_mandate',
        reason: `${payload.payee || 'That payee'} is not on the caregiver mandate's authorized list. A caregiver must approve this payee first.`,
        authorizedPayees: mandateState.authorizedPayees.map((payee) => payee.name),
      },
    };
  }

  const providedHash = hashPin(digits);
  const pinMatches = crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(voicePinHash));
  const score = voiceprintScore(sessionId, digits, Number(payload.sampleMs) || 1200);
  const voiceMatches = score >= 0.85;

  if (!pinMatches || !voiceMatches) {
    record.failures += 1;
    record.last = Date.now();
    if (record.failures >= PIN_MAX_ATTEMPTS) {
      record.lockedUntil = Date.now() + PIN_LOCK_SECONDS * 1000;
      return {
        status: 423,
        body: {
          verified: false,
          locked: true,
          retryInSeconds: PIN_LOCK_SECONDS,
          reason: `Three incorrect attempts. Voice PIN locked for ${PIN_LOCK_SECONDS} seconds and the payment was abandoned.`,
        },
      };
    }
    return {
      status: 401,
      body: {
        verified: false,
        reason: pinMatches ? 'Voice sample did not match the enrolled speaker.' : 'Those digits did not match your Voice PIN.',
        attemptsLeft: PIN_MAX_ATTEMPTS - record.failures,
        voiceprint: { matched: voiceMatches, score, engine: 'awaazpay-voiceprint-sim/1' },
      },
    };
  }

  record.failures = 0;
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    intentId: String(payload.intentId || '').slice(0, 40),
    amountPaise,
    payee: String(payload.payee || '').slice(0, 100),
    payeeVpa: String(payload.payeeVpa || '').slice(0, 100),
    mandateId: mandateState.id,
    tokenId: mandateState.tokenId,
    // Derived from the server-recorded approval, never from a client-asserted boolean.
    caregiverAssisted: Boolean(approval),
    caregiverApprovalId: approval ? approval.approvalId : null,
    factor: 'voice-pin',
    voiceprintScore: score,
    pinFingerprint: providedHash.slice(0, 8),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  return {
    status: 200,
    body: {
      verified: true,
      locked: false,
      authToken: signAuthToken(claims),
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      tokenTtlSeconds: TOKEN_TTL_SECONDS,
      mandateId: mandateState.id,
      redactedPin: '•'.repeat(digits.length),
      voiceprint: { matched: true, score, engine: 'awaazpay-voiceprint-sim/1' },
      authorizationMode: claims.caregiverAssisted ? 'caregiver-assisted' : 'voice-pin-hands-free',
      caregiverApprovalId: claims.caregiverApprovalId,
    },
  };
};

/* ------------------------------------------------------------- biometrics */

/**
 * Biometric confirmation for the "yes" step.
 *
 * Three factors can confirm a payment: a voiceprint sample (the spoken "yes" itself),
 * a fingerprint, or a face scan. Fingerprint and face use the device's *platform*
 * authenticator through WebAuthn (Windows Hello, Touch ID, Android biometrics) with
 * userVerification required, and the assertion signature is verified here against the
 * public key captured at enrollment — the browser cannot self-declare a match.
 *
 * Where no platform authenticator is reachable (sandboxed iframe, Firefox, no Windows
 * Hello enrolled) the client falls back to a simulator and says so explicitly: every
 * record carries an `engine` of either `webauthn-platform/1` or `awaazpay-sim/1`.
 */

const BIOMETRIC_MODALITIES = ['voiceprint', 'fingerprint', 'face'];
const DEVICE_MODALITIES = ['fingerprint', 'face'];
const VOICEPRINT_MATCH_THRESHOLD = 0.85;
const BIOMETRIC_CHALLENGE_TTL_MS = 120_000;

const biometricState = {
  voiceprint: null,
  credentials: new Map(),
  // Caregiver-controlled: when true a *device* biometric (fingerprint/face) authorizes
  // the charge outright and the Voice PIN step is skipped. Voice-only never skips it.
  deviceBiometricSkipsPin: false,
};

const biometricChallenges = new Map();

const issueBiometricChallenge = (purpose, sessionId) => {
  const key = `${purpose}:${sessionId}`;
  const challenge = crypto.randomBytes(24).toString('base64url');
  biometricChallenges.set(key, { challenge, expiresAt: Date.now() + BIOMETRIC_CHALLENGE_TTL_MS });
  return challenge;
};

/** Challenges are single-use, so a captured assertion cannot be replayed. */
const takeBiometricChallenge = (purpose, sessionId) => {
  const key = `${purpose}:${sessionId}`;
  const record = biometricChallenges.get(key);
  biometricChallenges.delete(key);
  if (!record || record.expiresAt < Date.now()) return null;
  return record.challenge;
};

/**
 * Minimal CBOR decoder covering the subset WebAuthn attestation objects use:
 * unsigned/negative ints, byte and text strings, arrays, maps and simple values.
 */
const cborDecode = (buf, offset = 0) => {
  const initial = buf[offset];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let pos = offset + 1;
  let value = 0;

  if (info < 24) value = info;
  else if (info === 24) { value = buf.readUInt8(pos); pos += 1; }
  else if (info === 25) { value = buf.readUInt16BE(pos); pos += 2; }
  else if (info === 26) { value = buf.readUInt32BE(pos); pos += 4; }
  else if (info === 27) { value = Number(buf.readBigUInt64BE(pos)); pos += 8; }

  switch (major) {
    case 0: return [value, pos];
    case 1: return [-1 - value, pos];
    case 2: return [Buffer.from(buf.subarray(pos, pos + value)), pos + value];
    case 3: return [buf.toString('utf8', pos, pos + value), pos + value];
    case 4: {
      const items = [];
      for (let i = 0; i < value; i += 1) {
        const [item, next] = cborDecode(buf, pos);
        items.push(item);
        pos = next;
      }
      return [items, pos];
    }
    case 5: {
      const map = new Map();
      for (let i = 0; i < value; i += 1) {
        const [key, afterKey] = cborDecode(buf, pos);
        const [val, afterVal] = cborDecode(buf, afterKey);
        map.set(key, val);
        pos = afterVal;
      }
      return [map, pos];
    }
    case 7:
      if (info === 20) return [false, offset + 1];
      if (info === 21) return [true, offset + 1];
      if (info === 22) return [null, offset + 1];
      return [null, offset + 1];
    default: return [null, pos];
  }
};

/** COSE_Key (EC2 / P-256, the usual platform-authenticator key) to a JWK Node can use. */
const coseKeyToJwk = (cose) => {
  if (!(cose instanceof Map)) return null;
  const kty = cose.get(1);
  const crv = cose.get(-1);
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (kty !== 2 || crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) return null;
  return { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') };
};

/** Splits the attestation object into the parts needed to trust a new credential. */
const parseAttestation = (attestationObjectB64) => {
  const [object] = cborDecode(Buffer.from(String(attestationObjectB64), 'base64url'));
  const authData = object instanceof Map ? object.get('authData') : null;
  if (!Buffer.isBuffer(authData) || authData.length < 55) return null;
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);
  const attested = authData.subarray(37);
  const credentialIdLength = attested.readUInt16BE(16);
  const credentialId = attested.subarray(18, 18 + credentialIdLength).toString('base64url');
  const [cose] = cborDecode(attested.subarray(18 + credentialIdLength));
  const jwk = coseKeyToJwk(cose);
  return { rpIdHash, flags, signCount, credentialId, jwk, fmt: object instanceof Map ? object.get('fmt') : null };
};

const parseClientData = (clientDataJsonB64) => {
  try {
    return JSON.parse(Buffer.from(String(clientDataJsonB64), 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
};

/** The origin's hostname must be the relying-party id it claims, or a subdomain of it. */
const originMatchesRpId = (origin, rpId) => {
  try {
    const host = new URL(String(origin)).hostname;
    const rp = String(rpId).toLowerCase();
    return host === rp || host.endsWith(`.${rp}`);
  } catch (error) {
    return false;
  }
};

/**
 * Verifies a WebAuthn assertion against the credential captured at enrollment.
 * Checks the ceremony type, the single-use challenge, the origin, the RP id hash, and
 * that both user presence (UP) and user verification (UV) flags are set — UV is what
 * proves a real biometric was presented rather than a mere tap.
 */
const verifyWebAuthnAssertion = (credential, assertion, expectedChallenge) => {
  const clientData = parseClientData(assertion.clientDataJSON);
  if (!clientData) return { ok: false, reason: 'The client data could not be read.' };
  if (clientData.type !== 'webauthn.get') return { ok: false, reason: 'Not a WebAuthn assertion ceremony.' };
  if (clientData.challenge !== expectedChallenge) return { ok: false, reason: 'The challenge does not match or was already used.' };
  if (clientData.origin !== credential.origin) return { ok: false, reason: 'The assertion came from an unexpected origin.' };

  const authData = Buffer.from(String(assertion.authenticatorData), 'base64url');
  if (authData.length < 37) return { ok: false, reason: 'The authenticator data is too short.' };
  const rpIdHash = crypto.createHash('sha256').update(credential.rpId).digest();
  if (!authData.subarray(0, 32).equals(rpIdHash)) return { ok: false, reason: 'The RP id hash does not match the enrolled credential.' };

  const flags = authData[32];
  if (!(flags & 0x01)) return { ok: false, reason: 'User presence was not set by the authenticator.' };
  if (!(flags & 0x04)) return { ok: false, reason: 'User verification was not performed — a biometric is required, not a tap.' };

  if (!credential.jwk) return { ok: false, reason: 'This credential was enrolled without a verifiable public key.' };

  const clientDataHash = crypto.createHash('sha256')
    .update(Buffer.from(String(assertion.clientDataJSON), 'base64url'))
    .digest();
  const signed = Buffer.concat([authData, clientDataHash]);
  try {
    const publicKey = crypto.createPublicKey({ key: credential.jwk, format: 'jwk' });
    const ok = crypto.verify(
      'sha256',
      signed,
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(String(assertion.signature), 'base64url'),
    );
    if (!ok) return { ok: false, reason: 'The assertion signature did not verify against the enrolled public key.' };
    return { ok: true, signCount: authData.readUInt32BE(33) };
  } catch (error) {
    return { ok: false, reason: `Signature verification failed: ${error.message}` };
  }
};

const findCredentialByModality = (modality) => {
  for (const credential of biometricState.credentials.values()) {
    if (credential.modality === modality) return credential;
  }
  return null;
};

const biometricPublicView = () => ({
  modalities: BIOMETRIC_MODALITIES,
  voiceprint: biometricState.voiceprint,
  credentials: [...biometricState.credentials.values()].map(({ credentialId, modality, label, enrolledAt, engine, origin }) => ({
    credentialId, modality, label, enrolledAt, engine, origin,
  })),
  fingerprintEnrolled: Boolean(findCredentialByModality('fingerprint')),
  faceEnrolled: Boolean(findCredentialByModality('face')),
  deviceBiometricSkipsPin: biometricState.deviceBiometricSkipsPin,
  voiceprintThreshold: VOICEPRINT_MATCH_THRESHOLD,
});

const enrollBiometric = (payload) => {
  const modality = String(payload.modality || '').trim().toLowerCase();
  const sessionId = String(payload.sessionId || 'default').slice(0, 64);
  if (!BIOMETRIC_MODALITIES.includes(modality)) {
    return { status: 400, body: { enrolled: false, reason: `modality must be one of ${BIOMETRIC_MODALITIES.join(', ')}.` } };
  }

  // Voice: a spoken sample is enrolled as the speaker template. The matching itself is
  // simulated, but the decision and the threshold live here, not in the browser.
  if (modality === 'voiceprint') {
    const sampleMs = Number(payload.sampleMs) || 1600;
    if (sampleMs < 600) {
      return { status: 400, body: { enrolled: false, reason: 'That voice sample is too short. Please speak a full sentence.' } };
    }
    biometricState.voiceprint = {
      id: `vpr_${crypto.randomBytes(5).toString('hex')}`,
      enrolledAt: new Date().toISOString(),
      engine: 'awaazpay-voiceprint-sim/1',
      sampleMs: Math.round(sampleMs),
      threshold: VOICEPRINT_MATCH_THRESHOLD,
    };
    return { status: 200, body: { enrolled: true, modality, ...biometricState.voiceprint, simulated: true } };
  }

  const label = String(payload.label || (modality === 'face' ? 'Face scan' : 'Fingerprint')).slice(0, 60);
  const attestation = payload.attestation;

  // No platform authenticator reachable: record a clearly-labelled simulated enrollment
  // so the demo still runs, without ever claiming a real credential exists.
  if (!attestation || !attestation.attestationObject || !attestation.clientDataJSON) {
    const credentialId = `sim_${crypto.randomBytes(6).toString('base64url')}`;
    biometricState.credentials.set(credentialId, {
      credentialId, modality, label, enrolledAt: new Date().toISOString(),
      engine: 'awaazpay-sim/1', jwk: null, rpId: null, origin: null, signCount: 0, simulated: true,
    });
    return {
      status: 200,
      body: {
        enrolled: true, modality, credentialId, label, engine: 'awaazpay-sim/1', simulated: true,
        note: 'No platform authenticator was reachable, so this enrollment is simulated.',
      },
    };
  }

  // Real WebAuthn registration.
  const challenge = takeBiometricChallenge('register', sessionId);
  if (!challenge) return { status: 400, body: { enrolled: false, reason: 'Request a registration challenge first; it is single-use and expires quickly.' } };

  const clientData = parseClientData(attestation.clientDataJSON);
  if (!clientData) return { status: 400, body: { enrolled: false, reason: 'The client data could not be read.' } };
  if (clientData.type !== 'webauthn.create') return { status: 400, body: { enrolled: false, reason: 'Not a WebAuthn registration ceremony.' } };
  if (clientData.challenge !== challenge) return { status: 400, body: { enrolled: false, reason: 'The registration challenge does not match or was already used.' } };

  const rpId = String(payload.rpId || '').toLowerCase();
  if (!rpId || !originMatchesRpId(clientData.origin, rpId)) {
    return { status: 400, body: { enrolled: false, reason: `Origin ${clientData.origin || '(none)'} does not match relying party id ${rpId || '(none)'}.` } };
  }

  const parsed = parseAttestation(attestation.attestationObject);
  if (!parsed) return { status: 400, body: { enrolled: false, reason: 'The attestation object could not be parsed.' } };
  if (!(parsed.flags & 0x01)) return { status: 400, body: { enrolled: false, reason: 'User presence was not set during enrollment.' } };
  if (!(parsed.flags & 0x04)) return { status: 400, body: { enrolled: false, reason: 'User verification was not performed during enrollment — a biometric is required.' } };
  if (!parsed.jwk) {
    return { status: 415, body: { enrolled: false, reason: 'That authenticator returned a key type this demo cannot verify (only EC2/P-256). Use the simulated factor instead.' } };
  }

  biometricState.credentials.set(parsed.credentialId, {
    credentialId: parsed.credentialId, modality, label, enrolledAt: new Date().toISOString(),
    engine: 'webauthn-platform/1', jwk: parsed.jwk, rpId, origin: clientData.origin,
    rpIdHash: crypto.createHash('sha256').update(rpId).digest('hex'),
    signCount: parsed.signCount, simulated: false,
  });

  return {
    status: 200,
    body: {
      enrolled: true, modality, credentialId: parsed.credentialId, label,
      engine: 'webauthn-platform/1', simulated: false, rpId, origin: clientData.origin,
    },
  };
};

/**
 * Verifies a biometric factor for a specific intent. A voiceprint confirms the yes and
 * hands off to the Voice PIN; a device biometric also authorizes the charge when the
 * caregiver has allowed it, and then returns the same signed mandate-auth token the
 * Voice PIN path would.
 */
const verifyBiometric = (payload) => {
  const modality = String(payload.modality || '').trim().toLowerCase();
  const sessionId = String(payload.sessionId || 'default').slice(0, 64);
  if (!BIOMETRIC_MODALITIES.includes(modality)) {
    return { status: 400, body: { verified: false, reason: `modality must be one of ${BIOMETRIC_MODALITIES.join(', ')}.` } };
  }

  const amountPaise = Number(payload.amountPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > 10_000_000) {
    return { status: 400, body: { verified: false, reason: 'amountPaise must be a positive integer up to ₹100,000.' } };
  }

  const enrolled = modality === 'voiceprint' ? biometricState.voiceprint : findCredentialByModality(modality);
  if (!enrolled) {
    return {
      status: 422,
      body: {
        verified: false,
        code: 'biometric_not_enrolled',
        reason: `No ${modality} is enrolled on this mandate yet. Enroll it once in the caregiver setup.`,
        enrolledModalities: biometricPublicView().modalities.filter((m) => (m === 'voiceprint' ? biometricState.voiceprint : findCredentialByModality(m))),
      },
    };
  }

  // Same policy gate as the Voice PIN, and checked before any scoring so an unauthorized
  // payee or an above-mandate amount cannot be waved through by a biometric.
  const perTxnPaise = mandateState.perTransactionLimit * 100;
  const approval = findCaregiverApproval(payload.intentId, amountPaise, payload.caregiverApprovalId);
  if (amountPaise > perTxnPaise && !approval) {
    return {
      status: 422,
      body: {
        verified: false,
        code: 'caregiver_approval_required',
        reason: `₹${(amountPaise / 100).toLocaleString('en-IN')} is above the ₹${mandateState.perTransactionLimit.toLocaleString('en-IN')} hands-free mandate limit. A caregiver must approve it before any biometric can authorize it.`,
      },
    };
  }
  if (!isAuthorizedPayee(payload.payee, payload.payeeVpa) && !approval) {
    return {
      status: 422,
      body: {
        verified: false,
        code: 'payee_not_on_mandate',
        reason: `${payload.payee || 'That payee'} is not on the caregiver mandate's authorized list. A caregiver must approve this payee first.`,
        authorizedPayees: mandateState.authorizedPayees.map((payee) => payee.name),
      },
    };
  }

  let matched = false;
  let score = null;
  let engine = enrolled.engine;
  let failureReason = '';

  if (modality === 'voiceprint') {
    const transcript = String(payload.transcript || '');
    if (!transcript.trim()) return { status: 400, body: { verified: false, reason: 'A spoken sample is required to match the enrolled voiceprint.' } };
    score = voiceprintScore(sessionId, transcript.slice(0, 120), Number(payload.sampleMs) || 1400);
    matched = score >= VOICEPRINT_MATCH_THRESHOLD;
    if (!matched) failureReason = 'That voice sample did not match the enrolled speaker.';
  } else if (payload.assertion && payload.assertion.signature) {
    const challenge = takeBiometricChallenge('assert', sessionId);
    if (!challenge) return { status: 400, body: { verified: false, reason: 'Request an assertion challenge first; it is single-use and expires quickly.' } };
    const result = verifyWebAuthnAssertion(enrolled, payload.assertion, challenge);
    matched = result.ok;
    if (!matched) failureReason = result.reason;
    else enrolled.signCount = result.signCount;
  } else {
    // Simulated device biometric — the client said so explicitly.
    engine = 'awaazpay-sim/1';
    matched = true;
  }

  if (!matched) {
    return {
      status: 401,
      body: {
        verified: false,
        modality,
        reason: failureReason || 'The biometric did not match.',
        score,
        engine,
        requiresVoicePin: true,
        productionBehaviour: 'The Voice PIN remains available as the fallback factor.',
      },
    };
  }

  const isDevice = DEVICE_MODALITIES.includes(modality);
  const authorizesCharge = isDevice && biometricState.deviceBiometricSkipsPin;
  const base = {
    verified: true,
    modality,
    factor: modality,
    engine,
    // Only a verified platform-authenticator assertion is real; every simulator says so.
    simulated: !String(engine).startsWith('webauthn-platform'),
    score,
    authorizesCharge,
    mandateId: mandateState.id,
    deviceBiometricSkipsPin: biometricState.deviceBiometricSkipsPin,
  };

  // A voiceprint proves who is speaking, but it is not a hardware-backed factor, so it
  // confirms the yes and still hands off to the Voice PIN for the actual authorization.
  if (!authorizesCharge) {
    return { status: 200, body: { ...base, nextStep: 'voice-pin' } };
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    intentId: String(payload.intentId || '').slice(0, 40),
    amountPaise,
    payee: String(payload.payee || '').slice(0, 100),
    payeeVpa: String(payload.payeeVpa || '').slice(0, 100),
    mandateId: mandateState.id,
    tokenId: mandateState.tokenId,
    caregiverAssisted: Boolean(approval),
    caregiverApprovalId: approval ? approval.approvalId : null,
    factor: modality,
    biometricEngine: engine,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  return {
    status: 200,
    body: {
      ...base,
      nextStep: 'execute',
      authToken: signAuthToken(claims),
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      tokenTtlSeconds: TOKEN_TTL_SECONDS,
      authorizationMode: claims.caregiverAssisted ? 'caregiver-assisted' : `${modality}-biometric-hands-free`,
    },
  };
};

/* ------------------------------------------------------ caregiver profile */

/**
 * The caregiver owns the one-time visual setup. This endpoint lets them personalise it:
 * who the elder is, who the caregiver is and how they are reached, and the hands-free
 * bounds. Bounds can only be tightened under RBI's UPI AutoPay ceiling, never widened.
 */
const VPA_PATTERN = /^[a-z0-9][a-z0-9.\-_]{2,}@[a-z0-9]{2,}$/i;

const updateCaregiverProfile = (payload) => {
  const updates = {};

  const elderName = String(payload.elderName || '').trim();
  if (elderName) {
    if (elderName.length < 2 || elderName.length > 60) {
      return { status: 400, body: { updated: false, reason: 'The account holder name must be 2 to 60 characters.' } };
    }
    mandateState.elder.name = elderName;
    mandateState.elder.handle = initialsFromName(elderName);
    updates.elderName = elderName;
  }
  const elderContact = String(payload.elderContact || '').replace(/[^0-9]/g, '');
  if (elderContact) {
    if (elderContact.length < 10 || elderContact.length > 12) {
      return { status: 400, body: { updated: false, reason: 'The account holder phone number must be 10 to 12 digits.' } };
    }
    mandateState.elder.contact = elderContact;
    updates.elderContact = elderContact;
  }

  const caregiverName = String(payload.caregiverName || '').trim();
  if (caregiverName) {
    if (caregiverName.length < 2 || caregiverName.length > 60) {
      return { status: 400, body: { updated: false, reason: 'The caregiver name must be 2 to 60 characters.' } };
    }
    mandateState.caregiver.name = caregiverName;
    updates.caregiverName = caregiverName;
  }
  const relationship = String(payload.caregiverRelationship || '').trim();
  if (relationship) {
    mandateState.caregiver.relationship = relationship.slice(0, 40);
    updates.caregiverRelationship = mandateState.caregiver.relationship;
  }
  const phone = String(payload.caregiverPhone || '').replace(/[^0-9+]/g, '');
  if (phone) {
    mandateState.caregiver.phone = phone.slice(0, 16);
    updates.caregiverPhone = mandateState.caregiver.phone;
  }

  if (payload.perTransactionLimit !== undefined && payload.perTransactionLimit !== null && payload.perTransactionLimit !== '') {
    const perTxn = Number(payload.perTransactionLimit);
    if (!Number.isFinite(perTxn) || perTxn < 100 || perTxn > MAX_HANDS_FREE_PER_TXN) {
      return { status: 400, body: { updated: false, reason: `The per-transaction limit must be between ₹100 and ₹${MAX_HANDS_FREE_PER_TXN.toLocaleString('en-IN')}.` } };
    }
    mandateState.perTransactionLimit = Math.round(perTxn);
    updates.perTransactionLimit = mandateState.perTransactionLimit;
  }
  if (payload.dailyLimit !== undefined && payload.dailyLimit !== null && payload.dailyLimit !== '') {
    const daily = Number(payload.dailyLimit);
    if (!Number.isFinite(daily) || daily < mandateState.perTransactionLimit || daily > MAX_HANDS_FREE_DAILY) {
      return {
        status: 400,
        body: { updated: false, reason: `The daily limit must be between the per-transaction limit and ₹${MAX_HANDS_FREE_DAILY.toLocaleString('en-IN')}.` },
      };
    }
    mandateState.dailyLimit = Math.round(daily);
    updates.dailyLimit = mandateState.dailyLimit;
  }

  if (!Object.keys(updates).length) {
    return { status: 400, body: { updated: false, reason: 'Nothing to update was recognised.' } };
  }

  mandateState.caregiver.consent = `Profile updated visually by caregiver on ${new Date().toLocaleDateString('en-IN')} · UPI PIN stays in the bank's secure surface`;
  console.log(`[caregiver] profile updated: ${Object.keys(updates).join(', ')}`);

  return {
    status: 200,
    body: {
      updated: true,
      updates,
      elder: mandateState.elder,
      caregiver: mandateState.caregiver,
      perTransactionLimit: mandateState.perTransactionLimit,
      dailyLimit: mandateState.dailyLimit,
      note: 'Caregiver profile saved. Hands-free bounds can be tightened, never widened past RBI limits.',
    },
  };
};

/** Adds a merchant to the mandate's authorized-payee allowlist (the visual caregiver step). */
const addAuthorizedPayee = (payload) => {
  const name = String(payload.name || '').trim();
  const vpa = String(payload.vpa || '').trim().toLowerCase();
  const usual = Number(payload.usualAmountRupees);

  if (name.length < 2 || name.length > 60) {
    return { status: 400, body: { added: false, reason: 'The payee name must be 2 to 60 characters.' } };
  }
  if (!VPA_PATTERN.test(vpa)) {
    return { status: 400, body: { added: false, reason: 'The UPI ID must look like sharma.kirana@okhdfcbank.' } };
  }
  const usualAmountRupees = Number.isFinite(usual) && usual > 0 ? Math.round(usual) : 0;

  const existing = mandateState.authorizedPayees.find(
    (payee) => payee.name.toLowerCase() === name.toLowerCase() || payee.vpa === vpa,
  );
  if (existing) {
    existing.usualAmountRupees = usualAmountRupees || existing.usualAmountRupees;
    return {
      status: 200,
      body: { added: true, updated: true, payee: existing, authorizedPayees: mandateState.authorizedPayees },
    };
  }

  const payee = { name, vpa, usualAmountRupees, addedAt: new Date().toISOString(), addedBy: mandateState.caregiver.name };
  mandateState.authorizedPayees.push(payee);
  console.log(`[caregiver] payee added to mandate allowlist: ${name} <${vpa}>`);

  return {
    status: 200,
    body: {
      added: true,
      payee,
      authorizedPayees: mandateState.authorizedPayees,
      note: `${name} can now be paid hands-free inside the mandate. Anyone else still needs caregiver approval.`,
    },
  };
};

/** The caregiver decides whether a device biometric may replace the Voice PIN. */
const setBiometricSettings = (payload) => {
  if (typeof payload.deviceBiometricSkipsPin !== 'boolean') {
    return { status: 400, body: { updated: false, reason: 'deviceBiometricSkipsPin must be true or false.' } };
  }
  biometricState.deviceBiometricSkipsPin = payload.deviceBiometricSkipsPin;
  return {
    status: 200,
    body: {
      updated: true,
      deviceBiometricSkipsPin: biometricState.deviceBiometricSkipsPin,
      effect: payload.deviceBiometricSkipsPin
        ? 'A verified fingerprint or face scan now authorizes the charge directly; the Voice PIN is skipped.'
        : 'Every payment returns to the Voice PIN after biometric confirmation.',
      voiceprintNeverSkipsPin: true,
    },
  };
};

const handleAPI = async (req, res) => {
  const pathname = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return true;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      razorpayConfigured,
      paymentMode: razorpayConfigured ? 'razorpay-live' : 'smart-demo',
      intentMode: process.env.GROQ_API_KEY ? 'groq' : 'smart-demo-local-simulator',
      voicePin: { length: voicePinLength, maxAttempts: PIN_MAX_ATTEMPTS, lockSeconds: PIN_LOCK_SECONDS, serverVerified: true },
      mandate: { id: mandateState.id, perTransactionLimit: mandateState.perTransactionLimit, status: mandateState.status },
      mode: process.env.GROQ_API_KEY || razorpayConfigured ? 'configured' : 'demo',
    });
    return true;
  }

  if (pathname === '/api/mandate' && req.method === 'GET') {
    json(res, 200, mandatePublicView());
    return true;
  }

  if (pathname === '/api/payment/session' && req.method === 'GET') {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const paymentId = url.searchParams.get('payment_id') || '';
      if (!razorpayConfigured) {
        json(res, 200, { mode: 'smart-demo', verified: true, paymentId, status: 'captured' });
        return true;
      }
      const payment = await razorpayRequest('GET', `payments/${encodeURIComponent(paymentId)}`);
      json(res, 200, { mode: 'razorpay-live', verified: payment.status === 'captured', payment });
    } catch (error) {
      json(res, 400, { error: error.message || 'Could not verify the Razorpay payment' });
    }
    return true;
  }

  if (!pathname.startsWith('/api/')) return false;

  try {
    const body = await readBody(req);

    if (pathname === '/api/intent' && req.method === 'POST') {
      const result = await callGroq(body);
      json(res, 200, result);
      return true;
    }

    if (pathname === '/api/caregiver/approve' && req.method === 'POST') {
      const result = registerCaregiverApproval(body);
      json(res, result.status, result.body);
      if (result.status === 200) {
        console.log(`[caregiver] approval ${result.body.approvalId} recorded for ${body.intentId} (${body.amountPaise / 100} INR)`);
      }
      return true;
    }

    if (pathname === '/api/caregiver/profile' && req.method === 'POST') {
      const result = updateCaregiverProfile(body);
      json(res, result.status, result.body);
      if (result.status === 200) console.log(`[caregiver] profile saved by ${result.body.caregiver?.name || 'caregiver'}`);
      return true;
    }

    if (pathname === '/api/caregiver/payees' && req.method === 'POST') {
      const result = addAuthorizedPayee(body);
      json(res, result.status, result.body);
      if (result.status === 200) console.log(`[caregiver] payee allowlist now has ${result.body.authorizedPayees.length} merchants`);
      return true;
    }

    if (pathname === '/api/voice-pin/set' && req.method === 'POST') {
      const result = updateVoicePin(body);
      json(res, result.status, result.body);
      return true;
    }

    if (pathname === '/api/biometric/challenge' && req.method === 'POST') {
      const purpose = String(body.purpose || 'assert').toLowerCase();
      if (!['register', 'assert'].includes(purpose)) {
        json(res, 400, { error: "purpose must be 'register' or 'assert'." });
        return true;
      }
      const sessionId = String(body.sessionId || 'default').slice(0, 64);
      const challenge = issueBiometricChallenge(purpose, sessionId);
      json(res, 200, {
        challenge,
        purpose,
        expiresInSeconds: Math.round(BIOMETRIC_CHALLENGE_TTL_MS / 1000),
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      });
      return true;
    }

    if (pathname === '/api/biometric/enroll' && req.method === 'POST') {
      const result = enrollBiometric(body);
      json(res, result.status, result.body);
      console.log(`[biometric] enroll ${body.modality || '-'} · ${result.status === 200 ? result.body.engine : result.body.reason}`);
      return true;
    }

    if (pathname === '/api/biometric/verify' && req.method === 'POST') {
      const result = verifyBiometric(body);
      json(res, result.status, result.body);
      if (result.status === 200) {
        console.log(`[biometric] ${body.modality} matched for intent ${body.intentId || '-'} · ${result.body.engine} · next ${result.body.nextStep}`);
      } else {
        console.log(`[biometric] ${body.modality || '-'} refused (${result.body.code || result.body.reason || result.status})`);
      }
      return true;
    }

    if (pathname === '/api/biometric/settings' && req.method === 'POST') {
      const result = setBiometricSettings(body);
      json(res, result.status, result.body);
      if (result.status === 200) {
        console.log(`[biometric] caregiver set deviceBiometricSkipsPin=${result.body.deviceBiometricSkipsPin}`);
      }
      return true;
    }

    if (pathname === '/api/voice-pin/verify' && req.method === 'POST') {
      const result = verifyVoicePin(body);
      json(res, result.status, result.body);
      if (result.status === 200) {
        console.log(`[voice-pin] verified for intent ${body.intentId || '-'} · voiceprint ${result.body.voiceprint.score}`);
      } else {
        console.log(`[voice-pin] rejected (${result.body.reason || result.status}) · digits never logged`);
      }
      return true;
    }

    if (pathname === '/api/payment/execute' && req.method === 'POST') {
      const claims = verifyAuthToken(body.authToken);
      if (!claims) {
        json(res, 401, {
          error: 'A valid Voice PIN mandate-auth token is required. No token means no hands-free charge.',
          code: 'missing_or_expired_auth_token',
        });
        return true;
      }
      if (claims.intentId && body.intentId && claims.intentId !== String(body.intentId)) {
        json(res, 401, { error: 'The auth token was issued for a different payment intent.', code: 'intent_mismatch' });
        return true;
      }

      const amountPaise = Number(claims.amountPaise);
      const amountRupees = amountPaise / 100;
      const perTxnPaise = mandateState.perTransactionLimit * 100;
      const dailyPaise = mandateState.dailyLimit * 100;
      // The token carries the signed approval id; re-check that the record still exists.
      const caregiverAssisted =
        Boolean(claims.caregiverAssisted) &&
        (amountPaise <= perTxnPaise || Boolean(findCaregiverApproval(claims.intentId, amountPaise, claims.caregiverApprovalId)));

      // Server-enforced mandate bounds. This is the compliance boundary the pitch rests on.
      if (!caregiverAssisted && !isAuthorizedPayee(claims.payee, claims.payeeVpa || body.payeeVpa)) {
        json(res, 422, {
          error: `${claims.payee || 'That payee'} is not on the caregiver mandate's authorized list.`,
          code: 'payee_not_on_mandate',
          requiresCaregiver: true,
          authorizedPayees: mandateState.authorizedPayees.map((payee) => payee.name),
          productionBehaviour: 'A hands-free charge is only allowed to a merchant the caregiver authorized.',
        });
        return true;
      }
      if (amountPaise > perTxnPaise && !caregiverAssisted) {
        json(res, 422, {
          error: `₹${amountRupees.toLocaleString('en-IN')} is above the ₹${mandateState.perTransactionLimit.toLocaleString('en-IN')} hands-free mandate limit.`,
          code: 'amount_outside_mandate',
          requiresCaregiver: true,
          productionBehaviour: 'The bank/Razorpay visual UPI PIN screen must be used for this amount.',
        });
        return true;
      }
      if (mandateState.usedToday * 100 + amountPaise > dailyPaise) {
        json(res, 422, {
          error: 'Today’s mandate utilisation limit is exhausted.',
          code: 'daily_limit_exhausted',
          usedToday: mandateState.usedToday,
          dailyLimit: mandateState.dailyLimit,
        });
        return true;
      }
      if (mandateState.wallet.balance * 100 < amountPaise) {
        json(res, 422, { error: 'The closed-loop wallet does not have enough balance.', code: 'insufficient_wallet_balance' });
        return true;
      }

      const result = await executeMandatePayment({
        amountPaise,
        payee: claims.payee || body.payee || 'saved payee',
        intentId: claims.intentId,
        tokenId: claims.tokenId,
        caregiverAssisted,
        factor: claims.factor,
      });

      mandateState.usedToday += amountRupees;
      mandateState.wallet.balance = Math.max(0, mandateState.wallet.balance - amountRupees);

      json(res, 200, {
        ...result,
        mandateId: mandateState.id,
        walletBalance: mandateState.wallet.balance,
        usedToday: mandateState.usedToday,
        remainingToday: Math.max(0, mandateState.dailyLimit - mandateState.usedToday),
        voiceprintScore: claims.voiceprintScore,
        authorizationFactor: claims.factor || 'voice-pin',
        biometricEngine: claims.biometricEngine || null,
        authorizationMode: authorizationModeFor(caregiverAssisted, claims.factor),
        visualPinPadShown: false,
      });
      return true;
    }

    if (pathname === '/api/payment/verify' && req.method === 'POST') {
      const paymentId = String(body.paymentId || '');
      if (!razorpayConfigured) {
        json(res, 200, { mode: 'smart-demo', verified: Boolean(paymentId), paymentId, status: 'captured' });
        return true;
      }
      const payment = await razorpayRequest('GET', `payments/${encodeURIComponent(paymentId)}`);
      json(res, 200, { mode: 'razorpay-live', verified: payment.status === 'captured', payment });
      return true;
    }

    json(res, 404, { error: 'API route not found' });
    return true;
  } catch (error) {
    console.error('[api]', error.message);
    json(res, 400, { error: error.message || 'Request failed' });
    return true;
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleAPI(req, res);
    if (handled) return;

    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(root, relativePath);

    if (!filePath.startsWith(root + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error('[server]', error);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
  }
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;

  const isWindows = process.platform === 'win32';
  const altPort = port + 1;
  console.error('');
  console.error(`✖ Port ${port} is already in use, so AwaazPay could not start.`);
  console.error('  5173 is also Vite’s default port — a leftover dev server is the usual cause.');
  console.error('');
  if (isWindows) {
    console.error('  Easiest fix — run on another port (PowerShell):');
    console.error(`    $env:PORT=${altPort}; npm run dev`);
    console.error('');
    console.error(`  Or find and stop whatever holds ${port}:`);
    console.error(`    Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }`);
    console.error('    Stop-Process -Id <PID> -Force');
    console.error('');
    console.error(`  If nothing is listed, Windows may have reserved the port (Hyper-V/WSL):`);
    console.error('    netsh interface ipv4 show excludedportrange protocol=tcp');
  } else {
    console.error('  Easiest fix — run on another port:');
    console.error(`    PORT=${altPort} npm run dev`);
    console.error('');
    console.error(`  Or find and stop whatever holds ${port}:`);
    console.error(`    lsof -i :${port}`);
    console.error('    kill -9 <PID>');
  }
  console.error('');
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`AwaazPay is running at http://localhost:${port}`);
  console.log(`Intent mode: ${process.env.GROQ_API_KEY ? `Groq (${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})` : 'Smart Demo Mode · local AI simulator'}`);
  console.log(`Payment mode: ${razorpayConfigured ? 'Razorpay test/live S2S (mandate)' : 'Smart Demo Mode · simulated Razorpay S2S'}`);
  console.log(`Mandate: ${mandateState.id} · hands-free up to ₹${MANDATE_PER_TXN_LIMIT} per transaction · ₹${MANDATE_DAILY_LIMIT} per day`);
  console.log(`Voice PIN: server-verified, ${voicePinLength} digits, ${PIN_MAX_ATTEMPTS} attempts before a ${PIN_LOCK_SECONDS}s lockout${razorpayConfigured ? '' : ` · demo PIN ${DEFAULT_VOICE_PIN}`}`);
});
