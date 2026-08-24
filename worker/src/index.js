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
const WORKER_VERSION = 'batched-v7+spark50+retry+paginate+chart-v8+diag+host-fallback-2026-08-19';

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

    // Public read-only price-series endpoint for the supply-chain Highlight News
    // trend charts. GET /chart?symbols=2330.TW,AMKR&range=6mo&interval=1d
    // Returns { ok, range, interval, data: { SYMBOL: { name, currency, series:[{date,close}] } } }.
    if (url.pathname === '/chart') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
      }
      const symbols = (url.searchParams.get('symbols') || '')
        .split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);
      const range    = url.searchParams.get('range')    || '6mo';
      const interval = url.searchParams.get('interval') || '1d';
      if (!symbols.length) {
        return new Response(JSON.stringify({ ok: false, error: 'no symbols' }), { status: 400, headers: jsonHeaders() });
      }
      try {
        const session = await getYahooSession();
        const data = await fetchChartSeries(symbols, range, interval, session);
        return new Response(JSON.stringify({ ok: true, range, interval, data }), { headers: jsonHeaders() });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: jsonHeaders() });
      }
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
      const { updated, failed, diag } = await fetchAndStorePrices(env);
      return new Response(JSON.stringify({ ok: true, updated, failed, diag, version: WORKER_VERSION }), { headers: jsonHeaders() });
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
        // Only touch the fields we actually computed this run. Without a mask a
        // commit *replaces* the whole document, which would wipe the
        // week/month/year change % owned by scripts/update_changes.py whenever
        // the Worker's own spark fetch comes back empty (Yahoo frequently blocks
        // the spark endpoint from Cloudflare IPs). The mask makes the write a
        // partial merge so those fields survive a manual price refresh.
        updateMask: { fieldPaths: Object.keys(fields) },
      })),
    };
    const res = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    // Don't report success for writes that never landed — a silently-ignored
    // commit error is exactly what made a failed refresh look like it worked.
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Firestore commit failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  }
}

// List every document in a collection. The Firestore REST list endpoint is
// PAGINATED: without following nextPageToken it returns only the first page, so
// once a collection (e.g. `tickers`) grows past one page the tail is silently
// dropped. That is exactly how a newly-added theme could be missing from the
// price refresh — its symbols fell past page 1 and were never fetched. Loop on
// nextPageToken so the whole collection is always read.
async function firestoreGet(token, projectId, collPath) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collPath}`;
  const docs = [];
  let pageToken = '';
  do {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Firestore list ${collPath} failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    for (const d of data.documents || []) docs.push(fromFirestoreDoc(d));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/* ── Main price fetch ─────────────────────────── */
async function fetchAndStorePrices(env) {
  const token = await getFirestoreToken(env);

  const tickers = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'tickers');
  const tickerSymbols = tickers.map(t => t.symbol).filter(Boolean);

  const sectors = await firestoreGet(token, env.FIREBASE_PROJECT_ID, 'sectors');
  const overviewSymbols = sectors.flatMap(s => s.ticker_overview || []).filter(Boolean);

  const symbols = [...new Set([...tickerSymbols, ...overviewSymbols])];
  if (symbols.length === 0) return { updated: 0, failed: [] };

  // Sub-request budget for N≈600 symbols (Cloudflare cap = 50/invocation):
  //   token 1 + tickers ceil(N/300)=2 + sectors 1 + session 2
  //   + quote ceil(N/50)=12 + spark ceil(N/50)=12 + writes ceil(N/500)=2 ≈ 32
  //   — leaves ~18 spare sub-requests, enough to retry the occasional dropped
  //   quote batch below.
  let session = await getYahooSession();
  console.log(`[trigger] symbols=${symbols.length} session=${session ? 'OK' : 'NULL'}`);

  // v7 quote → price, day%, P/E, market cap, volume (batched 50/req).
  //
  // Yahoo intermittently returns a non-OK response (401 stale-crumb / 429
  // rate-limit) for a batch when many batches are fired back-to-back from a
  // Cloudflare IP. Previously such a batch was silently dropped, wiping all ~50
  // of its symbols from a refresh — which is why a freshly-added sector whose
  // tickers cluster in one batch would show almost no updates while the rest of
  // the watchlist refreshed fine. Retry an empty batch once with a refreshed
  // session so a single transient failure doesn't drop 50 symbols.
  const quotes = {};
  const QBATCH = 50;
  for (let i = 0; i < symbols.length; i += QBATCH) {
    const batch = symbols.slice(i, i + QBATCH);
    let got = await fetchAllQuoteData(batch, session);
    if (Object.keys(got).length === 0 && batch.length > 0) {
      await sleep(400);                                   // let a rate-limit cool off
      session = (await getYahooSession()) || session;      // refresh cookie + crumb
      got = await fetchAllQuoteData(batch, session);
    }
    Object.assign(quotes, got);
  }

  // Symbols Yahoo returned no quote for (delisted, wrong ticker, or a batch that
  // failed even after the retry). Surfaced to the caller so the UI can report it
  // instead of silently showing a stale/blank card.
  const failed = symbols.filter(s => !(s in quotes));

  // v8 spark → week/month/year % from historical closes (batched 50/req)
  const spark = await fetchSparkData(symbols, session);

  console.log(`[trigger] quotes=${Object.keys(quotes).length}/${symbols.length} spark=${Object.keys(spark).length} failed=${failed.length}`);

  const now = new Date().toISOString();
  const allWrites = Object.entries(quotes).map(([sym, p]) => ({
    docPath: `prices/${sym}`,
    fields: { ...p, ...(spark[sym] || {}), last_updated: now },
  }));

  await firestoreBatchSet(token, env.FIREBASE_PROJECT_ID, allWrites);
  // diag travels back in the /trigger JSON so the cause is visible even without
  // a live `wrangler tail` — e.g. sessionOk:false ⇒ Yahoo crumb/cookie failed.
  const diag = {
    symbols: symbols.length,
    sessionOk: !!session,
    quotes: Object.keys(quotes).length,
    spark: Object.keys(spark).length,
  };
  return { updated: allWrites.length, failed, diag };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Yahoo Finance ────────────────────────── */
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/* Single batched v7 quote call — returns price, day%, volume, P/E, market cap.
   Avoids per-symbol v8 chart requests which would exhaust the 50-subrequest limit. */
async function fetchAllQuoteData(symbols, session) {
  const out = {};
  if (!session) { console.warn(`[quote] no session — skipping ${symbols.length} symbols`); return out; }
  const fields = [
    'symbol','shortName','longName',
    'regularMarketPrice','regularMarketChangePercent','regularMarketVolume',
    'regularMarketPreviousClose',
    'fiftyTwoWeekHigh','fiftyTwoWeekLow',
    'trailingPE','marketCap','currency',
  ].join(',');
  // Try query1 then query2: Yahoo intermittently 401/429s one host from a
  // Cloudflare IP while the other still answers, so a host fallback recovers a
  // batch that would otherwise be dropped.
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote`
        + `?symbols=${encodeURIComponent(symbols.join(','))}`
        + `&fields=${encodeURIComponent(fields)}`
        + `&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, 'Cookie': session.cookie } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[quote] ${host} HTTP ${res.status} for ${symbols.length} symbols · body=${JSON.stringify(body.slice(0, 160))}`);
        continue;  // try next host
      }
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
      return out;  // got a good response — no need to try the other host
    } catch (e) {
      console.warn(`[quote] ${host} error: ${e.message}`);
    }
  }
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

