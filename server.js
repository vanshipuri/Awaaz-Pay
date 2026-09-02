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

const stripeRequest = async (method, endpoint, body) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY is not configured');
  const headers = { authorization: `Bearer ${secret}` };
  const options = { method, headers };
  if (body) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    options.body = body.toString();
  }
  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, options);
  const responseBody = await response.json();
  if (!response.ok) throw new Error(responseBody?.error?.message || `Stripe request failed with ${response.status}`);
  return responseBody;
};

const createStripeCheckoutSession = async (payload) => {
  const amountPaise = Number(payload.amountPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > 10_000_000) {
    throw new Error('amountPaise must be a positive integer no greater than ₹100,000');
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const publicKey = process.env.STRIPE_PUBLIC_KEY || '';
  if (!secret) {
    return {
      mode: 'simulated',
      order: {
        id: `stripe_demo_${crypto.randomBytes(5).toString('hex')}`,
        amount: amountPaise,
        currency: 'inr',
        status: 'created',
      },
    };
  }

  const origin = /^https?:\/\//i.test(String(payload.origin || '')) ? String(payload.origin) : 'http://localhost:5173';
  const sessionBody = new URLSearchParams();
  sessionBody.set('mode', 'payment');
  sessionBody.set('success_url', `${origin}/?stripe_success=1&session_id={CHECKOUT_SESSION_ID}`);
  sessionBody.set('cancel_url', `${origin}/?stripe_cancelled=1`);
  sessionBody.set('line_items[0][quantity]', '1');
  sessionBody.set('line_items[0][price_data][currency]', 'inr');
  sessionBody.set('line_items[0][price_data][unit_amount]', String(amountPaise));
  sessionBody.set('line_items[0][price_data][product_data][name]', `AwaazPay payment to ${String(payload.payee || 'saved payee').slice(0, 100)}`);
  sessionBody.set('metadata[awaazpay_intent]', String(payload.receipt || '').slice(0, 40));
  sessionBody.set('metadata[payee]', String(payload.payee || '').slice(0, 100));

  const session = await stripeRequest('POST', 'checkout/sessions', sessionBody);
  return {
    mode: 'stripe',
    publicKey,
    sessionId: session.id,
    url: session.url,
    session,
  };
};

const verifyStripeSession = async (payload) => {
  const sessionId = String(payload.sessionId || '');
  if (!process.env.STRIPE_SECRET_KEY) return { mode: 'simulated', verified: true, sessionId };
  if (!sessionId) return { mode: 'stripe', verified: false, reason: 'sessionId is required' };
  const session = await stripeRequest('GET', `checkout/sessions/${encodeURIComponent(sessionId)}`);
  return {
    mode: 'stripe',
    verified: session.status === 'complete' && session.payment_status === 'paid',
    sessionId: session.id,
    paymentStatus: session.payment_status,
    status: session.status,
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
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      stripePublicKeyConfigured: Boolean(process.env.STRIPE_PUBLIC_KEY),
      mode: process.env.GROQ_API_KEY || process.env.STRIPE_SECRET_KEY ? 'configured' : 'demo',
    });
    return true;
  }

  if (pathname === '/api/payment/session' && req.method === 'GET') {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const result = await verifyStripeSession({ sessionId: url.searchParams.get('session_id') || '' });
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error.message || 'Could not verify Stripe session' });
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
    if ((pathname === '/api/payment/create-intent' || pathname === '/api/payment/create-order') && req.method === 'POST') {
      const result = await createStripeCheckoutSession(body);
      json(res, 200, result);
      return true;
    }
    if (pathname === '/api/payment/verify' && req.method === 'POST') {
      const result = await verifyStripeSession(body);
      json(res, 200, result);
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

server.listen(port, host, () => {
  console.log(`AwaazPay is running at http://localhost:${port}`);
  console.log(`AI mode: ${process.env.GROQ_API_KEY ? `Groq (${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})` : 'local fallback'}`);
  console.log(`Payment mode: ${process.env.STRIPE_SECRET_KEY ? 'Stripe test mode' : 'simulated test mode'}`);
});
