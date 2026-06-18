/**
 * Cloudflare Worker — stock price fetcher
 *
 * Environment variables (set in Cloudflare dashboard or wrangler.toml secrets):
 *   FIREBASE_PROJECT_ID    — e.g. "watchlist-12e29"
 *   SERVICE_ACCOUNT_EMAIL  — Firebase service account client_email
 *   SERVICE_ACCOUNT_KEY    — Firebase service account private_key (PEM, newlines as \n)
 *   TRIGGER_SECRET         — shared secret for HTTP /trigger endpoint (optional)
 *   ALLOWED_EMAILS         — comma-separated admin emails for Bearer-token auth (optional fallback)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight — browsers send OPTIONS before a POST with Authorization header
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname !== '/trigger') {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    // Auth: accept either TRIGGER_SECRET header or a valid Firebase ID token
    const authHeader = request.headers.get('Authorization') || '';
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (env.TRIGGER_SECRET && token === env.TRIGGER_SECRET) {
      // secret-based auth OK
    } else if (token) {
      // Verify Firebase ID token
      const ok = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
      if (!ok) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders() });
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders() });
    }

    try {
      const updated = await fetchAndStorePrices(env);
      return new Response(JSON.stringify({ ok: true, updated }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders() });
    }
  },

  async scheduled(event, env) {
    await fetchAndStorePrices(env);
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders() };
}

/* ── Firebase token verification ────────────────────────────────── */
async function verifyFirebaseToken(idToken, projectId) {
  try {
    const parts   = idToken.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.aud !== projectId) return false;
    if (payload.exp < Date.now() / 1000) return false;

    // Fetch Google public keys
    const res  = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    const keys = await res.json();
    const header = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
    const certPem = keys[header.kid];
    if (!certPem) return false;

    const key = await importPublicKeyFromCert(certPem);
    const sig = base64urlToUint8(parts[2]);
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, data);
  } catch {
    return false;
  }
}

async function importPublicKeyFromCert(pem) {
  const b64  = pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
  const der  = base64ToUint8(b64);
  return crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/* ── Firebase Firestore REST API (via service account JWT) ──────── */
async function getFirestoreToken(env) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.SERVICE_ACCOUNT_EMAIL,
    sub: env.SERVICE_ACCOUNT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp,
    scope: 'https://www.googleapis.com/auth/datastore',
  };
  const enc = s => btoa(JSON.stringify(s)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const unsigned = enc(header) + '.' + enc(payload);

  // Import private key
  const pemKey = env.SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n');
  const b64    = pemKey.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
  const der    = base64ToUint8(b64);
  const key    = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig    = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt    = unsigned + '.' + uint8ToBase64url(new Uint8Array(sig));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

async function firestoreSet(token, projectId, docPath, fields) {
  const url  = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const body = { fields: toFirestoreFields(fields) };
  return fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

async function firestoreGet(token, projectId, collPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return (data.documents || []).map(d => fromFirestoreDoc(d));
}

/* ── Main price fetch ────────────────────────────────────── */
async function fetchAndStorePrices(env) {
  const token = await getFirestoreToken(env);

  // Get all tickers from Firestore
  const tickers = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'tickers');
  const symbols  = [...new Set(tickers.map(t => t.symbol).filter(Boolean))];

  if (symbols.length === 0) return 0;

  // Fetch prices in batches of 20
  const BATCH = 20;
  let updated = 0;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const prices = await fetchYahooBatch(batch);
    await Promise.all(Object.entries(prices).map(([sym, p]) =>
      firestoreSet(token, env.FIREBASE_PROJECT_ID, `prices/${sym}`, {
        ...p,
        last_updated: new Date().toISOString(),
      })
    ));
    updated += Object.keys(prices).length;
  }
  return updated;
}

/* ── Yahoo Finance ───────────────────────────────────────── */
async function fetchYahooBatch(symbols) {
  const result = {};
  await Promise.allSettled(symbols.map(async sym => {
    try {
      const data = await fetchYahooQuote(sym);
      if (data) result[sym] = data;
    } catch { /* skip */ }
  }));
  return result;
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const close  = data.chart.result[0].indicators?.quote?.[0]?.close || [];
  const prices = close.filter(v => v != null);
  const last   = meta.regularMarketPrice ?? prices[prices.length - 1];
  if (!last) return null;

  const prev1  = prices[prices.length - 2];
  const prev5  = prices[prices.length - 6];
  const prev22 = prices[prices.length - 23];
  const prev252= prices[0];

  const pct = (curr, prev) => (prev && curr) ? ((curr - prev) / prev * 100) : null;

  // Market cap
  let market_cap = null, market_cap_suffix = '', market_cap_currency = meta.currency || 'USD';
  const mc = meta.marketCap;
  if (mc) {
    if (mc >= 1e12)      { market_cap = (mc / 1e12).toFixed(2); market_cap_suffix = 'T'; }
    else if (mc >= 1e9)  { market_cap = (mc / 1e9).toFixed(2);  market_cap_suffix = 'B'; }
    else if (mc >= 1e6)  { market_cap = (mc / 1e6).toFixed(2);  market_cap_suffix = 'M'; }
    else                 { market_cap = mc.toFixed(0); }
  }

  return {
    name:               meta.longName || meta.shortName || symbol,
    last:               last,
    day_change_pct:     pct(last, prev1),
    week_change_pct:    pct(last, prev5),
    month_change_pct:   pct(last, prev22),
    year_change_pct:    pct(last, prev252),
    pe_ratio:           meta.trailingPE || null,
    market_cap,
    market_cap_suffix,
    market_cap_currency,
    day_volume:         meta.regularMarketVolume || null,
  };
}

/* ── Firestore type helpers ──────────────────────────────── */
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined)    fields[k] = { nullValue: null };
    else if (typeof v === 'boolean')      fields[k] = { booleanValue: v };
    else if (typeof v === 'number')       fields[k] = { doubleValue: v };
    else if (typeof v === 'string')       fields[k] = { stringValue: v };
    else if (Array.isArray(v))            fields[k] = { arrayValue: { values: v.map(i => ({ stringValue: String(i) })) } };
    else                                  fields[k] = { stringValue: String(v) };
  }
  return fields;
}

function fromFirestoreDoc(doc) {
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    if      ('stringValue'  in v) obj[k] = v.stringValue;
    else if ('doubleValue'  in v) obj[k] = v.doubleValue;
    else if ('integerValue' in v) obj[k] = parseInt(v.integerValue);
    else if ('booleanValue' in v) obj[k] = v.booleanValue;
    else if ('nullValue'    in v) obj[k] = null;
    else if ('arrayValue'   in v) obj[k] = (v.arrayValue.values || []).map(i => i.stringValue ?? i.integerValue ?? i.doubleValue);
  }
  return obj;
}

/* ── Crypto utilities ────────────────────────────────────── */
function base64ToUint8(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function base64urlToUint8(b64u) {
  return base64ToUint8(b64u.replace(/-/g,'+').replace(/_/g,'/'));
}
function uint8ToBase64url(arr) {
  let bin = '';
  arr.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