/* Date+close series for the Highlight News trend charts.
   Returns { SYMBOL: { name, currency, series:[{date, close}] } }.

   Uses the authenticated v8 *chart* endpoint (one symbol per request) rather
   than the v8 spark endpoint. Spark is frequently blocked for Cloudflare IPs
   (see fetchSparkData's note) and returns empty — which surfaced as
   "查無股價資料" in the UI — whereas the crumb-authenticated chart endpoint works
   like the v7 quote path. Highlight News only ever passes a handful of tickers
   (capped at 25), so per-symbol requests stay well under the 50-subrequest cap. */
async function fetchChartSeries(symbols, range, interval, session) {
  const out = {};
  for (const sym of symbols) {
    let entry = await fetchOneChart(sym, range, interval, session);
    // A single transient 401 (stale crumb) / 429 shouldn't blank a symbol —
    // refresh the session once and retry, mirroring the quote-batch retry.
    if (!entry) {
      await sleep(200);
      session = (await getYahooSession()) || session;
      entry = await fetchOneChart(sym, range, interval, session);
    }
    if (entry) out[sym] = entry;
  }
  return out;
}

/* Single-symbol v8 chart fetch → { name, currency, series:[{date, close}] } or
   null on any failure/empty response. */
async function fetchOneChart(symbol, range, interval, session) {
  try {
    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
      + `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    if (session?.crumb) url += `&crumb=${encodeURIComponent(session.crumb)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA, ...(session?.cookie ? { Cookie: session.cookie } : {}) },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const ts     = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    const meta   = r.meta || {};
    const series = [];
    for (let j = 0; j < ts.length; j++) {
      const c = closes[j];
      if (c == null) continue;
      series.push({ date: new Date(ts[j] * 1000).toISOString().slice(0, 10), close: Math.round(c * 100) / 100 });
    }
    if (!series.length) return null;
    return {
      name: meta.shortName || meta.longName || meta.symbol || symbol,
      currency: meta.currency || null,
      series,
    };
  } catch {
    return null;
  }
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
    console.log(`[yahoo] cookie: HTTP ${cookieRes.status} · ${setCookies.length} cookie(s) · len=${cookie.length}`);

    // Crumb must match the cookie; try both hosts since one can be rate-limited.
    for (const host of ['query1', 'query2']) {
      const crumbRes = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, {
        headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookie },
      });
      const crumb = (await crumbRes.text()).trim();
      console.log(`[yahoo] crumb ${host}: HTTP ${crumbRes.status} · len=${crumb.length} · ${JSON.stringify(crumb.slice(0, 50))}`);
      if (crumbRes.ok && crumb && !crumb.includes('<')) return { cookie, crumb };
    }
    console.warn('[yahoo] no valid crumb from either host — quote calls will return nothing');
    return null;
  } catch (e) {
    console.error(`[yahoo] session error: ${e.message}`);
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
