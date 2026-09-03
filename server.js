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

const DEMO_VOICE_PIN = (String(process.env.AWAAZPAY_VOICE_PIN || '1234').replace(/\D/g, '') || '1234').slice(0, 6);
const PIN_SALT = process.env.AWAAZPAY_PIN_SALT || crypto.randomBytes(16).toString('hex');
const AUTH_SECRET = process.env.AWAAZPAY_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_SECONDS = Number(process.env.AWAAZPAY_TOKEN_TTL || 90);
const PIN_MAX_ATTEMPTS = Number(process.env.AWAAZPAY_PIN_MAX_ATTEMPTS || 3);
const PIN_LOCK_SECONDS = Number(process.env.AWAAZPAY_PIN_LOCK_SECONDS || 60);

const MANDATE_PER_TXN_LIMIT = Number(process.env.MANDATE_PER_TXN_LIMIT || 5000);
const MANDATE_DAILY_LIMIT = Number(process.env.MANDATE_DAILY_LIMIT || 15000);
const WALLET_OPENING_BALANCE = Number(process.env.WALLET_BALANCE || 12500);

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
  caregiver: {
    name: 'Meera Sharma',
    relationship: 'Daughter',
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

const mandatePublicView = () => ({
  ...mandateState,
  remainingToday: Math.max(0, mandateState.dailyLimit - mandateState.usedToday),
  handsFree: mandateState.status === 'active',
  paymentMode: razorpayConfigured ? 'razorpay-live' : 'smart-demo',
  voicePinLength: DEMO_VOICE_PIN.length,
  demoVoicePin: razorpayConfigured ? null : DEMO_VOICE_PIN,
});

/* ------------------------------------------------------- voice PIN security */

const hashPin = (digits) => crypto.createHash('sha256').update(`${PIN_SALT}:${digits}`).digest('hex');
const storedPinHash = hashPin(DEMO_VOICE_PIN);

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
const executeMandatePayment = async ({ amountPaise, payee, intentId, tokenId, caregiverAssisted }) => {
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
        authorization_mode: caregiverAssisted ? 'caregiver-assisted' : 'voice-pin-hands-free',
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
      authorization_mode: caregiverAssisted ? 'caregiver-assisted' : 'voice-pin-hands-free',
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

  if (digits.length < 4 || digits.length > 6) {
    return {
      status: 400,
      body: { verified: false, reason: 'A Voice PIN of 4 to 6 digits is required.', attemptsLeft: PIN_MAX_ATTEMPTS - record.failures },
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
  const pinMatches = crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(storedPinHash));
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
      voicePin: { length: DEMO_VOICE_PIN.length, maxAttempts: PIN_MAX_ATTEMPTS, lockSeconds: PIN_LOCK_SECONDS, serverVerified: true },
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
        authorizationMode: caregiverAssisted ? 'caregiver-assisted' : 'voice-pin-hands-free',
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
  console.log(`Voice PIN: server-verified, ${DEMO_VOICE_PIN.length} digits, ${PIN_MAX_ATTEMPTS} attempts before a ${PIN_LOCK_SECONDS}s lockout${razorpayConfigured ? '' : ` · demo PIN ${DEMO_VOICE_PIN}`}`);
});
