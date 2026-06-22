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

// Bump this whenever the price-fetch logic changes so the live deployment can be
// verified by visiting /version. "batched-v7" = single batched Yahoo v7 quote
// call + single Firestore commit (~8 subrequests total, well under the 50 limit).
const WORKER_VERSION = 'batched-v7+spark50-2026-06-22';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight — browsers send OPTIONS before a POST with Authorization header
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Unauthenticated version probe — visit in a browser to confirm which code is live.
    if (url.pathname === '/version') {
      return new Response(JSON.stringify({ version: WORKER_VERSION }), { headers: jsonHeaders() });
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
      return new Response(JSON.stringify({ ok: true, updated, version: WORKER_VERSION }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, version: WORKER_VERSION }), { status: 500, headers: jsonHeaders() });
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

/* ── Firebase token verification ──────────────────────── */
async function verifyFirebaseToken(idToken, projectId) {
  try {
    const parts   = idToken.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.aud !== projectId) return false;
    if (payload.exp < Date.now() / 1000) return false;

    // Fetch Google public keys in JWK format (directly importable by WebCrypto)
    const res  = await fetch('https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com');
    const jwks = await res.json();
    const header = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
    const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
    const sig = base64urlToUint8(parts[2]);
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, data);
  } catch {
    return false;
  }
}

/* ── Firebase Firestore REST API (via service account JWT) ────── */
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

// Batch-write docs via Firestore :commit. Each commit holds up to 500 writes
// (Firestore hard limit), so chunk accordingly — 1 subrequest per 500 docs.
async function firestoreBatchSet(token, projectId, writes) {
  if (writes.length === 0) return;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const CHUNK = 500;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const body = {
      writes: writes.slice(i, i + CHUNK).map(({ docPath, fields }) => ({
        update: {
          name: `projects/${projectId}/databases/(default)/documents/${docPath}`,
          fields: toFirestoreFields(fields),
        },
      })),
    };
    await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  }
}

async function firestoreGet(token, projectId, collPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return (data.documents || []).map(d => fromFirestoreDoc(d));
}

/* ── Main price fetch ─────────────────────────── */
async function fetchAndStorePrices(env) {
  const token = await getFirestoreToken(env);

  const tickers = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'tickers');
  const tickerSymbols = tickers.map(t => t.symbol).filter(Boolean);

  const sectors = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'sectors');
  const overviewSymbols = sectors.flatMap(s => s.ticker_overview || []).filter(Boolean);

  const symbols = [...new Set([...tickerSymbols, ...overviewSymbols])];
  if (symbols.length === 0) return 0;

  // Sub-request budget for N≈600 symbols (Cloudflare cap = 50/invocation):
  //   token 1 + tickers 1 + sectors 1 + session 2 + quote ceil(N/50)=12
  //   + spark ceil(N/50)=12 + writes ceil(N/500)=2  ≈ 31 — safely under 50.
  const session = await getYahooSession();

  // v7 quote → price, day%, P/E, market cap, volume (batched 50/req)
  const quotes = {};
  const QBATCH = 50;
  for (let i = 0; i < symbols.length; i += QBATCH) {
    Object.assign(quotes, await fetchAllQuoteData(symbols.slice(i, i + QBATCH), session));
  }

  // v8 spark → week/month/year % from historical closes (batched 50/req)
  const spark = await fetchSparkData(symbols, session);

  const now = new Date().toISOString();
  const allWrites = Object.entries(quotes).map(([sym, p]) => ({
    docPath: `prices/${sym}`,
    fields: { ...p, ...(spark[sym] || {}), last_updated: now },
  }));

  await firestoreBatchSet(token, env.FIREBASE_PROJECT_ID, allWrites);
  return allWrites.length;
}

/* ── Yahoo Finance ────────────────────────── */
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/* Single batched v7 quote call — returns price, day%, volume, P/E, market cap.
   Avoids per-symbol v8 chart requests which would exhaust the 50-subrequest limit. */
