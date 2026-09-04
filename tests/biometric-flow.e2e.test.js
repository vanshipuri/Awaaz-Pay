/**
 * End-to-end tests for biometric confirmation of the "yes" step.
 *
 * This lives in its own file, on its own server, because biometric enrollment and the
 * caregiver's skip-PIN policy are server-wide state: leaking them into voice-flow.e2e
 * would change what the plain Voice PIN scenarios do.
 *
 * jsdom has no platform authenticator, so fingerprint and face run through the labelled
 * simulation here. The real WebAuthn path is exercised by the assertion checks in
 * mandate-api.test.js and by the server's own verification code.
 *
 * Requires devDependencies:  npm install
 * Run with:                  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_PIN = '1234';

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (error) {
  JSDOM = null;
}

const skipReason = JSDOM ? false : 'jsdom is not installed — run `npm install` first';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, { timeout = 8000, label = 'condition' } = {}) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return true;
    await wait(60);
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${label}`);
};

let server;

test.before(async () => {
  if (skipReason) return;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AWAAZPAY_VOICE_PIN: DEMO_PIN,
      AWAAZPAY_PIN_SALT: 'bio-e2e-salt',
      AWAAZPAY_AUTH_SECRET: 'bio-e2e-secret',
      MANDATE_PER_TXN_LIMIT: '5000',
      WALLET_BALANCE: '12500',
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

const bootConsole = async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const dom = new JSDOM(html, { runScripts: 'dangerously', url: `${BASE}/`, pretendToBeVisual: true });
  const { window } = dom;

  window.fetch = (input, init) => fetch(new URL(String(input), BASE).href, init);
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  window.eval(appSource);
  const serverMandate = await (await fetch(`${BASE}/api/mandate`)).json();
  await waitFor(
    () => window.document.getElementById('mandateId').textContent === serverMandate.id,
    { label: 'the server mandate to load into the console' },
  );
  return { window, document: window.document };
};

const click = (document, selector) => {
  const element = document.querySelector(selector);
  assert.ok(element, `expected to find ${selector}`);
  element.click();
  return element;
};

const text = (document, selector) => document.querySelector(selector)?.textContent || '';

/** Drives the typed fallback, the same path a final speech transcript takes. */
const say = (document, value) => {
  const form = document.getElementById('typedCommandForm');
  form.classList.remove('hidden');
  document.getElementById('commandInput').value = value;
  form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
};

const badgeText = (document) => document.getElementById('pinBadgeText').textContent;
const badgeVisible = (document) => !document.getElementById('pinBadge').classList.contains('hidden');
const rupees = (document) => Number(text(document, '#balanceDisplay').replace(/[^0-9]/g, ''));

const startPayment = async (document) => {
  say(document, 'Sharma kirana ko paanch sau rupaye bhejo');
  await waitFor(() => document.querySelector('#confirmPayment'), { label: 'the confirmation button' });
};

const enrollStates = (document) => [...document.querySelectorAll('.bio-enroll-copy small')].map((el) => el.textContent);

const ENROLL_ROW = { voiceprint: 0, fingerprint: 1, face: 2 };

/** Asks the server what is already enrolled, and enrolls only if needed. Keeps tests order-independent. */
const ensureEnrolled = async (document, modality) => {
  const biometrics = (await (await fetch(`${BASE}/api/mandate`)).json()).biometrics;
  const already = modality === 'voiceprint' ? biometrics.voiceprint : biometrics[`${modality}Enrolled`];
  if (already) return false;
  click(document, '#mandateSetupButton');
  await waitFor(() => document.querySelectorAll('.bio-enroll-row').length === 3, { label: 'enrollment rows' });
  click(document, `[data-bio-enroll="${modality}"]`);
  await waitFor(() => /^enrolled/.test(enrollStates(document)[ENROLL_ROW[modality]]), { label: `${modality} enrolled` });
  click(document, '#closeMandate');
  await wait(250);
  return true;
};

/**
 * Waits for the biometric panel to finish the in-flight voiceprint match. The panel is
 * painted immediately when a yes is spoken, but its factor buttons stay disabled until the
 * server answers, and clicks during that window are ignored on purpose.
 */
const settleBiometricPanel = async (document) => {
  await waitFor(() => document.querySelector('[data-bio-factor="fingerprint"]'), { label: 'the biometric panel' });
  await waitFor(
    () => !document.querySelector('[data-bio-factor="fingerprint"]').disabled,
    { label: 'the biometric panel to settle' },
  );
};

const setSkipPinPolicy = async (document, wanted) => {
  const current = (await (await fetch(`${BASE}/api/mandate`)).json()).biometrics.deviceBiometricSkipsPin;
  if (current === wanted) return;
  click(document, '#mandateSetupButton');
  await waitFor(() => document.getElementById('bioSkipPinToggle'), { label: 'the policy toggle' });
  const toggle = document.getElementById('bioSkipPinToggle');
  toggle.checked = wanted;
  toggle.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => /changed the biometric policy/i.test(text(document, '#logEntries')), { label: 'the policy change' });
  click(document, '#closeMandate');
  await wait(250);
};

