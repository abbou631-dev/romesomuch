// Shared by the CRM (/crm, /api/crm) and the client area (/area-clienti,
// /api/portal): responses, dates, sessions, passwords and generic records.
// It lives outside functions/ so Pages does not turn it into a route.

export class Invalid extends Error {}

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export const redirect = (location, headers = {}) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", ...headers } });

// The agency works on Rome time.
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
export const lastDayOf = (period) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const addMonths = (period, n) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

// ---- crypto ------------------------------------------------------------------

const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const hmac = async (secret, text) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
};
// Equal-time comparison, through digests so the lengths always match.
export const same = async (a, b) => {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(String(s)))));
  return crypto.subtle.timingSafeEqual(x, y);
};

// ---- sessions ----------------------------------------------------------------

// Lax, not Strict: the TikTok connection comes back to the CRM as a
// navigation from tiktok.com, which a Strict cookie would not survive.
// Writes are guarded by the Origin check instead.
export const setCookie = (name, value, days) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(days * 86400)}`;
export const readCookie = (request, name) =>
  (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];

// A signed value: `parts.expiry.signature`, keyed by the CRM password, so
// changing that password signs everyone out.
export const sign = async (env, scope, parts, days) => {
  const expires = Date.now() + days * 86400e3;
  const body = [...parts, expires].join(".");
  return `${body}.${await hmac(env.CRM_PASSWORD, `${scope}:${body}`)}`;
};
export const verify = async (env, scope, value) => {
  if (!env.CRM_PASSWORD || !value) return null;
  const pieces = value.split(".");
  const signature = pieces.pop();
  const expires = Number(pieces.at(-1));
  if (!signature || !expires || expires < Date.now()) return null;
  return (await same(signature, await hmac(env.CRM_PASSWORD, `${scope}:${pieces.join(".")}`))) ? pieces.slice(0, -1) : null;
};

// Every change must come from these pages: a form on another site cannot
// post here with the session cookie.
export const sameOrigin = (request) => {
  const url = new URL(request.url);
  return request.method === "GET" || request.method === "HEAD" || request.headers.get("Origin") === url.origin;
};

// ---- password guessing -----------------------------------------------------

const MAX_FAILURES = 8;
const WINDOW_S = 15 * 60;
const ip = (request) => request.headers.get("CF-Connecting-IP") ?? "local";
export async function throttled(env, request) {
  const since = Math.floor(Date.now() / 1000) - WINDOW_S;
  const { n } = await env.CRM_DB.prepare("SELECT count(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip(request), since).first();
  return n >= MAX_FAILURES;
}
export async function failed(env, request) {
  const now = Math.floor(Date.now() / 1000);
  await env.CRM_DB.batch([
    env.CRM_DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip(request), now),
    env.CRM_DB.prepare("DELETE FROM login_failures WHERE at <= ?").bind(now - WINDOW_S),
  ]);
}
export const succeeded = (env, request) =>
  env.CRM_DB.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip(request)).run();

// ---- records -------------------------------------------------------------------

const PATTERNS = { d: /^\d{4}-\d{2}-\d{2}$/, m: /^\d{4}-\d{2}$/ };
export const isMonth = (text) => PATTERNS.m.test(text ?? "");

// Keeps only the given columns, typed: t text, i integer, d date, m month.
// An empty field clears the column.
export function values(columns, body) {
  const out = {};
  for (const [key, raw] of Object.entries(body ?? {})) {
    const type = columns[key];
    if (!type) continue;
    if (raw === "" || raw === null || raw === undefined) { out[key] = null; continue; }
    if (type === "i") {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Invalid(`${key}: numero non valido`);
      out[key] = n;
    } else {
      const text = String(raw).trim().slice(0, 4000);
      if (PATTERNS[type] && !PATTERNS[type].test(text)) throw new Invalid(`${key}: data non valida`);
      out[key] = text || null;
    }
  }
  return out;
}

// Turns bad input into a 400 and anything else into a logged 500.
export async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Invalid) return json({ error: error.message }, 400);
    if (/constraint/i.test(String(error?.message))) {
      return json({ error: /UNIQUE/i.test(error.message) ? "Valore già usato (es. email di un altro cliente)." : "Dati non validi." }, 400);
    }
    console.log("crm error", error?.stack ?? error);
    return json({ error: "Errore del server." }, 500);
  }
}
