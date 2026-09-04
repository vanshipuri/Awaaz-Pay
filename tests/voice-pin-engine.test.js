/**
 * Unit tests for the Voice Passcode Engine.
 *
 * app.js is a browser IIFE, so the pure PIN-parsing block is sliced out of the source and
 * evaluated in a sandbox with the few stubs it needs. That keeps the test honest: it runs the
 * real shipped code, not a copy of it.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const START = 'const PIN_DIGIT_WORDS = {';
const END = 'const redactedPin = ';
const startIndex = source.indexOf(START);
const endIndex = source.indexOf(END);

assert.ok(startIndex > 0, 'PIN_DIGIT_WORDS block not found in app.js');
assert.ok(endIndex > startIndex, 'extractPinDigits block not found in app.js');

const pinEngineSource = source.slice(startIndex, endIndex);

/** Builds the engine with a configurable Smart Demo Mode state. */
const buildEngine = ({ smartDemoMode = true, demoVoicePin = '1234' } = {}) => {
  const sandbox = {
    PIN_LENGTH: 4,
    FALLBACK_VOICE_PIN: '1234',
    DEMO_PIN_SHORTCUT: /\b(demo\s+)?(voice\s+)?pin\b/i,
    appState: { smartDemoMode, mandate: { demoVoicePin } },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${pinEngineSource}\nthis.extractPinDigits = extractPinDigits;\nthis.detectPinIntent = detectPinIntent;\nthis.detectConfirmIntent = detectConfirmIntent;`,
    sandbox,
  );
  return sandbox;
};

test('understands English digits spoken one at a time', () => {
  const { extractPinDigits } = buildEngine();
  const result = extractPinDigits('one two three four');
  assert.equal(result.digits, '1234');
  assert.equal(result.matched, true);
  assert.equal(result.viaShortcut, false);
});

test('understands Hindi (Hinglish) digits', () => {
  const { extractPinDigits } = buildEngine();
  assert.equal(extractPinDigits('ek do teen char').digits, '1234');
  assert.equal(extractPinDigits('paanch chhe saat aath').digits, '5678');
  assert.equal(extractPinDigits('nau shoonya ek do').digits, '9012');
});

test('understands typed and spaced digits', () => {
  const { extractPinDigits } = buildEngine();
  assert.equal(extractPinDigits('1234').digits, '1234');
  assert.equal(extractPinDigits('1 2 3 4').digits, '1234');
  assert.equal(extractPinDigits('my pin is 9 8 7 6').digits, '9876');
});

test('ignores conversational filler around the digits', () => {
  const { extractPinDigits } = buildEngine();
  const result = extractPinDigits('haan ok my voice pin is one two three four please');
  assert.equal(result.digits, '1234');
  assert.equal(result.matched, true);
});

test('the bare word PIN is a Smart Demo Mode shortcut', () => {
  const { extractPinDigits } = buildEngine();
  const result = extractPinDigits('PIN');
  assert.equal(result.viaShortcut, true);
  assert.equal(result.digits, '1234');
  assert.equal(extractPinDigits('demo voice pin').viaShortcut, true);
});

test('does not mistake a payment phrase for a PIN', () => {
  const { extractPinDigits } = buildEngine();
  assert.equal(extractPinDigits('Sharma kirana ko paanch sau rupaye bhejo').matched, false);
  assert.equal(extractPinDigits('cancel').matched, false);
  assert.equal(extractPinDigits('').matched, false);
  // Two digits heard is not an authorization.
  const partial = extractPinDigits('one two');
  assert.equal(partial.matched, false);
  assert.equal(partial.heard, 2);
});

test('truncates to the configured PIN length when more digits are spoken', () => {
  const { extractPinDigits } = buildEngine();
  const result = extractPinDigits('one two three four five six');
  assert.equal(result.digits.length, 4);
  assert.equal(result.digits, '1234');
  assert.equal(result.heard, 6);
});

test('a wrong PIN never parses into the right one', () => {
  const { extractPinDigits } = buildEngine();
  assert.notEqual(extractPinDigits('four three two one').digits, '1234');
  assert.equal(extractPinDigits('four three two one').digits, '4321');
});

test('the demo shortcut follows the configured mandate PIN', () => {
  const { extractPinDigits } = buildEngine({ demoVoicePin: '2468' });
  assert.equal(extractPinDigits('pin').digits, '2468');
});

/* --- spoken intent at the PIN step: refusal must always beat digits ------ */

test('a spoken refusal is classified as cancel, never as digits', () => {
  const { detectPinIntent } = buildEngine();
  for (const phrase of ['no', 'No', 'cancel', 'cancel it', 'stop', 'nahi', 'mat karo', 'band karo', 'chhod do', 'ruko', 'rehne do', "don't", 'do not pay', 'go back']) {
    assert.equal(detectPinIntent(phrase).kind, 'cancel', `"${phrase}" should cancel`);
  }
});

test('cancel wins even when digits are present in the same breath', () => {
  const { detectPinIntent } = buildEngine();
  // Fail-safe: charging a user who said "no" is unrecoverable; re-prompting is not.
  assert.equal(detectPinIntent('no no one two three four').kind, 'cancel');
  assert.equal(detectPinIntent('cancel 1234').kind, 'cancel');
});

test('"no" is not mistaken for the digit nine', () => {
  const { extractPinDigits, detectPinIntent } = buildEngine();
  assert.equal(extractPinDigits('no').heard, 0, '"no" must not parse as 9');
  assert.equal(extractPinDigits('nau').digits, '9', 'Hindi nine still works');
  assert.equal(extractPinDigits('nine').digits, '9');
  assert.equal(detectPinIntent('nau ek do teen').kind, 'digits');
  assert.equal(detectPinIntent('nau ek do teen').digits, '9123');
});

test('a help request is classified separately so it does not burn an attempt', () => {
  const { detectPinIntent } = buildEngine();
  for (const phrase of ['repeat', 'say that again', 'help', 'madad', 'kya', 'what']) {
    assert.equal(detectPinIntent(phrase).kind, 'help', `"${phrase}" should ask for help`);
  }
});

test('a complete PIN is classified as digits', () => {
  const { detectPinIntent } = buildEngine();
  assert.equal(detectPinIntent('one two three four').kind, 'digits');
  assert.equal(detectPinIntent('ek do teen char').digits, '1234');
  assert.equal(detectPinIntent('1234').kind, 'digits');
  assert.equal(detectPinIntent('PIN').kind, 'digits');
  assert.equal(detectPinIntent('PIN').viaShortcut, true);
});

test('partial and empty speech are neither cancel nor digits', () => {
  const { detectPinIntent } = buildEngine();
  assert.equal(detectPinIntent('one two').kind, 'partial');
  assert.equal(detectPinIntent('one two').heard, 2);
  assert.equal(detectPinIntent('').kind, 'empty');
  assert.equal(detectPinIntent('hmm').kind, 'partial');
});

// --- Confirmation-step vocabulary -------------------------------------------
// The review step asks "say yes to confirm, or say exit to cancel". These tests pin
// down the classifier that replaced a click, including the refusal-beats-approval rule.

test('a spoken yes is classified as approval in English and Hindi', () => {
  const { detectConfirmIntent } = buildEngine();
  for (const phrase of ['yes', 'Yes', 'haan', 'haan bhej do', 'ji haan', 'ok', 'okay', 'confirm',
    'theek hai', 'sahi hai', 'bhej do', 'go ahead', 'proceed', 'pay it', 'do it', 'sure', 'pakka']) {
    assert.equal(detectConfirmIntent(phrase).kind, 'approve', `"${phrase}" should approve`);
  }
});

test('a spoken refusal is classified as cancel, including the exit vocabulary', () => {
  const { detectConfirmIntent } = buildEngine();
  for (const phrase of ['no', 'exit', 'exit no transfer', 'no transfer', 'cancel', 'cancel it',
    'nahi', 'nahi bhejna', 'mat bhejo', 'band karo', 'stop', 'abort', 'quit', 'decline',
    'chhod do', 'rehne do', "don't transfer", 'do not pay', 'forget it', 'never mind', 'skip']) {
    assert.equal(detectConfirmIntent(phrase).kind, 'cancel', `"${phrase}" should cancel`);
  }
});

test('a refusal beats an approval in the same breath', () => {
  const { detectConfirmIntent } = buildEngine();
  assert.equal(detectConfirmIntent('no don\'t transfer').kind, 'cancel');
  assert.equal(detectConfirmIntent('ji nahi').kind, 'cancel');
  assert.equal(detectConfirmIntent('no no yes stop').kind, 'cancel');
  assert.equal(detectConfirmIntent('mat bhejo cancel karo').kind, 'cancel');
});

test('"no" is never read as approval and "yes" is never read as refusal', () => {
  const { detectConfirmIntent } = buildEngine();
  assert.notEqual(detectConfirmIntent('no').kind, 'approve');
  assert.notEqual(detectConfirmIntent('yes').kind, 'cancel');
  assert.equal(detectConfirmIntent('yes').heard, 'yes');
});

test('unrelated speech and silence are neither approve nor cancel', () => {
  const { detectConfirmIntent } = buildEngine();
  assert.equal(detectConfirmIntent('hello there').kind, 'unknown');
  assert.equal(detectConfirmIntent('what is my balance').kind, 'unknown');
  assert.equal(detectConfirmIntent('').kind, 'empty');
  assert.equal(detectConfirmIntent('   ').kind, 'empty');
});

test('words that merely contain yes/no are not misread', () => {
  const { detectConfirmIntent } = buildEngine();
  // "yesterday", "known", "notice" and "cancelation" must not trigger on substrings.
  assert.equal(detectConfirmIntent('yesterday I paid').kind, 'unknown');
  assert.equal(detectConfirmIntent('I have known him').kind, 'unknown');
  assert.equal(detectConfirmIntent('send a notice').kind, 'unknown');
});