test('the caregiver can enroll a biometric factor from the mandate setup', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  click(document, '#mandateSetupButton');
  await waitFor(() => document.querySelectorAll('.bio-enroll-row').length === 3, { label: 'three enrollment rows' });
  assert.deepEqual(enrollStates(document), ['not enrolled yet', 'not enrolled yet', 'not enrolled yet']);

  click(document, '[data-bio-enroll="voiceprint"]');
  await waitFor(() => /^enrolled/.test(enrollStates(document)[0]), { label: 'the voiceprint to enroll' });
  // jsdom has no platform authenticator, so the row must admit it is simulated.
  assert.match(enrollStates(document)[0], /simulator|platform authenticator/);
  assert.match(text(document, '#logEntries'), /Voiceprint enrolled/);

  const toggle = document.getElementById('bioSkipPinToggle');
  assert.ok(toggle, 'the caregiver skip-PIN policy must be a visible choice');
  assert.equal(toggle.checked, false, 'skipping the PIN must be off until a caregiver opts in');
});

test('a spoken yes is confirmed by the enrolled voiceprint, then hands off to the Voice PIN', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  await ensureEnrolled(document, 'voiceprint');
  await setSkipPinPolicy(document, false);
  await startPayment(document);
  say(document, 'yes');

  await waitFor(() => document.getElementById('pinInput'), { label: 'the Voice PIN panel' });
  assert.match(text(document, '#logEntries'), /Voice biometric confirmed/, 'the voiceprint match must be recorded');
  assert.match(text(document, '#logEntries'), /Voice PIN still authorizes the charge/);
  assert.equal(badgeText(document), 'WAITING FOR VOICE PIN', 'the badge must describe the challenge now showing');
  assert.ok(badgeVisible(document));
  assert.ok(!/CLARIFICATION NEEDED/.test(text(document, '#reviewContent')));
});

test('a fingerprint authorizes the charge with no PIN once the caregiver allows it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  // Enroll both factors and let the caregiver opt into skipping the PIN.
  await ensureEnrolled(document, 'voiceprint');
  await ensureEnrolled(document, 'fingerprint');
  await setSkipPinPolicy(document, true);

  const balanceBefore = rupees(document);
  await startPayment(document);
  say(document, 'yes');

  // The voiceprint confirms the yes, then the device factor is offered because it can skip
  // the PIN. Wait for the *settled* panel: it is first painted while the voiceprint match is
  // still in flight, and clicking a factor during that window is deliberately ignored.
  await settleBiometricPanel(document);
  await waitFor(() => /Voice confirmed/i.test(text(document, '#reviewContent')), { label: 'the voiceprint handoff message' });
  assert.equal(badgeText(document), 'WAITING FOR BIOMETRIC');
  assert.match(text(document, '#reviewContent'), /fingerprint or face/i);
  assert.match(text(document, '#logEntries'), /Voice biometric confirmed/);

  click(document, '[data-bio-factor="fingerprint"]');
  await waitFor(() => document.getElementById('agentStatus').className.includes('success'), {
    label: 'the hands-free success state',
    timeout: 10000,
  });

  assert.match(text(document, '#reviewContent'), /Paid hands-free/);
  assert.match(text(document, '#reviewContent'), /Fingerprint biometric · hands-free/, 'the receipt must name the real factor');
  assert.match(text(document, '#reviewContent'), /visual PIN pad: never shown/);
  assert.ok(!/Voice PIN verified/.test(text(document, '#logEntries')), 'the PIN was never used');
  assert.equal(rupees(document), balanceBefore - 500, 'the wallet is debited by exactly ₹500');
});

test('an unenrolled factor routes to enrollment instead of dead-ending', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  // Reaching this panel by voice needs a device factor enrolled and the skip policy on;
  // otherwise the voiceprint match hands straight to the Voice PIN.
  await ensureEnrolled(document, 'voiceprint');
  await ensureEnrolled(document, 'fingerprint');
  await setSkipPinPolicy(document, true);
  await startPayment(document);
  say(document, 'yes');
  await settleBiometricPanel(document);

  click(document, '[data-bio-factor="face"]');
  await waitFor(() => !document.getElementById('mandateModal').classList.contains('hidden'), {
    label: 'the caregiver setup modal',
  });
  assert.match(enrollStates(document)[2], /not enrolled yet/);
  assert.ok(
    document.querySelector('[data-bio-factor="face"]') || document.querySelector('#confirmPayment'),
    'the payment must still be recoverable after the detour',
  );
});

test('the biometric panel always offers the Voice PIN as a fallback', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  await ensureEnrolled(document, 'voiceprint');
  await ensureEnrolled(document, 'fingerprint');
  await setSkipPinPolicy(document, true);
  await startPayment(document);
  say(document, 'yes');
  await settleBiometricPanel(document);
  await waitFor(() => document.querySelector('#bioUsePin'), { label: 'the Voice PIN fallback' });

  assert.ok(document.querySelector('#bioCancel'), 'the payment can always be cancelled from this step');
  click(document, '#bioUsePin');
  await waitFor(() => document.getElementById('pinInput'), { label: 'the Voice PIN panel' });
  assert.equal(badgeText(document), 'WAITING FOR VOICE PIN');
  assert.match(text(document, '#logEntries'), /Biometric skipped by choice/);
});

test('cancelling from the biometric step charges nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  await ensureEnrolled(document, 'voiceprint');
  await ensureEnrolled(document, 'fingerprint');
  await setSkipPinPolicy(document, true);
  const balanceBefore = rupees(document);
  await startPayment(document);
  say(document, 'yes');
  await settleBiometricPanel(document);
  await waitFor(() => document.querySelector('#bioCancel'), { label: 'the cancel control' });

  click(document, '#bioCancel');
  await waitFor(() => document.getElementById('agentStatus').className.includes('ready'), { label: 'the idle state' });
  assert.equal(rupees(document), balanceBefore, 'nothing may be charged after a cancel');
  assert.ok(!document.querySelector('#confirmPayment'));
  assert.ok(document.getElementById('pinBadge').classList.contains('hidden'));
});
