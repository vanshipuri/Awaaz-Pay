/**
 * End-to-end test of the killer demo flow, driven through the real DOM.
 *
 * It boots server.js, loads index.html + app.js into jsdom, and clicks the same buttons a
 * judge would click:  demo chip → "Say YES" → Voice PIN keypad → hands-free success.
 *
 * Requires devDependencies:  npm install
 * Run with:                  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 5198;
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

const waitFor = async (predicate, { timeout = 6000, label = 'condition' } = {}) => {
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
      AWAAZPAY_PIN_SALT: 'e2e-salt',
      AWAAZPAY_AUTH_SECRET: 'e2e-secret',
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

/** Loads the real console into jsdom and wires relative fetches to the test server. */
const bootConsole = async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  const dom = new JSDOM(html, { runScripts: 'dangerously', url: `${BASE}/`, pretendToBeVisual: true });
  const { window } = dom;

  // jsdom has no fetch; bridge to Node's and resolve relative API routes.
  window.fetch = (input, init) => fetch(new URL(String(input), BASE).href, init);
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

  window.eval(appSource);
  // Wait for the *server* mandate record (not the offline fallback) so balances are real.
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

test('the console boots into Smart Demo Mode with the mandate loaded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  assert.match(text(document, '#providerMode'), /Smart Demo Mode/);
  assert.match(text(document, '#mandateLimit'), /5,000/);
  assert.match(text(document, '#mandateStatus'), /active/);
  assert.equal(document.querySelectorAll('#stepList .agent-step').length, 6, 'the loop should include the Voice PIN step');
  assert.match(text(document, '#stepList'), /Voice PIN/);
  assert.ok(document.getElementById('pinBadge').classList.contains('hidden'), 'PIN badge starts hidden');
});

test('Scenario 1: speak → yes → Voice PIN → hands-free success', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  // The wallet is shared server state across tests, so assert the delta, not an absolute.
  const rupees = () => Number(text(document, '#balanceDisplay').replace(/[^0-9]/g, ''));
  const balanceBefore = rupees();

  // 1. "Sharma kirana ko paanch sau rupaye bhejo"
  click(document, '[data-demo="safe"]');
  await waitFor(() => document.querySelector('#confirmPayment'), { label: 'the confirmation button' });
  assert.match(text(document, '#reviewContent'), /Say YES/, 'a clear yes must be required');
  assert.match(text(document, '#reviewContent'), /Within ₹5,000 · hands-free/, 'mandate headroom should be shown');

  // 2. Say YES → the new authenticate state, not a payment.
  click(document, '#confirmPayment');
  await waitFor(() => document.getElementById('pinBadge') && !document.getElementById('pinBadge').classList.contains('hidden'), {
    label: 'the blue WAITING FOR VOICE PIN badge',
  });
  assert.match(document.getElementById('pinBadgeText').textContent, /WAITING FOR VOICE PIN/);
  assert.match(document.getElementById('agentStatus').className, /authenticate/);
  assert.match(text(document, '#agentHeadline'), /Voice PIN/);
  assert.match(text(document, '#reviewContent'), /Say your 4 digit Voice PIN/);
  assert.equal(document.querySelectorAll('.pin-box').length, 4);
  assert.ok(document.querySelector('#demoPinButton'), 'Smart Demo Mode should offer the demo PIN');

  // 3. Speak "one two three four" — driven here through the keypad fallback.
  for (const digit of DEMO_PIN) click(document, `[data-pin-key="${digit}"]`);

  // 4. Hands-free capture, no PIN pad.
  await waitFor(() => document.getElementById('agentStatus').className.includes('success'), {
    label: 'the success state',
    timeout: 9000,
  });
  assert.match(text(document, '#reviewContent'), /Paid hands-free · no PIN pad/);
  assert.match(text(document, '#reviewContent'), /visual PIN pad: never shown/);
  assert.match(text(document, '#reviewContent'), /pay_/, 'a Razorpay payment id should be shown');
  assert.equal(text(document, '#metricPayments'), '1');
  assert.equal(text(document, '#metricPins'), '1');
  assert.equal(rupees(), balanceBefore - 500, 'the wallet should be debited by exactly ₹500');
  assert.ok(document.getElementById('pinBadge').classList.contains('hidden'), 'badge clears after success');

  // 5. The caregiver log at the bottom recorded the chain — without the PIN digits.
  const log = text(document, '#logEntries');
  assert.match(log, /Voice PIN requested/);
  assert.match(log, /Voice PIN verified/);
  assert.match(log, /Razorpay S2S charge/);
  assert.match(log, /Payment complete/);
  assert.ok(!log.includes(DEMO_PIN), 'the spoken PIN must never reach the caregiver log');
  assert.match(log, /••••/, 'the PIN should appear redacted');
});

