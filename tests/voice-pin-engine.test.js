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
    `${pinEngineSource}\nthis.extractPinDigits = extractPinDigits;\nthis.detectPinIntent = detectPinIntent;`,
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
