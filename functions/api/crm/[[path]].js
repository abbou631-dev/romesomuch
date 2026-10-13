// The staff CRM's API: /api/crm/*. One password (the CRM_PASSWORD secret)
// opens it; the pages under /crm are gated by functions/crm/_middleware.js.

import {
  Invalid, json, redirect, today, lastDayOf, isMonth, addMonths, values, guarded, sameOrigin,
  sign, verify, setCookie, same, throttled, failed, succeeded,
} from "../../../server/common.js";
import { randomToken, sendLinks } from "../../../server/access.js";
import { reportList, reportText, reportSubject, sendReport } from "../../../server/reports.js";
import { STAFF_COOKIE, VIEW_COOKIE, staffSignedIn } from "../../../server/sessions.js";
import { connections, refresh, tiktokAuthorizeUrl, tiktokExchange } from "../../../server/platforms.js";
import { upload, download, removeFiles } from "../../../server/files.js";

const SESSION_DAYS = 30;

const TABLES = {
  clients: {
    name: "t", contact: "t", email: "t", phone: "t", instagram: "t", tiktok: "t", vat: "t", fee: "i",
    videos_per_month: "i", videos_total: "i", billing_day: "i", start_date: "d", end_date: "d", status: "t", notes: "t",
  },
  charges: {
    client_id: "i", period: "m", kind: "t", description: "t", amount: "i", due_date: "d", paid_at: "d", invoice_no: "t",
  },
  documents: { client_id: "i", name: "t", kind: "t", doc_date: "d", amount: "i" },
  videos: {
    platform: "t", url: "t", title: "t", published_on: "d", views: "i", reach: "i",
    likes: "i", comments: "i", shares: "i", saves: "i",
  },
};
const ORDER = {
  clients: "status = 'attivo' DESC, name COLLATE NOCASE",
  charges: "period DESC, due_date DESC, id DESC",
  videos: "published_on DESC, id DESC",
  documents: "doc_date IS NULL, doc_date DESC, uploaded_at DESC",
};
// Clients come with who can open their area: approved people and pending requests.
const SELECT = {
  clients: `SELECT id, name, contact, email, phone, instagram, tiktok, vat, fee, videos_per_month, videos_total, billing_day,
    start_date, end_date, status, notes, created_at, invite_token,
    (SELECT count(*) FROM client_users WHERE client_id = clients.id AND status = 'approvato') AS people,
    (SELECT count(*) FROM client_users WHERE client_id = clients.id AND status = 'in_attesa') AS pending FROM clients`,
  documents: "SELECT * FROM documents",
  charges: "SELECT * FROM charges",
  // The clients a video features, as a JSON array (see withClients).
  videos: "SELECT v.*, (SELECT json_group_array(client_id) FROM video_clients WHERE video_id = v.id) AS client_ids FROM videos v",
};
const withClients = (row) => (row && typeof row.client_ids === "string" ? { ...row, client_ids: JSON.parse(row.client_ids) } : row);
const FEATURES = "v.id IN (SELECT video_id FROM video_clients WHERE client_id = ?)";

// A video's clients come as `client_ids`: at least one, all existing.
async function linkClients(env, videoId, body, required) {
  if (!("client_ids" in (body ?? {}))) {
    if (required) throw new Invalid("Scegli almeno un cliente.");
    return;
  }
  const ids = [...new Set([].concat(body.client_ids ?? []).map(Number))];
  if (!ids.length || !ids.every(Number.isInteger)) throw new Invalid("Scegli almeno un cliente.");
  const db = env.CRM_DB;
  await db.batch([
    db.prepare("DELETE FROM video_clients WHERE video_id = ?").bind(videoId),
    ...ids.map((id) => db.prepare("INSERT INTO video_clients (video_id, client_id) VALUES (?, ?)").bind(videoId, id)),
  ]);
}

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
  if (client && table === "videos") { where.push(FEATURES); binds.push(Number(client)); }
  else if (client && TABLES[table].client_id) { where.push("client_id = ?"); binds.push(Number(client)); }
  const month = url.searchParams.get("month");
  if (month && isMonth(month) && table === "videos") { where.push("published_on LIKE ?"); binds.push(`${month}-%`); }
  const sql = `${SELECT[table]} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${ORDER[table]}`;
  const { results } = await env.CRM_DB.prepare(sql).bind(...binds).all();
  return json(results.map(withClients));
}

