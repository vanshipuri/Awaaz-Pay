/**
 * Integration tests for the hands-free payment boundary.
 *
 * Boots server.js on a throwaway port with a known demo PIN and asserts the claims the
 * pitch makes to judges:
 *   - no mandate-auth token  → no charge
 *   - wrong Voice PIN        → rejected, then locked after three attempts
 *   - correct Voice PIN      → short-lived token → S2S capture with no visual PIN pad
 *   - above the mandate cap  → refused unless a caregiver approval is recorded server-side
 *   - a token for one intent → cannot be replayed against another
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_PIN = '1234';

const post = async (route, body) => {
  const response = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const get = async (route) => {
  const response = await fetch(`${BASE}${route}`);
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const verifyPin = (overrides = {}) =>
  post('/api/voice-pin/verify', {
    pinDigits: DEMO_PIN,
    sessionId: `test-${Math.random().toString(36).slice(2)}`,
    intentId: 'INT-TEST',
    amountPaise: 50000,
    payee: 'Sharma Kirana',
    sampleMs: 1400,
    ...overrides,
  });

let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AWAAZPAY_VOICE_PIN: DEMO_PIN,
      AWAAZPAY_PIN_SALT: 'test-salt',
      AWAAZPAY_AUTH_SECRET: 'test-secret',
      AWAAZPAY_PIN_LOCK_SECONDS: '3',
      MANDATE_PER_TXN_LIMIT: '15000',
      MANDATE_DAILY_LIMIT: '50000',
      WALLET_BALANCE: '40000',
      // No provider keys: the server must run in Smart Demo Mode.
      GROQ_API_KEY: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 8000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('is running at')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('exit', (code) => reject(new Error(`server exited early with ${code}`)));
  });
});

test.after(() => {
  if (server) server.kill('SIGTERM');
});

test('health reports Smart Demo Mode with a server-verified PIN policy', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.paymentMode, 'smart-demo');
  assert.equal(body.intentMode, 'smart-demo-local-simulator');
  assert.equal(body.voicePin.serverVerified, true);
  assert.equal(body.voicePin.length, DEMO_PIN.length);
});

test('the caregiver mandate exposes its hands-free bounds', async () => {
  const { status, body } = await get('/api/mandate');
  assert.equal(status, 200);
  assert.equal(body.perTransactionLimit, 15000);
  assert.equal(body.status, 'active');
  assert.equal(body.handsFree, true);
  assert.equal(body.wallet.balance > 0, true);
  // Smart Demo Mode may show the demo PIN; live-key mode must not.
  assert.equal(body.demoVoicePin, DEMO_PIN);
});

test('a charge without a Voice PIN token is refused', async () => {
  const { status, body } = await post('/api/payment/execute', {
    intentId: 'INT-NOTOKEN',
    amountPaise: 50000,
    payee: 'Sharma Kirana',
  });
  assert.equal(status, 401);
  assert.equal(body.code, 'missing_or_expired_auth_token');
});

test('a wrong Voice PIN is rejected and never returns a token', async () => {
  const { status, body } = await verifyPin({ pinDigits: '0000', sessionId: 'wrong-pin-session' });
  assert.equal(status, 401);
  assert.equal(body.verified, false);
  assert.equal(body.authToken, undefined);
  assert.equal(body.attemptsLeft, 2);
});

test('three wrong attempts lock the Voice PIN', async () => {
  const sessionId = 'lockout-session';
  const first = await verifyPin({ pinDigits: '1111', sessionId });
  const second = await verifyPin({ pinDigits: '2222', sessionId });
  const third = await verifyPin({ pinDigits: '3333', sessionId });
  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(third.status, 423);
  assert.equal(third.body.locked, true);

  // Even the correct PIN is refused while locked.
  const locked = await verifyPin({ pinDigits: DEMO_PIN, sessionId });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.verified, false);
});

test('a correct Voice PIN yields a token and a hands-free S2S capture', async () => {
  const intentId = 'INT-HANDSFREE';
  const pin = await verifyPin({ intentId });
  assert.equal(pin.status, 200);
  assert.equal(pin.body.verified, true);
  assert.equal(pin.body.authorizationMode, 'voice-pin-hands-free');
  assert.equal(pin.body.redactedPin, '••••');
  assert.equal(pin.body.voiceprint.matched, true);
  assert.ok(pin.body.authToken.includes('.'), 'token should be a signed body.signature pair');

  const executed = await post('/api/payment/execute', {
    authToken: pin.body.authToken,
    intentId,
    amountPaise: 50000,
    payee: 'Sharma Kirana',
  });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.payment.status, 'captured');
  assert.equal(executed.body.payment.method, 'upi');
  assert.equal(executed.body.payment.recurring, true);
  assert.equal(executed.body.visualPinPadShown, false, 'the whole point: no visual PIN pad');
  assert.equal(executed.body.authorizationMode, 'voice-pin-hands-free');
  assert.equal(executed.body.payment.token_id, executed.body.payment.token_id);
});

test('a token cannot be replayed against a different intent', async () => {
  const pin = await verifyPin({ intentId: 'INT-REAL' });
  const replay = await post('/api/payment/execute', {
    authToken: pin.body.authToken,
    intentId: 'INT-EVIL',
    amountPaise: 50000,
    payee: 'Sharma Kirana',
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'intent_mismatch');
});

test('a tampered token signature is rejected', async () => {
  const pin = await verifyPin({ intentId: 'INT-TAMPER' });
  const [body] = pin.body.authToken.split('.');
  const forged = `${body}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead`;
  const { status, body: response } = await post('/api/payment/execute', {
    authToken: forged,
    intentId: 'INT-TAMPER',
    amountPaise: 50000,
  });
  assert.equal(status, 401);
  assert.equal(response.code, 'missing_or_expired_auth_token');
});

test('above the mandate limit the server refuses to bypass the visual PIN', async () => {
  const intentId = 'INT-ABOVE';
  const pin = await verifyPin({ intentId, amountPaise: 2500000, sessionId: 'above-mandate' });
  assert.equal(pin.status, 422);
  assert.equal(pin.body.code, 'caregiver_approval_required');
  assert.equal(pin.body.authToken, undefined);
});

test('a server-recorded caregiver approval unlocks a caregiver-assisted charge', async () => {
  const intentId = 'INT-CAREGIVER';
  const amountPaise = 2500000;

  const approval = await post('/api/caregiver/approve', { intentId, amountPaise, payee: 'Mehta Utilities' });
  assert.equal(approval.status, 200);
  assert.ok(approval.body.approvalId.startsWith('carg_'));

  const pin = await verifyPin({ intentId, amountPaise, caregiverApprovalId: approval.body.approvalId, sessionId: 'caregiver-session' });
  assert.equal(pin.status, 200);
  assert.equal(pin.body.authorizationMode, 'caregiver-assisted');

  const executed = await post('/api/payment/execute', {
    authToken: pin.body.authToken,
    intentId,
    amountPaise,
    payee: 'Mehta Utilities',
  });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.authorizationMode, 'caregiver-assisted');
  assert.equal(executed.body.payment.status, 'captured');
});

test('a caregiver approval cannot be reused for a different amount', async () => {
  const approval = await post('/api/caregiver/approve', { intentId: 'INT-REUSE', amountPaise: 2500000 });
  const pin = await verifyPin({
    intentId: 'INT-REUSE',
    amountPaise: 3500000,
    caregiverApprovalId: approval.body.approvalId,
    sessionId: 'reuse-session',
  });
  assert.equal(pin.status, 422);
  assert.equal(pin.body.code, 'caregiver_approval_required');
});

test('mandate utilisation and wallet balance move after a capture', async () => {
  const before = await get('/api/mandate');
  const intentId = 'INT-LEDGER';
  const pin = await verifyPin({ intentId, amountPaise: 50000, sessionId: 'ledger-session' });
  const executed = await post('/api/payment/execute', { authToken: pin.body.authToken, intentId, amountPaise: 50000 });
  const after = await get('/api/mandate');

  assert.equal(executed.status, 200);
  assert.equal(after.body.usedToday, before.body.usedToday + 500);
  assert.equal(after.body.wallet.balance, before.body.wallet.balance - 500);
});

test('a hands-free charge to a payee outside the mandate allowlist is refused', async () => {
  // ₹500 is inside the limit, so the only thing stopping this is the caregiver's allowlist.
  const intentId = 'INT-LOOKALIKE';
  const pin = await verifyPin({
    intentId,
    amountPaise: 50000,
    payee: 'Sharma Kiran Store',
    payeeVpa: 'sharma.kirana@okaxis',
    sessionId: 'allowlist-session',
  });
  // Refused before the PIN is even scored, so an unauthorized payee cannot burn attempts.
  assert.equal(pin.status, 422);
  assert.equal(pin.body.code, 'payee_not_on_mandate');
  assert.equal(pin.body.authToken, undefined);
  assert.ok(pin.body.authorizedPayees.includes('Sharma Kirana'));
});

test('an unauthorized payee refusal does not consume a PIN attempt', async () => {
  const sessionId = 'allowlist-attempts';
  const payload = { intentId: 'INT-ATTEMPTS', amountPaise: 50000, payee: 'Sharma Kiran Store', sessionId };

  const first = await verifyPin(payload);
  const second = await verifyPin(payload);
  assert.equal(first.status, 422);
  assert.equal(second.status, 422);

  // The same session can still authorize a legitimate payee afterwards.
  const recovered = await verifyPin({ ...payload, payee: 'Sharma Kirana', payeeVpa: 'sharmakirana@ybl' });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.verified, true);
});

test('the allowlist matches on VPA as well as name', async () => {
  const intentId = 'INT-VPA';
  const pin = await verifyPin({
    intentId,
    amountPaise: 24000,
    payee: 'Rakesh Medical',
    payeeVpa: 'rakesh.med@ybl',
    sessionId: 'vpa-session',
  });
  const executed = await post('/api/payment/execute', {
    authToken: pin.body.authToken,
    intentId,
    amountPaise: 24000,
    payee: 'Rakesh Medical',
    payeeVpa: 'rakesh.med@ybl',
  });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.payment.status, 'captured');
});

test('a caregiver approval authorizes a one-off payee outside the allowlist', async () => {
  const intentId = 'INT-ONEOFF';
  // Deliberately inside the ₹15,000 cap: the only thing blocking this payee is the allowlist.
  const amountPaise = 50000;
  const approval = await post('/api/caregiver/approve', { intentId, amountPaise, payee: 'Aman Traders' });
  const pin = await verifyPin({
    intentId,
    amountPaise,
    payee: 'Aman Traders',
    payeeVpa: 'aman.traders@paytm',
    caregiverApprovalId: approval.body.approvalId,
    sessionId: 'oneoff-session',
  });
  assert.equal(pin.body.authorizationMode, 'caregiver-assisted');

  const executed = await post('/api/payment/execute', {
    authToken: pin.body.authToken,
    intentId,
    amountPaise,
    payee: 'Aman Traders',
    payeeVpa: 'aman.traders@paytm',
  });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.authorizationMode, 'caregiver-assisted');
});

test('an unknown API route is not silently treated as a payment', async () => {
  const { status, body } = await post('/api/payment/free-money', {});
  assert.equal(status, 404);
  assert.equal(body.error, 'API route not found');
});

// --- Caregiver profile setup (one-time visual step) ---------------------------

test('the caregiver can personalise the profile and tighten the mandate bounds', async () => {
  const { status, body } = await post('/api/caregiver/profile', {
    elderName: 'Kamla Verma',
    caregiverName: 'Rohan Verma',
    caregiverRelationship: 'Son',
    caregiverPhone: '+91 98111 22233',
    perTransactionLimit: 3000,
    dailyLimit: 9000,
  });
  assert.equal(status, 200);
  assert.equal(body.updated, true);
  assert.equal(body.elder.name, 'Kamla Verma');
  assert.equal(body.elder.handle, 'KV');
  assert.equal(body.caregiver.name, 'Rohan Verma');
  assert.equal(body.caregiver.relationship, 'Son');
  assert.equal(body.perTransactionLimit, 3000);
  assert.equal(body.dailyLimit, 9000);

  const mandate = (await get('/api/mandate')).body;
  assert.equal(mandate.elder.name, 'Kamla Verma');
  assert.equal(mandate.perTransactionLimit, 3000);

  // The tightened cap is enforced immediately: ₹4,000 now exceeds the new ₹3,000 limit.
  const over = await verifyPin({ intentId: 'INT-TIGHT', amountPaise: 400000, sessionId: 'tight-session' });
  assert.equal(over.status, 422);
  assert.equal(over.body.code, 'caregiver_approval_required');
});

test('the caregiver cannot widen the hands-free bounds past the RBI ceiling', async () => {
  const { status, body } = await post('/api/caregiver/profile', { perTransactionLimit: 99999 });
  assert.equal(status, 400);
  assert.equal(body.updated, false);
  assert.match(body.reason, /per-transaction limit/);
});

test('the caregiver can set a new Voice PIN and the old one stops working', async () => {
  const changed = await post('/api/voice-pin/set', { pinDigits: '4321' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.voicePinLength, 4);

  const oldPin = await verifyPin({ pinDigits: DEMO_PIN, intentId: 'INT-OLDPIN', sessionId: 'oldpin-session' });
  assert.equal(oldPin.status, 401);
  assert.equal(oldPin.body.authToken, undefined);

  const newPin = await verifyPin({ pinDigits: '4321', intentId: 'INT-NEWPIN', sessionId: 'newpin-session' });
  assert.equal(newPin.status, 200);
  assert.equal(newPin.body.verified, true);

  // Reset back to the shared demo PIN so later assertions in this file stay valid.
  await post('/api/voice-pin/set', { pinDigits: DEMO_PIN });
  // And restore the default bounds used by the other tests.
  await post('/api/caregiver/profile', { perTransactionLimit: 15000, dailyLimit: 50000, elderName: 'Sarla Devi', caregiverName: 'Meera Sharma', caregiverRelationship: 'Daughter' });
});

test('a Voice PIN outside 4–6 digits is rejected', async () => {
  const { status, body } = await post('/api/voice-pin/set', { pinDigits: '12' });
  assert.equal(status, 400);
  assert.equal(body.updated, false);
});

test('the caregiver can add a trusted payee, who then pays hands-free', async () => {
  const added = await post('/api/caregiver/payees', {
    name: 'Gupta Dairy',
    vpa: 'gupta.dairy@okhdfcbank',
    usualAmountRupees: 120,
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.added, true);
  assert.equal(added.body.payee.name, 'Gupta Dairy');

  const mandate = (await get('/api/mandate')).body;
  assert.ok(mandate.authorizedPayees.some((payee) => payee.vpa === 'gupta.dairy@okhdfcbank'));

  // The freshly added payee is now on the allowlist and can be charged hands-free.
  const pin = await verifyPin({
    intentId: 'INT-DAIRY',
    amountPaise: 12000,
    payee: 'Gupta Dairy',
    payeeVpa: 'gupta.dairy@okhdfcbank',
    sessionId: 'dairy-session',
  });
  assert.equal(pin.status, 200);
  const executed = await post('/api/payment/execute', {
    authToken: pin.body.authToken,
    intentId: 'INT-DAIRY',
    amountPaise: 12000,
    payee: 'Gupta Dairy',
    payeeVpa: 'gupta.dairy@okhdfcbank',
  });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.payment.status, 'captured');
});

test('a payee with a malformed UPI ID is rejected', async () => {
  const { status, body } = await post('/api/caregiver/payees', { name: 'Bad Merchant', vpa: 'not-a-vpa' });
  assert.equal(status, 400);
  assert.equal(body.added, false);
  assert.match(body.reason, /UPI ID/);
});

test('adding a payee that already exists updates it instead of duplicating', async () => {
  const first = await post('/api/caregiver/payees', { name: 'Singh Bakery', vpa: 'singh.bakery@ybl', usualAmountRupees: 80 });
  const second = await post('/api/caregiver/payees', { name: 'Singh Bakery', vpa: 'singh.bakery@ybl', usualAmountRupees: 95 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.updated, true);
  assert.equal(second.body.payee.usualAmountRupees, 95);
  const count = second.body.authorizedPayees.filter((payee) => payee.vpa === 'singh.bakery@ybl').length;
  assert.equal(count, 1);
});

// --- Biometric confirmation ---------------------------------------------------
// These run last because enrollment and the caregiver's skip-PIN policy are server
// state shared by the whole file.

const verifyBio = (overrides = {}) =>
  post('/api/biometric/verify', {
    modality: 'voiceprint',
    transcript: 'yes confirm',
    sampleMs: 1500,
    sessionId: `bio-${Math.random().toString(36).slice(2)}`,
    intentId: 'INT-BIO',
    amountPaise: 50000,
    payee: 'Sharma Kirana',
    payeeVpa: 'sharmakirana@ybl',
    ...overrides,
  });

test('the mandate exposes the biometric policy block', async () => {
  const { status, body } = await get('/api/mandate');
  assert.equal(status, 200);
  assert.deepEqual(body.biometrics.modalities, ['voiceprint', 'fingerprint', 'face']);
  assert.equal(body.biometrics.deviceBiometricSkipsPin, false);
  assert.equal(body.biometrics.voiceprintThreshold, 0.85);
  assert.equal(body.biometrics.fingerprintEnrolled, false);
});

test('an unenrolled biometric factor is refused before anything is scored', async () => {
  const { status, body } = await verifyBio({ modality: 'face' });
  assert.equal(status, 422);
  assert.equal(body.verified, false);
  assert.equal(body.code, 'biometric_not_enrolled');
  assert.match(body.reason, /No face is enrolled/);
});

test('an enrolled voiceprint confirms the yes but never issues a charge token', async () => {
  const enrolled = await post('/api/biometric/enroll', { modality: 'voiceprint', sessionId: 'bio-enroll', sampleMs: 1800 });
  assert.equal(enrolled.status, 200);
  assert.equal(enrolled.body.enrolled, true);
  assert.equal(enrolled.body.engine, 'awaazpay-voiceprint-sim/1');

  const { status, body } = await verifyBio();
  assert.equal(status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.factor, 'voiceprint');
  assert.equal(body.nextStep, 'voice-pin', 'a voiceprint confirms but hands off to the Voice PIN');
  assert.equal(body.authorizesCharge, false);
  assert.equal(body.authToken, undefined, 'no charge token may be issued for a voiceprint alone');
  assert.ok(body.score >= 0.85);
});

test('a voiceprint can never skip the PIN, even with the caregiver toggle on', async () => {
  const setting = await post('/api/biometric/settings', { deviceBiometricSkipsPin: true });
  assert.equal(setting.status, 200);
  assert.equal(setting.body.deviceBiometricSkipsPin, true);
  assert.equal(setting.body.voiceprintNeverSkipsPin, true);

  const { body } = await verifyBio();
  assert.equal(body.verified, true);
  assert.equal(body.nextStep, 'voice-pin');
  assert.equal(body.authorizesCharge, false);
  assert.equal(body.authToken, undefined);
});

test('the settings endpoint rejects a non-boolean policy', async () => {
  const { status, body } = await post('/api/biometric/settings', { deviceBiometricSkipsPin: 'yes' });
  assert.equal(status, 400);
  assert.equal(body.updated, false);
});

test('a device biometric with the caregiver toggle on authorizes the charge with no PIN', async () => {
  const enrolled = await post('/api/biometric/enroll', { modality: 'fingerprint', sessionId: 'bio-fp' });
  assert.equal(enrolled.status, 200);
  assert.equal(enrolled.body.simulated, true, 'no platform authenticator in a test run, so it must say so');
  assert.equal(enrolled.body.engine, 'awaazpay-sim/1');

  const { status, body } = await verifyBio({ modality: 'fingerprint', intentId: 'INT-BIOFP' });
  assert.equal(status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.nextStep, 'execute');
  assert.equal(body.authorizesCharge, true);
  assert.ok(body.authToken, 'a device biometric must yield a mandate-auth token');
  assert.equal(body.authorizationMode, 'fingerprint-biometric-hands-free');

  const before = (await get('/api/mandate')).body.wallet.balance;
  const executed = await post('/api/payment/execute', { authToken: body.authToken, intentId: 'INT-BIOFP' });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.payment.status, 'captured');
  assert.equal(executed.body.authorizationFactor, 'fingerprint');
  assert.equal(executed.body.authorizationMode, 'fingerprint-biometric-hands-free');
  assert.equal(executed.body.visualPinPadShown, false);
  assert.equal(executed.body.payment.authorization_mode, 'fingerprint-biometric-hands-free');
  assert.equal(executed.body.walletBalance, before - 500);
});

test('a biometric cannot bypass the caregiver payee allowlist', async () => {
  const { status, body } = await verifyBio({
    modality: 'fingerprint',
    intentId: 'INT-BIOPAYEE',
    payee: 'Sharma Kiran Store',
    payeeVpa: 'sharma.kirana@okaxis',
  });
  assert.equal(status, 422);
  assert.equal(body.verified, false);
  assert.equal(body.code, 'payee_not_on_mandate');
  assert.equal(body.authToken, undefined);
});

test('a biometric cannot bypass the per-transaction mandate cap', async () => {
  const { status, body } = await verifyBio({ modality: 'fingerprint', intentId: 'INT-BIOCAP', amountPaise: 2500000 });
  assert.equal(status, 422);
  assert.equal(body.verified, false);
  assert.equal(body.code, 'caregiver_approval_required');
  assert.equal(body.authToken, undefined);
});

test('a WebAuthn assertion is refused without a fresh single-use challenge', async () => {
  const { status, body } = await verifyBio({
    modality: 'fingerprint',
    intentId: 'INT-BIOCHAL',
    assertion: { credentialId: 'fake', authenticatorData: 'AA', clientDataJSON: 'AA', signature: 'AA' },
  });
  assert.equal(status, 400);
  assert.equal(body.verified, false);
  assert.match(body.reason, /challenge/i);
});

test('a voiceprint sample is required to match against', async () => {
  const { status, body } = await verifyBio({ transcript: '   ' });
  assert.equal(status, 400);
  assert.equal(body.verified, false);
  assert.match(body.reason, /spoken sample/i);
});
