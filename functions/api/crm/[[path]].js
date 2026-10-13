// The staff CRM's API: /api/crm/*. One password (the CRM_PASSWORD secret)
// opens it; the pages under /crm are gated by functions/crm/_middleware.js.

import {
  Invalid, json, redirect, today, lastDayOf, isMonth, values, guarded, sameOrigin,
  sign, verify, setCookie, same, throttled, failed, succeeded, hashPassword,
} from "../../../server/common.js";
import { STAFF_COOKIE, staffSignedIn } from "../../../server/sessions.js";
import { connections, refresh, tiktokAuthorizeUrl, tiktokExchange } from "../../../server/platforms.js";

const SESSION_DAYS = 30;

const TABLES = {
  clients: {
    name: "t", contact: "t", email: "t", phone: "t", instagram: "t", tiktok: "t", vat: "t", fee: "i",
    videos_per_month: "i", billing_day: "i", start_date: "d", end_date: "d", status: "t", notes: "t",
  },
  charges: {
    client_id: "i", period: "m", kind: "t", description: "t", amount: "i", due_date: "d", paid_at: "d", invoice_no: "t",
  },
  videos: {
    client_id: "i", platform: "t", url: "t", title: "t", published_on: "d", views: "i", reach: "i",
    likes: "i", comments: "i", shares: "i", saves: "i",
  },
};
const ORDER = {
  clients: "status = 'attivo' DESC, name COLLATE NOCASE",
  charges: "period DESC, due_date DESC, id DESC",
  videos: "published_on DESC, id DESC",
};
// The password hash never leaves the server; the CRM only learns whether
// the client can log in.
const SELECT = {
  clients: `SELECT id, name, contact, email, phone, instagram, tiktok, vat, fee, videos_per_month, billing_day,
    start_date, end_date, status, notes, created_at, password IS NOT NULL AS has_access FROM clients`,
  charges: "SELECT * FROM charges",
  videos: "SELECT * FROM videos",
};

// ---- auth --------------------------------------------------------------------

async function login(request, env) {
  if (await throttled(env, request)) return redirect("/crm/login/?e=troppi");
  const password = String((await request.formData()).get("password") ?? "");
  if (!env.CRM_PASSWORD || !password || !(await same(password, env.CRM_PASSWORD))) {
    await failed(env, request);
    return redirect(`/crm/login/?e=${env.CRM_PASSWORD ? "password" : "config"}`);
  }
  await succeeded(env, request);
  return redirect("/crm/", { "Set-Cookie": setCookie(STAFF_COOKIE, await sign(env, "staff", ["crm"], SESSION_DAYS), SESSION_DAYS) });
}

// ---- records -------------------------------------------------------------------

async function list(env, table, url) {
  const where = [];
  const binds = [];
  const client = url.searchParams.get("client_id");
  if (client && TABLES[table].client_id) { where.push("client_id = ?"); binds.push(Number(client)); }
  const month = url.searchParams.get("month");
  if (month && isMonth(month) && table === "videos") { where.push("published_on LIKE ?"); binds.push(`${month}-%`); }
  const sql = `${SELECT[table]} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${ORDER[table]}`;
  const { results } = await env.CRM_DB.prepare(sql).bind(...binds).all();
  return json(results);
}

// Columns that are never empty: a cleared field means their default.
const DEFAULTS = { clients: { fee: 0, videos_per_month: 0, billing_day: 1, status: "attivo" }, charges: { kind: "canone" } };
const typed = (table, body) => {
  const row = values(TABLES[table], body);
  for (const [key, fallback] of Object.entries(DEFAULTS[table] ?? {})) if (key in row && row[key] === null) row[key] = fallback;
  return row;
};

