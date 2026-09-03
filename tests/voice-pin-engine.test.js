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
  vm.runInContext(`${pinEngineSource}\nthis.extractPinDigits = extractPinDigits;`, sandbox);
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