async function fetchAllQuoteData(symbols, session) {
  const out = {};
  if (!session) return out;
  try {
    const fields = [
      'symbol','shortName','longName',
      'regularMarketPrice','regularMarketChangePercent','regularMarketVolume',
      'regularMarketPreviousClose',
      'fiftyTwoWeekHigh','fiftyTwoWeekLow',
      'trailingPE','marketCap','currency',
    ].join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote`
      + `?symbols=${encodeURIComponent(symbols.join(','))}`
      + `&fields=${encodeURIComponent(fields)}`
      + `&crumb=${encodeURIComponent(session.crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, 'Cookie': session.cookie } });
    if (!res.ok) return out;
    const data = await res.json();
    for (const q of data?.quoteResponse?.result || []) {
      if (!q.symbol || q.regularMarketPrice == null) continue;
      const entry = {
        name:           q.longName || q.shortName || q.symbol,
        last:           q.regularMarketPrice,
        day_change_pct: q.regularMarketChangePercent ?? null,
        day_volume:     q.regularMarketVolume ?? null,
      };
      if (q.trailingPE != null) entry.pe_ratio = q.trailingPE;
      if (q.marketCap  != null) {
        const mc = q.marketCap;
        let val, suffix = '';
        if      (mc >= 1e12) { val = (mc / 1e12).toFixed(2); suffix = 'T'; }
        else if (mc >= 1e9)  { val = (mc / 1e9).toFixed(2);  suffix = 'B'; }
        else if (mc >= 1e6)  { val = (mc / 1e6).toFixed(2);  suffix = 'M'; }
        else                 { val = mc.toFixed(0); }
        entry.market_cap          = val;
        entry.market_cap_suffix   = suffix;
        entry.market_cap_currency = q.currency || 'USD';
      }
      out[q.symbol] = entry;
    }
  } catch { /* skip */ }
  return out;
}

/* Batched week/month/year % via the v8 spark endpoint, which accepts many
   symbols per request (1 request per ~15 symbols) — unlike the v8 chart
   endpoint which is one symbol per request. Computes changes from daily closes. */
async function fetchSparkData(symbols, session) {
  const out = {};
  // 50/req keeps the sub-request count bounded for large watchlists: at ~600
  // symbols that's 12 spark calls (vs 40 at 15/req), leaving plenty of room
  // under Cloudflare's 50 sub-request-per-invocation cap once quote + session +
  // Firestore writes are added in.
  const CHUNK = 50;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const batch = symbols.slice(i, i + CHUNK);
    try {
      let url = `https://query1.finance.yahoo.com/v8/finance/spark`
        + `?symbols=${encodeURIComponent(batch.join(','))}`
        + `&range=1y&interval=1d`;
      if (session?.crumb) url += `&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': YAHOO_UA, ...(session?.cookie ? { Cookie: session.cookie } : {}) },
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of data?.spark?.result || []) {
        const sym    = r.symbol;
        const resp   = r.response?.[0];
        const closes = (resp?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
        if (!sym || closes.length === 0) continue;
        const last = closes[closes.length - 1];
        const pct  = prev => (prev && last) ? ((last - prev) / prev * 100) : null;
        out[sym] = {
          week_change_pct:  pct(closes[closes.length - 6]),
          month_change_pct: pct(closes[closes.length - 23]),
          year_change_pct:  pct(closes[0]),
        };
      }
    } catch { /* skip this chunk */ }
  }
  return out;
}

/* Obtain a cookie + crumb pair so the authenticated v7 quote endpoint works. */
async function getYahooSession() {
  try {
    // Hitting fc.yahoo.com sets the consent/session cookie (responds 404 but sets it).
    const cookieRes = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': YAHOO_UA } });
    const setCookies = typeof cookieRes.headers.getSetCookie === 'function'
      ? cookieRes.headers.getSetCookie()
      : [cookieRes.headers.get('set-cookie')].filter(Boolean);
    const cookie = setCookies.map(c => c.split(';')[0]).join('; ');

    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookie },
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes('<')) return null;   // got an HTML error page, not a crumb
    return { cookie, crumb };
  } catch {
    return null;
  }
}


/* ── Firestore type helpers ──────────────────── */
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

/* ── Crypto utilities ─────────────────────── */
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