// Columns that are never empty: a cleared field means their default.
const DEFAULTS = {
  clients: { fee: 0, videos_per_month: 0, videos_total: 0, billing_day: 1, status: "attivo" },
  charges: { kind: "canone" },
  documents: { kind: "contratto" },
};
const typed = (table, body) => {
  const row = values(TABLES[table], body);
  for (const [key, fallback] of Object.entries(DEFAULTS[table] ?? {})) if (key in row && row[key] === null) row[key] = fallback;
  return row;
};

async function create(env, table, body) {
  const row = typed(table, body);
  const keys = Object.keys(row);
  if (!keys.length) throw new Invalid("Nessun dato.");
  if (table === "videos" && ![].concat(body.client_ids ?? []).length) throw new Invalid("Scegli almeno un cliente.");
  const { id } = await env.CRM_DB
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING id`)
    .bind(...Object.values(row)).first();
  if (table === "videos") {
    // No video without its clients: undo the insert if the links fail.
    await linkClients(env, id, body, true).catch(async (error) => {
      await env.CRM_DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
      throw error;
    });
    // A new video gets its numbers straight away when its platform is connected.
    await refresh(env, [await env.CRM_DB.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first()], { maxAgeMinutes: 0 });
  }
  return json(withClients(await env.CRM_DB.prepare(`${SELECT[table]} WHERE id = ?`).bind(id).first()), 201);
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
  if (table === "videos") await linkClients(env, id, body, false);
  const updated = await env.CRM_DB.prepare(`${SELECT[table]} WHERE id = ?`).bind(id).first();
  return updated ? json(withClients(updated)) : json({ error: "Non trovato." }, 404);
}

async function remove(env, table, id) {
  if (table === "clients") await removeFiles(env, "client_id", id);
  if (table === "documents") await removeFiles(env, "id", id);
  await env.CRM_DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// ---- people with access to the client area ------------------------------------

// Approving (or adding) someone emails them a sign-in link valid a week.
const welcome = async (env, origin, userId) => {
  const user = await env.CRM_DB.prepare(
    "SELECT u.*, c.name AS client_name FROM client_users u JOIN clients c ON c.id = u.client_id WHERE u.id = ?",
  ).bind(userId).first();
  await sendLinks(env, origin, [user], {
    minutes: 7 * 1440,
    intro: `il team RomeSoMuch ti ha dato accesso all'area clienti di ${user.client_name}: video, metriche, documenti e previsioni.`,
  });
};