async function create(env, table, body) {
  const row = typed(table, body);
  const keys = Object.keys(row);
  if (!keys.length) throw new Invalid("Nessun dato.");
  const { id } = await env.CRM_DB
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING id`)
    .bind(...Object.values(row)).first();
  // A new video gets its numbers straight away when its platform is connected.
  if (table === "videos") await refresh(env, [await env.CRM_DB.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first()], { maxAgeMinutes: 0 });
  return json(await env.CRM_DB.prepare(`${SELECT[table]} WHERE id = ?`).bind(id).first(), 201);
}

async function update(env, table, id, body) {
  const row = typed(table, body);
  // A changed link points at another video: forget the old one's id.
  if (table === "videos" && "url" in row) row.external_id = null;
  const keys = Object.keys(row);
  if (keys.length) {
    await env.CRM_DB.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...Object.values(row), id).run();
  }
  const updated = await env.CRM_DB.prepare(`${SELECT[table]} WHERE id = ?`).bind(id).first();
  return updated ? json(updated) : json({ error: "Non trovato." }, 404);
}

async function remove(env, table, id) {
  await env.CRM_DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// Sets (or, with an empty password, revokes) a client's area access.
async function setAccess(env, id, body) {
  const password = String(body?.password ?? "");
  if (password && password.length < 8) throw new Invalid("La password deve avere almeno 8 caratteri.");
  const client = await env.CRM_DB.prepare("SELECT email FROM clients WHERE id = ?").bind(id).first();
  if (!client) return json({ error: "Non trovato." }, 404);
  if (password && !client.email) throw new Invalid("Prima inserisci l'email del cliente: è il suo nome utente.");
  await env.CRM_DB.prepare("UPDATE clients SET password = ? WHERE id = ?").bind(password ? await hashPassword(password) : null, id).run();
  return json({ ok: true, has_access: Boolean(password) });
}

// ---- money and the package ---------------------------------------------------------

async function chargeMonth(env, period) {
  const { meta } = await env.CRM_DB.prepare(
    `INSERT OR IGNORE INTO charges (client_id, period, kind, description, amount, due_date)
     SELECT id, ?1, 'canone', 'Visibilità costante', fee, ?1 || '-' || printf('%02d', min(max(billing_day, 1), 28))
     FROM clients
     WHERE status = 'attivo' AND fee > 0
       AND (start_date IS NULL OR start_date <= ?2)
       AND (end_date IS NULL OR end_date >= ?1 || '-01')`,
  ).bind(period, lastDayOf(period)).run();
  return meta.changes;
}

// Pages has no cron, so the month's fees are made the first time the CRM
// opens in that month; a note in settings stops it from running again (and
// from bringing back a fee deleted on purpose).
async function chargeOnce(env, period) {
  const key = `fees:${period}`;
  const done = await env.CRM_DB.prepare("SELECT 1 FROM settings WHERE key = ?").bind(key).first();
  if (done) return;
  await chargeMonth(env, period);
  await env.CRM_DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')").bind(key).run();
}

async function summary(env, url) {
  const now = today();
  const month = isMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : now.slice(0, 7);
  if (month === now.slice(0, 7)) await chargeOnce(env, month);
  const db = env.CRM_DB;
  const like = `${month}-%`;
  const [clients, unpaid, recent, trend] = await db.batch([
    db.prepare(
      `SELECT c.id, c.name, c.status, c.fee, c.videos_per_month, c.email, c.password IS NOT NULL AS has_access,
         (SELECT count(*) FROM videos WHERE client_id = c.id AND published_on LIKE ?1) AS videos,
         (SELECT coalesce(sum(views), 0) FROM videos WHERE client_id = c.id AND published_on LIKE ?1) AS views,
         (SELECT coalesce(sum(likes), 0) + coalesce(sum(comments), 0) + coalesce(sum(shares), 0) + coalesce(sum(saves), 0)
            FROM videos WHERE client_id = c.id AND published_on LIKE ?1) AS interactions,
         (SELECT max(published_on) FROM videos WHERE client_id = c.id) AS last_video,
         (SELECT paid_at IS NOT NULL FROM charges WHERE client_id = c.id AND period = ?2 AND kind = 'canone') AS paid,
         (SELECT coalesce(sum(amount), 0) FROM charges WHERE client_id = c.id AND paid_at IS NULL) AS outstanding
       FROM clients c ORDER BY c.status = 'attivo' DESC, c.name COLLATE NOCASE`,
    ).bind(like, month),
    db.prepare("SELECT * FROM charges WHERE paid_at IS NULL ORDER BY due_date"),
    db.prepare("SELECT * FROM videos ORDER BY published_on DESC, id DESC LIMIT 8"),
    db.prepare(
      `SELECT substr(published_on, 1, 7) AS month, count(*) AS videos, coalesce(sum(views), 0) AS views
       FROM videos WHERE published_on >= ? GROUP BY month ORDER BY month`,
    ).bind(`${Number(now.slice(0, 4)) - 1}${now.slice(4, 7)}-01`),
  ]);
  return json({
    today: now, month, clients: clients.results, unpaid: unpaid.results, recent: recent.results,
    trend: trend.results, connections: await connections(env),
  });
}

// ---- routing -------------------------------------------------------------------

async function api(request, env, path) {
  const url = new URL(request.url);
  const method = request.method;
  const [table, idText, action] = path;
  const id = idText ? Number(idText) : null;
  if (idText && !Number.isInteger(id)) return json({ error: "Non trovato." }, 404);

  if (table === "summary" && method === "GET") return summary(env, url);
  if (table === "charge-month" && method === "POST") {
    const { period } = await request.json();
    if (!isMonth(period)) throw new Invalid("Mese non valido.");
    return json({ created: await chargeMonth(env, period) });
  }
  if (table === "refresh" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const where = body.id ? "WHERE id = ?" : body.client_id ? "WHERE client_id = ?" : "";
    const statement = env.CRM_DB.prepare(`SELECT * FROM videos ${where} ORDER BY metrics_at IS NOT NULL, metrics_at`);
    const { results } = await (where ? statement.bind(Number(body.id ?? body.client_id)) : statement).all();
    const updated = await refresh(env, results, { maxAgeMinutes: body.id ? 0 : 5 });
    return json({ updated, left: Math.max(0, results.length - 12) });
  }
  if (table === "tiktok" && idText === "connect" && method === "GET") {
    if (!env.TIKTOK_CLIENT_KEY) return redirect("/crm/#/collegamenti?e=tiktok-app");
    return redirect(tiktokAuthorizeUrl(env, url.origin, await sign(env, "tiktok", ["state"], 0.02)));
  }
  if (table === "tiktok" && idText === "callback" && method === "GET") {
    const code = url.searchParams.get("code");
    if (!code || !(await verify(env, "tiktok", url.searchParams.get("state")))) return redirect("/crm/#/collegamenti?e=tiktok");
    await tiktokExchange(env, url.origin, code);
    return redirect("/crm/#/collegamenti?ok=tiktok");
  }
  if (table === "clients" && id && action === "access" && method === "POST") return setAccess(env, id, await request.json());

  if (!TABLES[table] || action) return json({ error: "Non trovato." }, 404);
  if (!id && method === "GET") return list(env, table, url);
  if (!id && method === "POST") return create(env, table, await request.json());
  if (id && method === "PATCH") return update(env, table, id, await request.json());
  if (id && method === "DELETE") return remove(env, table, id);
  return json({ error: "Metodo non consentito." }, 405);
}

export async function onRequest({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: "Origine non consentita." }, 403);
  const path = [].concat(params.path ?? []);
  if (path[0] === "login" && request.method === "POST") return guarded(() => login(request, env));
  if (path[0] === "logout" && request.method === "POST") {
    return redirect("/crm/login/", { "Set-Cookie": setCookie(STAFF_COOKIE, "", 0) });
  }
  if (!(await staffSignedIn(request, env))) {
    return path[0] === "tiktok" ? redirect("/crm/login/") : json({ error: "Accesso richiesto." }, 401);
  }
  return guarded(() => api(request, env, path));
}
