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

// Batch-write up to 500 docs in a single Firestore commit request (1 subrequest).
async function firestoreBatchSet(token, projectId, writes) {
  if (writes.length === 0) return;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const body = {
    writes: writes.map(({ docPath, fields }) => ({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/${docPath}`,
        fields: toFirestoreFields(fields),
      },
    })),
  };
  return fetch(url, {
    method:  'POST',
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

/* ── Main price fetch ─────────────────────────── */
async function fetchAndStorePrices(env) {
  const token = await getFirestoreToken(env);

  // Get all tickers from Firestore
  const tickers = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'tickers');
  const tickerSymbols = tickers.map(t => t.symbol).filter(Boolean);

  // Also include ticker_overview symbols stored in sectors (may not be in tickers collection)
  const sectors = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'sectors');
  const overviewSymbols = sectors.flatMap(s => s.ticker_overview || []).filter(Boolean);

  const symbols = [...new Set([...tickerSymbols, ...overviewSymbols])];

  if (symbols.length === 0) return 0;

  // A crumb/cookie session is needed for the v7 quote endpoint (P/E, market cap).
  const session = await getYahooSession();

  // Fetch all prices in batches of 20 (Yahoo limit), collect writes, then commit
  // everything in a single Firestore batch request to stay under the 50-subrequest limit.
  const BATCH = 20;
  const allWrites = [];
  const now = new Date().toISOString();
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const prices = await fetchYahooBatch(batch);
    const meta   = await fetchQuoteMeta(batch, session);
    for (const [sym, p] of Object.entries(prices)) {
      allWrites.push({
        docPath: `prices/${sym}`,
        fields: { ...p, ...(meta[sym] || {}), last_updated: now },
      });
    }
  }

  // Single commit for all symbols — counts as 1 subrequest regardless of symbol count.
  await firestoreBatchSet(token, env.FIREBASE_PROJECT_ID, allWrites);
  return allWrites.length;
}

/* ── Yahoo Finance ────────────────────────── */
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

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

/* Batched P/E + market cap + currency via the v7 quote endpoint. */
async function fetchQuoteMeta(symbols, session) {
  const out = {};
  if (!session) return out;
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote`
      + `?symbols=${encodeURIComponent(symbols.join(','))}`
      + `&crumb=${encodeURIComponent(session.crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, 'Cookie': session.cookie } });
    if (!res.ok) return out;
    const data = await res.json();
    for (const q of data?.quoteResponse?.result || []) {
      if (!q.symbol) continue;
      const fields = {};
      if (q.trailingPE != null) fields.pe_ratio = q.trailingPE;
      if (q.marketCap != null) {
        const mc = q.marketCap;
        let val, suffix = '';
        if      (mc >= 1e12) { val = (mc / 1e12).toFixed(2); suffix = 'T'; }
        else if (mc >= 1e9)  { val = (mc / 1e9).toFixed(2);  suffix = 'B'; }
        else if (mc >= 1e6)  { val = (mc / 1e6).toFixed(2);  suffix = 'M'; }
        else                 { val = mc.toFixed(0); }
        fields.market_cap          = val;
        fields.market_cap_suffix   = suffix;
        fields.market_cap_currency = q.currency || 'USD';
      }
      out[q.symbol] = fields;
    }
  } catch { /* skip — P/E & market cap just stay unset */ }
  return out;
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, {
    headers: { 'User-Agent': YAHOO_UA },
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

  // Note: P/E and market cap come from the v7 quote endpoint (see fetchQuoteMeta);
  // the chart endpoint's meta does not carry them.
  return {
    name:               meta.longName || meta.shortName || symbol,
    last:               last,
    day_change_pct:     pct(last, prev1),
    week_change_pct:    pct(last, prev5),
    month_change_pct:   pct(last, prev22),
    year_change_pct:    pct(last, prev252),
    day_volume:         meta.regularMarketVolume || null,
  };
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