test('a wrong Voice PIN is retried and never charges the mandate', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  const balanceBefore = Number(text(document, '#balanceDisplay').replace(/[^0-9]/g, ''));

  click(document, '[data-demo="safe"]');
  await waitFor(() => document.querySelector('#confirmPayment'), { label: 'the confirmation button' });
  click(document, '#confirmPayment');
  await waitFor(() => !document.getElementById('pinBadge').classList.contains('hidden'), { label: 'the PIN badge' });

  for (const digit of '9999') click(document, `[data-pin-key="${digit}"]`);

  // The rejected panel is rendered with .error — the fresh panel also says "3 attempts left",
  // so wait for the class rather than the copy.
  await waitFor(() => document.querySelector('.pin-panel.error'), {
    label: 'the rejection panel',
    timeout: 9000,
  });
  assert.match(text(document, '#pinSubline'), /did not match your Voice PIN/i);
  assert.match(text(document, '#pinSubline'), /2 attempts left/);
  assert.match(document.getElementById('agentStatus').className, /authenticate/, 'still waiting for the PIN');
  assert.equal(text(document, '#metricPayments'), '0', 'nothing may be paid');
  assert.equal(
    Number(text(document, '#balanceDisplay').replace(/[^0-9]/g, '')),
    balanceBefore,
    'a wrong PIN must not debit the wallet',
  );

  // Recovering with the right PIN still completes the payment.
  for (const digit of DEMO_PIN) click(document, `[data-pin-key="${digit}"]`);
  await waitFor(() => document.getElementById('agentStatus').className.includes('success'), {
    label: 'recovery to success',
    timeout: 9000,
  });
  assert.equal(text(document, '#metricPayments'), '1');
});

test('Scenario 2: a collect request is flagged as a pull scam and can be declined', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  const balanceBefore = text(document, '#balanceDisplay');
  click(document, '[data-demo="collect"]');
  await waitFor(() => document.querySelector('#declineButton'), { label: 'the decline button' });
  assert.match(text(document, '#reviewContent'), /Stop — this would take money from you/);
  assert.match(text(document, '#reviewContent'), /Pulls money out/);
  assert.match(text(document, '#reviewContent'), /never mandated|Pulls are never mandated/);
  assert.match(document.getElementById('agentStatus').className, /guard/);

  click(document, '#declineButton');
  await waitFor(() => document.getElementById('agentStatus').className.includes('blocked'), { label: 'the blocked state' });
  assert.match(text(document, '#reviewContent'), /Request declined safely/);
  assert.equal(text(document, '#metricScams'), '1');
  assert.equal(text(document, '#balanceDisplay'), balanceBefore, 'declining a scam must not move money');
});

test('Scenario 3: above the mandate limit there is no silent bypass', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  click(document, '[data-demo="mandate"]');
  await waitFor(() => document.querySelector('#confirmPayment'), { label: 'the gated confirmation button' });

  assert.match(text(document, '#reviewContent'), /Above your ₹5,000 hands-free mandate/);
  assert.match(text(document, '#reviewContent'), /Above ₹5,000 limit/);
  assert.match(text(document, '#reviewContent'), /Caregiver approval required/);
  assert.equal(document.querySelector('#confirmPayment').disabled, true, 'confirmation is gated until acknowledgement');
  assert.ok(document.getElementById('pinBadge').classList.contains('hidden'), 'no PIN challenge before the guards pass');

  // Acknowledge the warning, then get caregiver approval.
  click(document, '#ackRisk');
  await waitFor(() => document.querySelector('#requestCaregiver'), { label: 'the caregiver button' });
  click(document, '#requestCaregiver');
  await waitFor(() => /Approved by Meera Sharma/.test(text(document, '#reviewContent')), {
    label: 'caregiver approval',
    timeout: 9000,
  });
  assert.equal(document.querySelector('#confirmPayment').disabled, false, 'now the Voice PIN step is allowed');
  assert.match(document.querySelector('#confirmPayment').textContent, /Continue to Voice PIN/);

  click(document, '#confirmPayment');
  await waitFor(() => !document.getElementById('pinBadge').classList.contains('hidden'), { label: 'the PIN badge' });
  assert.match(text(document, '#reviewContent'), /Caregiver assisted/);

  for (const digit of DEMO_PIN) click(document, `[data-pin-key="${digit}"]`);
  await waitFor(() => document.getElementById('agentStatus').className.includes('success'), {
    label: 'caregiver-assisted success',
    timeout: 9000,
  });
  assert.match(text(document, '#reviewContent'), /caregiver assisted/);
});

test('an incomplete command asks for the missing amount instead of guessing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  const form = document.getElementById('typedCommandForm');
  form.classList.remove('hidden');
  const input = document.getElementById('commandInput');
  input.value = 'Rakesh Medical ko pay karo';
  form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => /CLARIFICATION NEEDED/.test(text(document, '#reviewContent')), { label: 'the clarification panel' });
  assert.match(text(document, '#reviewContent'), /missing amount/);
  assert.match(text(document, '#reviewContent'), /will not guess/i);
  assert.match(document.getElementById('agentStatus').className, /clarify/);
  assert.ok(document.getElementById('pinBadge').classList.contains('hidden'));
});

test('the caregiver mandate setup can be replayed for judges', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { document } = await bootConsole();

  click(document, '#mandateSetupButton');
  await waitFor(() => !document.getElementById('mandateModal').classList.contains('hidden'), { label: 'the mandate modal' });
  assert.equal(document.querySelectorAll('#mandateSteps .mandate-step').length, 5);
  await waitFor(() => !document.getElementById('mandateDone').disabled, { label: 'mandate activation', timeout: 8000 });
  assert.match(text(document, '#mandateSteps'), /Mandate registered/);
  assert.equal(document.querySelectorAll('#mandateSteps .mandate-step.active').length, 5);

  click(document, '#mandateDone');
  assert.ok(document.getElementById('mandateModal').classList.contains('hidden'));
});