async function people(request, env, url, id, action) {
  const db = env.CRM_DB;
  const method = request.method;
  const origin = url.origin;
  if (!id && method === "GET") {
    const client = Number(url.searchParams.get("client_id"));
    const { results } = await db.prepare(
      `SELECT * FROM client_users WHERE client_id = ? ORDER BY status = 'in_attesa' DESC, status = 'approvato' DESC, requested_at DESC`,
    ).bind(client).all();
    return json(results);
  }
  if (!id && method === "POST") {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new Invalid("Email non valida.");
    const { id: created } = await db.prepare(
      `INSERT INTO client_users (client_id, name, email, status, approved_at) VALUES (?, ?, ?, 'approvato', datetime('now'))
       ON CONFLICT(client_id, email) DO UPDATE SET status = 'approvato', approved_at = datetime('now'), name = coalesce(excluded.name, name)
       RETURNING id`,
    ).bind(Number(body.client_id), String(body.name ?? "").trim() || null, email).first();
    await welcome(env, origin, created);
    return json({ ok: true }, 201);
  }
  if (id && action === "approve" && method === "POST") {
    await db.prepare("UPDATE client_users SET status = 'approvato', approved_at = datetime('now') WHERE id = ?").bind(id).run();
    await welcome(env, origin, id);
    return json({ ok: true });
  }
  if (id && action === "reject" && method === "POST") {
    // Raising the version also ends any session the person already had.
    await db.prepare("UPDATE client_users SET status = 'rifiutato', session_version = session_version + 1 WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (id && !action && method === "DELETE") {
    await db.prepare("DELETE FROM client_users WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  return json({ error: "Non trovato." }, 404);
}

// A new private invite link for the client; the old one stops working.
async function newInvite(env, id) {
  const token = randomToken(12);
  await env.CRM_DB.prepare("UPDATE clients SET invite_token = ? WHERE id = ?").bind(token, id).run();
  return json({ invite_token: token });
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
  const [clients, unpaid, recent, trend, totals, requests] = await db.batch([
    db.prepare(
      `SELECT c.id, c.name, c.status, c.fee, c.videos_total, c.end_date, c.invite_token,
         (SELECT count(*) FROM client_users WHERE client_id = c.id AND status = 'approvato') AS people,
         (SELECT count(*) FROM video_clients WHERE client_id = c.id) AS videos_all,
         (SELECT count(*) FROM videos v JOIN video_clients l ON l.video_id = v.id
            WHERE l.client_id = c.id AND v.published_on LIKE ?1) AS videos,
         (SELECT coalesce(sum(views), 0) FROM videos v JOIN video_clients l ON l.video_id = v.id
            WHERE l.client_id = c.id AND v.published_on LIKE ?1) AS views,
         (SELECT coalesce(sum(likes), 0) + coalesce(sum(comments), 0) + coalesce(sum(shares), 0) + coalesce(sum(saves), 0)
            FROM videos v JOIN video_clients l ON l.video_id = v.id WHERE l.client_id = c.id AND v.published_on LIKE ?1) AS interactions,
         (SELECT max(v.published_on) FROM videos v JOIN video_clients l ON l.video_id = v.id WHERE l.client_id = c.id) AS last_video,
         (SELECT paid_at IS NOT NULL FROM charges WHERE client_id = c.id AND period = ?2 AND kind = 'canone') AS paid,
         (SELECT coalesce(sum(amount), 0) FROM charges WHERE client_id = c.id AND paid_at IS NULL) AS outstanding
       FROM clients c ORDER BY c.status = 'attivo' DESC, c.name COLLATE NOCASE`,
    ).bind(like, month),
    db.prepare("SELECT * FROM charges WHERE paid_at IS NULL ORDER BY due_date"),
    db.prepare(`${SELECT.videos} ORDER BY published_on DESC, id DESC LIMIT 8`),
    db.prepare(
      `SELECT substr(published_on, 1, 7) AS month, count(*) AS videos, coalesce(sum(views), 0) AS views
       FROM videos WHERE published_on >= ? GROUP BY month ORDER BY month`,
    ).bind(`${Number(now.slice(0, 4)) - 1}${now.slice(4, 7)}-01`),
    // The month across all clients, each video once even when it features several.
    db.prepare(
      `SELECT count(*) AS videos, coalesce(sum(views), 0) AS views,
         coalesce(sum(likes), 0) + coalesce(sum(comments), 0) + coalesce(sum(shares), 0) + coalesce(sum(saves), 0) AS interactions
       FROM videos WHERE published_on LIKE ?`,
    ).bind(like),
    db.prepare(
      `SELECT u.*, c.name AS client_name FROM client_users u JOIN clients c ON c.id = u.client_id
       WHERE u.status = 'in_attesa' ORDER BY u.requested_at`,
    ),
  ]);
  return json({
    today: now, month, clients: clients.results, unpaid: unpaid.results, recent: recent.results.map(withClients),
    totals: totals.results[0], requests: requests.results,
    // Last month's recaps not sent yet, for clients someone can receive them.
    reportsDue: (await db.prepare(
      `SELECT count(*) AS n FROM clients c WHERE c.status = 'attivo'
         AND EXISTS (SELECT 1 FROM client_users WHERE client_id = c.id AND status = 'approvato')
         AND NOT EXISTS (SELECT 1 FROM monthly_reports WHERE client_id = c.id AND period = ?)`,
    ).bind(addMonths(now.slice(0, 7), -1)).first()).n,
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
    const where = body.id ? "WHERE v.id = ?" : body.client_id ? `WHERE ${FEATURES}` : "";
    const statement = env.CRM_DB.prepare(`SELECT v.* FROM videos v ${where} ORDER BY v.metrics_at IS NOT NULL, v.metrics_at`);
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
  if (table === "files" && id && method === "GET") return download(env, id);
  if (table === "documents" && !id && method === "POST") return upload(env, request);
  if (table === "users") return people(request, env, url, id, action);
  // Monthly recaps: the list with a preview, then one send per client.
  if (table === "reports" && method === "GET") {
    const period = isMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : addMonths(today().slice(0, 7), -1);
    const list = await reportList(env, period);
    return json(list.map((r) => ({
      ...r, subject: reportSubject(r), preview: reportText(r, url.origin, r.people[0]?.name),
      whatsapp: reportText(r, url.origin, r.contact),
    })));
  }
  if (table === "reports" && method === "POST") {
    const body = await request.json();
    if (!isMonth(body.month)) throw new Invalid("Mese non valido.");
    return json(await sendReport(env, url.origin, Number(body.client_id), body.month));
  }
  if (table === "clients" && id && action === "invite" && method === "POST") return newInvite(env, id);
  // "Vedi come cliente": the client area, as this client sees it, for 2 hours.
  if (table === "clients" && id && action === "view" && method === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": setCookie(VIEW_COOKIE, await sign(env, "view", [id], 1 / 12), 1 / 12) },
    });
  }

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
