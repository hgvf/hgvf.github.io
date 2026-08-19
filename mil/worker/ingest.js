// ingest.js — Cloudflare Worker：mil_feeds 寫入端點。
//   POST /ingest  { feed, date, model?, items[] }   Authorization: Bearer <INGEST_TOKEN>
// 流程：驗 token → 驗 schema（一次列出所有錯誤）→ normalise → Firestore 型別轉換 →
//        服務帳號 JWT(RS256) 換 OAuth token → Firestore REST PATCH（doc id = feed__date，同日重跑覆蓋）。
// 環境變數（皆 Encrypted）：INGEST_TOKEN / GCP_PROJECT_ID / GCP_CLIENT_EMAIL / GCP_PRIVATE_KEY
//
// 401/400 三種情境（無 token / 錯 token / 缺 source_url）不需 GCP 憑證即可測。

const FEEDS = ["defense-digest", "exercise-watch", "doctrine-watch"];
const SENTIMENTS = ["positive", "negative", "neutral"];
const CONFIDENCES = ["high", "medium", "low"];
const MAX_ITEMS = 40, MAX_TEXT = 1200;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/ingest") return json({ error: "not found" }, 404);

    // ── 認證 ──
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);

    // ── 解析 body（去 code fence）──
    let body;
    try { body = JSON.parse(stripFence(await request.text())); }
    catch { return json({ error: "invalid JSON body" }, 400); }

    // ── 驗證 ──
    const errors = validate(body);
    if (errors.length) return json({ error: "validation failed", details: errors }, 400);

    // ── 正規化 ──
    const doc = normalise(body);

    // ── 寫入 Firestore ──
    try {
      const accessToken = await getAccessToken(env);
      const name = `projects/${env.GCP_PROJECT_ID}/databases/(default)/documents/mil_feeds/${doc.feed}__${doc.date}`;
      const fields = toFirestoreFields(doc);
      const res = await fetch(`https://firestore.googleapis.com/v1/${name}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) return json({ error: "firestore write failed", status: res.status, detail: await res.text() }, 502);
      return json({ ok: true, doc_id: `${doc.feed}__${doc.date}`, item_count: doc.item_count });
    } catch (e) {
      return json({ error: "server error", detail: String(e && e.message || e) }, 502);
    }
  },
};

// ── 去 code fence ──
export function stripFence(s) {
  return String(s).trim().replace(/^```(?:json|jsonc)?\s*/i, "").replace(/```\s*$/, "").trim();
}

// ── 驗證（回傳全部錯誤，不遇一即止）──
export function validate(b) {
  const e = [];
  if (!b || typeof b !== "object") return ["body must be an object"];
  if (!FEEDS.includes(b.feed)) e.push(`feed must be one of ${FEEDS.join("|")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) e.push("date must be YYYY-MM-DD");
  if (b.model != null && (typeof b.model !== "string" || b.model.length > 80)) e.push("model must be <=80 chars");
  if (!Array.isArray(b.items)) { e.push("items must be an array"); return e; }
  if (b.items.length === 0) e.push("items must not be empty");
  if (b.items.length > MAX_ITEMS) e.push(`items must be <= ${MAX_ITEMS}`);
  b.items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (!it || typeof it !== "object") { e.push(`${p} must be an object`); return; }
    if (!nonEmpty(it.headline) || it.headline.length > MAX_TEXT) e.push(`${p}.headline required, <=${MAX_TEXT}`);
    if (!nonEmpty(it.summary) || it.summary.length > MAX_TEXT) e.push(`${p}.summary required, <=${MAX_TEXT}`);
    if (!nonEmpty(it.source_name)) e.push(`${p}.source_name required`);
    if (!/^https?:\/\//.test(it.source_url || "")) e.push(`${p}.source_url required and must be http(s) — no source, no record`);
    if (it.published_at != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.published_at)) e.push(`${p}.published_at must be YYYY-MM-DD`);
    if (it.sentiment != null && !SENTIMENTS.includes(it.sentiment)) e.push(`${p}.sentiment invalid`);
    if (it.confidence != null && !CONFIDENCES.includes(it.confidence)) e.push(`${p}.confidence invalid`);
    if (it.tags != null && (!Array.isArray(it.tags) || it.tags.length > 8)) e.push(`${p}.tags must be array <=8`);
    if (it.entities != null && (!Array.isArray(it.entities) || it.entities.length > 12)) e.push(`${p}.entities must be array <=12`);
  });
  return e;
}
const nonEmpty = s => typeof s === "string" && s.trim().length > 0;

// ── 正規化：去多餘欄位、填 default ──
export function normalise(b) {
  const items = b.items.map(it => ({
    headline: String(it.headline).trim(),
    summary: String(it.summary).trim(),
    source_name: String(it.source_name).trim(),
    source_url: String(it.source_url).trim(),
    published_at: it.published_at || null,
    sentiment: SENTIMENTS.includes(it.sentiment) ? it.sentiment : "neutral",
    confidence: CONFIDENCES.includes(it.confidence) ? it.confidence : "medium",
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 8).map(String) : [],
    entities: Array.isArray(it.entities) ? it.entities.slice(0, 12).map(String) : [],
  }));
  return {
    feed: b.feed,
    date: b.date,
    model: b.model ? String(b.model).slice(0, 80) : null,
    generated_at: new Date().toISOString(),
    item_count: items.length,
    items,
  };
}

// ── JS 值 → Firestore REST 型別 ──
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: mapFields(v) } };
  return { stringValue: String(v) };
}
function mapFields(obj) { const f = {}; for (const k in obj) f[k] = toValue(obj[k]); return f; }
export function toFirestoreFields(doc) { return mapFields(doc); }

// ── 服務帳號 JWT(RS256) → OAuth token（isolate 內快取）──
let _tokenCache = { token: null, exp: 0 };
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: env.GCP_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const key = await importPrivateKey(env.GCP_PRIVATE_KEY);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error("oauth token exchange failed: " + await res.text());
  const data = await res.json();
  _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return _tokenCache.token;
}

// PEM → CryptoKey；處理 \n 被存成字面 "\\n" 的情況
async function importPrivateKey(pem) {
  const clean = String(pem).replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
function b64url(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function b64urlBytes(bytes) {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
