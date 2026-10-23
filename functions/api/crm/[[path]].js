// The staff CRM's API: /api/crm/*. One password (the CRM_PASSWORD secret)
// opens it; the pages under /crm are gated by functions/crm/_middleware.js.

import {
  Invalid, json, redirect, today, lastDayOf, isMonth, addMonths, values, guarded, sameOrigin,
  sign, verify, setCookie, same, throttled, failed, succeeded,
} from "../../../server/common.js";
import { randomToken, sendLinks, sendTeamLink, teamCookie, sha256 } from "../../../server/access.js";
import { reportList, reportText, reportSubject, sendReport } from "../../../server/reports.js";
import { STAFF_COOKIE, VIEW_COOKIE, staffSession } from "../../../server/sessions.js";
import { connections, refresh, tiktokAuthorizeUrl, tiktokExchange } from "../../../server/platforms.js";
import { upload, download, removeFiles } from "../../../server/files.js";

const SESSION_DAYS = 30;

const TABLES = {
  clients: {
    name: "t", contact: "t", email: "t", phone: "t", instagram: "t", tiktok: "t", vat: "t", fee: "i",
    videos_per_month: "i", videos_total: "i", billing_day: "i", start_date: "d", end_date: "d", status: "t", notes: "t",
    categories: "t", billing_every: "i",
  },
  charges: {
    client_id: "i", period: "m", kind: "t", description: "t", amount: "i", due_date: "d", paid_at: "d", invoice_no: "t",
  },
  documents: { client_id: "i", name: "t", kind: "t", doc_date: "d", amount: "i" },
  videos: {
    platform: "t", url: "t", title: "t", published_on: "d", views: "i", reach: "i",
    likes: "i", comments: "i", shares: "i", saves: "i",
  },
  promos: {
    venue: "t", title: "t", date: "d", price: "i", cost: "i", cost_to: "t", url: "t", paid_at: "d", notes: "t",
  },
  // Applications arrive from the site's /ugc/ form (functions/api/enquiry.js);
  // here the agency only judges them.
  ugc: { status: "t", rating: "i", notes: "t" },
};
const ORDER = {
  clients: "status = 'attivo' DESC, name COLLATE NOCASE",
  charges: "period DESC, due_date DESC, id DESC",
  videos: "published_on DESC, id DESC",
  documents: "doc_date IS NULL, doc_date DESC, uploaded_at DESC",
  promos: "date DESC, id DESC",
  ugc: "created_at DESC, id DESC",
};
// Clients come with who can open their area (approved people, pending
// requests) and how many of the month's videos are done.
const SELECT = {
  get clients() {
    return `SELECT id, name, contact, email, phone, instagram, tiktok, vat, fee, videos_per_month, videos_total, billing_day,
    start_date, end_date, status, categories, billing_every, notes, created_at, invite_token,
    (SELECT count(*) FROM client_users WHERE client_id = clients.id AND status = 'approvato') AS people,
    (SELECT count(*) FROM video_clients WHERE client_id = clients.id) AS videos_all,
    (SELECT count(*) FROM video_clients l JOIN videos v ON v.id = l.video_id
      WHERE l.client_id = clients.id AND v.published_on LIKE '${today().slice(0, 7)}-%') AS videos_month,
    (SELECT count(*) FROM client_users WHERE client_id = clients.id AND status = 'in_attesa') AS pending FROM clients`;
  },
  documents: "SELECT * FROM documents",
  charges: "SELECT * FROM charges",
  promos: "SELECT * FROM promos",
  ugc: "SELECT * FROM ugc",
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
  if (month && isMonth(month) && table === "promos") { where.push("date LIKE ?"); binds.push(`${month}-%`); }
  const sql = `${SELECT[table]} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${ORDER[table]}`;
  const { results } = await env.CRM_DB.prepare(sql).bind(...binds).all();
  return json(results.map(withClients));
}

// Columns that are never empty: a cleared field means their default.
const DEFAULTS = {
  clients: { fee: 0, videos_per_month: 6, videos_total: 0, billing_day: 1, billing_every: 6, status: "attivo" },
  charges: { kind: "canone" },
  documents: { kind: "contratto" },
  promos: { price: 0, cost: 0 },
  ugc: { status: "nuovo" },
};
// Where a UGC application stands (src/lib/crm/app.ts has their labels).
const UGC_STATUS = new Set(["nuovo", "contattato", "confermato", "completato", "scartato"]);
// The client categories the CRM knows (src/lib/crm/app.ts has their labels).
const CATEGORIES = new Set(["trattoria", "ristorante", "negozio", "street_food", "cafe"]);

const typed = (table, body) => {
  // Categories arrive as a list of keys and are kept as "key,key".
  if (table === "clients" && Array.isArray(body?.categories)) {
    body = { ...body, categories: body.categories.filter((k) => CATEGORIES.has(k)).join(",") };
  }
  const row = values(TABLES[table], body);
  // The page turns it into a link: only web addresses.
  if (table === "promos" && row.url && !/^https?:\/\/\S+$/i.test(row.url)) throw new Invalid("Link non valido (deve iniziare con https://).");
  if (table === "ugc" && row.status && !UGC_STATUS.has(row.status)) throw new Invalid("Stato non valido.");
  if (table === "ugc" && row.rating != null && !(row.rating >= 1 && row.rating <= 5)) throw new Invalid("Il voto va da 1 a 5.");
  for (const [key, fallback] of Object.entries(DEFAULTS[table] ?? {})) if (key in row && row[key] === null) row[key] = fallback;
  return row;
};

async function create(env, table, body) {
  const row = typed(table, body);
  const keys = Object.keys(row);
  if (!keys.length) throw new Invalid("Nessun dato.");
  if (table === "videos" && ![].concat(body.client_ids ?? []).length) throw new Invalid("Scegli almeno un cliente.");
  // Titles are the agency's own words, never taken from the platforms.
  if (table === "videos" && !row.title) throw new Invalid("Scrivi il titolo del video.");
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
  if (table === "videos" && "title" in row && !row.title) throw new Invalid("Scrivi il titolo del video.");
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

// One instalment per client whose billing cycle starts this month: monthly,
// every 3 or every 6 months, counted from the contract start (from January
// when there is none). The fee is the whole period's price: one instalment.
async function chargeMonth(env, period) {
  const [y, m] = period.split("-").map(Number);
  const { meta } = await env.CRM_DB.prepare(
    `INSERT OR IGNORE INTO charges (client_id, period, kind, description, amount, due_date)
     SELECT id, ?1, 'canone',
       CASE billing_every WHEN 3 THEN 'Visibilità costante · trimestre' WHEN 6 THEN 'Visibilità costante · semestre' ELSE 'Visibilità costante' END,
       fee, ?1 || '-' || printf('%02d', min(max(billing_day, 1), 28))
     FROM clients
     WHERE status = 'attivo' AND fee > 0
       AND (start_date IS NULL OR start_date <= ?2)
       AND (end_date IS NULL OR end_date >= ?1 || '-01')
       AND (?3 - coalesce(CAST(substr(start_date, 1, 4) AS INTEGER) * 12 + CAST(substr(start_date, 6, 2) AS INTEGER), 1)) % max(billing_every, 1) = 0`,
  ).bind(period, lastDayOf(period), y * 12 + m).run();
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
  const yearAgo = `${addMonths(month, -11)}-01`;
  const [clients, unpaid, recent, trend, totals, requests, promos, unpaidPromos, promoTrend, collected] = await db.batch([
    db.prepare(
      `SELECT c.id, c.name, c.status, c.categories, c.billing_every, c.fee, c.videos_per_month, c.videos_total, c.start_date, c.end_date, c.invite_token,
         (SELECT count(*) FROM client_users WHERE client_id = c.id AND status = 'approvato') AS people,
         (SELECT count(*) FROM video_clients WHERE client_id = c.id) AS videos_all,
         (SELECT count(*) FROM videos v JOIN video_clients l ON l.video_id = v.id
            WHERE l.client_id = c.id AND v.published_on LIKE ?1) AS videos,
         (SELECT coalesce(sum(views), 0) FROM videos v JOIN video_clients l ON l.video_id = v.id
            WHERE l.client_id = c.id AND v.published_on LIKE ?1) AS views,
         (SELECT coalesce(sum(likes), 0) + coalesce(sum(comments), 0) + coalesce(sum(shares), 0) + coalesce(sum(saves), 0)
            FROM videos v JOIN video_clients l ON l.video_id = v.id WHERE l.client_id = c.id AND v.published_on LIKE ?1) AS interactions,
         (SELECT max(v.published_on) FROM videos v JOIN video_clients l ON l.video_id = v.id WHERE l.client_id = c.id) AS last_video,
         (SELECT paid_at IS NOT NULL FROM charges WHERE client_id = c.id AND kind = 'canone' AND period <= ?2
            ORDER BY period DESC LIMIT 1) AS paid,
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
    db.prepare("SELECT count(*) AS n, coalesce(sum(price), 0) AS price, coalesce(sum(cost), 0) AS cost FROM promos WHERE date LIKE ?").bind(like),
    db.prepare("SELECT * FROM promos WHERE paid_at IS NULL AND price > 0 ORDER BY date"),
    // The general overview: promos month by month over the twelve months up
    // to the chosen one, and the cash that came in during the chosen month.
    db.prepare(
      `SELECT substr(date, 1, 7) AS month, count(*) AS n, coalesce(sum(price), 0) AS price, coalesce(sum(cost), 0) AS cost
       FROM promos WHERE date >= ? AND date <= ? GROUP BY month`,
    ).bind(yearAgo, lastDayOf(month)),
    db.prepare(
      `SELECT (SELECT coalesce(sum(amount), 0) FROM charges WHERE paid_at LIKE ?1) AS fees,
              (SELECT coalesce(sum(price), 0) FROM promos WHERE paid_at LIKE ?1) AS promos`,
    ).bind(like),
  ]);
  return json({
    today: now, month, clients: clients.results, unpaid: unpaid.results, recent: recent.results.map(withClients),
    totals: totals.results[0], requests: requests.results, promos: promos.results[0],
    unpaidPromos: unpaidPromos.results, promoTrend: promoTrend.results, collected: collected.results[0],
    // Last month's recaps not sent yet, for clients someone can receive them.
    reportsDue: (await db.prepare(
      `SELECT count(*) AS n FROM clients c WHERE c.status = 'attivo'
         AND EXISTS (SELECT 1 FROM client_users WHERE client_id = c.id AND status = 'approvato')
         AND NOT EXISTS (SELECT 1 FROM monthly_reports WHERE client_id = c.id AND period = ?)`,
    ).bind(addMonths(now.slice(0, 7), -1)).first()).n,
    trend: trend.results, connections: await connections(env),
  });
}

// ---- video titles ------------------------------------------------------------------

// Titles for one video: the CRM saves the request, the connector on the agents'
// server (romesomuch-agents/crm-bridge) hands it to the Video Ideas agent and
// writes the answer back through the bridge routes below.
const TITLE_STATUS = new Set(["in_attesa", "in_corso", "pronto", "errore"]);
const BRIEF_MAX = 3000;

async function titles(request, env, id, session) {
  const db = env.CRM_DB;
  if (!id && request.method === "GET") {
    return json((await db.prepare("SELECT * FROM title_requests ORDER BY id DESC LIMIT 50").all()).results);
  }
  if (!id && request.method === "POST") {
    const brief = String((await request.json()).brief ?? "").trim();
    if (brief.length < 20) throw new Invalid("Descrivi il video in qualche riga: il posto, cosa succede, i dettagli veri.");
    if (brief.length > BRIEF_MAX) throw new Invalid(`Massimo ${BRIEF_MAX} caratteri.`);
    const by = session.role === "team" ? session.name || session.email : "owner";
    return json(await db.prepare("INSERT INTO title_requests (brief, created_by) VALUES (?, ?) RETURNING *").bind(brief, by).first(), 201);
  }
  if (id && request.method === "DELETE") {
    await db.prepare("DELETE FROM title_requests WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  return json({ error: "Non trovato." }, 404);
}

// The connector's side, by its own key: open requests, then their progress.
async function bridge(request, env, path) {
  const db = env.CRM_DB;
  const id = Number(path[2]);
  if (path[1] !== "titles") return json({ error: "Non trovato." }, 404);
  if (!path[2] && request.method === "GET") {
    return json((await db.prepare("SELECT id, brief, status, issue FROM title_requests WHERE status IN ('in_attesa', 'in_corso') ORDER BY id").all()).results);
  }
  if (Number.isInteger(id) && request.method === "PATCH") {
    const body = await request.json();
    if (!TITLE_STATUS.has(body.status)) throw new Invalid("Stato non valido.");
    const done = body.status === "pronto" || body.status === "errore";
    await db.prepare(
      `UPDATE title_requests SET status = ?, issue = coalesce(?, issue), answer = coalesce(?, answer), error = ?,
         answered_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE answered_at END WHERE id = ?`,
    ).bind(body.status, body.issue ?? null, body.answer ? String(body.answer).slice(0, 20000) : null,
      body.error ? String(body.error).slice(0, 500) : null, done ? 1 : 0, id).run();
    return json({ ok: true });
  }
  return json({ error: "Non trovato." }, 404);
}

// ---- team ------------------------------------------------------------------------

// What a team member may do: look up clients (without money), handle videos,
// and ask for video titles when the owner allowed it on the Team page.
const TEAM_CAN = (method, path, member) => {
  const [table, id, action] = path;
  if (action) return false;
  if (table === "me") return method === "GET";
  if (table === "clients") return method === "GET" && !id;
  if (table === "videos") return ["GET", "POST", "PATCH", "DELETE"].includes(method);
  if (table === "titles") return Boolean(member.can_titles) && ["GET", "POST", "DELETE"].includes(method);
  return table === "refresh" && method === "POST";
};
// The client fields a team member sees: no fee, billing, VAT number, invite link or access.
const TEAM_CLIENT = ["id", "name", "categories", "contact", "email", "phone", "instagram", "tiktok", "videos_per_month", "videos_month", "videos_all",
  "start_date", "end_date", "status", "notes"];
const forTeam = (client) => Object.fromEntries(TEAM_CLIENT.map((k) => [k, client[k]]));

async function team(request, env, url, id) {
  const db = env.CRM_DB;
  if (!id && request.method === "GET") {
    return json((await db.prepare("SELECT id, name, email, can_titles, last_seen, created_at FROM team_members ORDER BY name COLLATE NOCASE").all()).results);
  }
  if (!id && request.method === "POST") {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new Invalid("Email non valida.");
    const member = await db.prepare(
      `INSERT INTO team_members (name, email) VALUES (?, ?)
       ON CONFLICT(email) DO UPDATE SET name = coalesce(excluded.name, name) RETURNING *`,
    ).bind(String(body.name ?? "").trim() || null, email).first();
    await sendTeamLink(env, url.origin, member, {
      minutes: 7 * 1440, intro: "ti abbiamo dato accesso al CRM RomeSoMuch: puoi vedere i clienti e inserire i video.",
    });
    return json({ ok: true }, 201);
  }
  if (id && request.method === "PATCH") {
    const { can_titles } = await request.json();
    await db.prepare("UPDATE team_members SET can_titles = ? WHERE id = ?").bind(can_titles ? 1 : 0, id).run();
    return json({ ok: true });
  }
  if (id && request.method === "DELETE") {
    await db.prepare("DELETE FROM team_members WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  return json({ error: "Non trovato." }, 404);
}

// The CRM sign-in page's "team" form: a link by email, same answer either way.
async function teamLogin(request, env) {
  if (await throttled(env, request)) return redirect("/crm/login/?e=troppi");
  await failed(env, request);
  const email = String((await request.formData()).get("email") ?? "").trim().toLowerCase();
  const member = email && await env.CRM_DB.prepare("SELECT * FROM team_members WHERE email = ?").bind(email).first();
  if (member) await sendTeamLink(env, new URL(request.url).origin, member);
  return redirect("/crm/login/?inviata=1");
}

async function teamEnter(env, url) {
  const token = url.searchParams.get("t") ?? "";
  const member = token && await env.CRM_DB.prepare(
    "SELECT m.* FROM team_links l JOIN team_members m ON m.id = l.member_id WHERE l.token_hash = ? AND l.expires_at > ?",
  ).bind(await sha256(token), Date.now()).first();
  if (!member) return redirect("/crm/login/?e=scaduto");
  await env.CRM_DB.prepare("UPDATE team_members SET last_seen = datetime('now') WHERE id = ?").bind(member.id).run();
  return redirect("/crm/#/video", { "Set-Cookie": await teamCookie(env, member) });
}

// ---- routing -------------------------------------------------------------------

async function api(request, env, path, session) {
  const url = new URL(request.url);
  const method = request.method;
  const [table, idText, action] = path;
  const id = idText ? Number(idText) : null;
  // Ids are numbers; TikTok's routes carry words (connect, callback).
  if (idText && !Number.isInteger(id) && table !== "tiktok") return json({ error: "Non trovato." }, 404);

  // Who is signed in; a team member's session renews on every visit.
  if (table === "me" && method === "GET") {
    if (session.role !== "team") return json({ role: "owner" });
    await env.CRM_DB.prepare("UPDATE team_members SET last_seen = datetime('now') WHERE id = ?").bind(session.id).run();
    return new Response(JSON.stringify({ role: "team", name: session.name, email: session.email, can_titles: Boolean(session.can_titles) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": await teamCookie(env, session) },
    });
  }
  if (table === "team") return team(request, env, url, id);
  if (table === "titles") return titles(request, env, id, session);
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
  if (!id && method === "GET") {
    // Pagamenti may be the first page opened in a new month.
    if (table === "charges") await chargeOnce(env, today().slice(0, 7));
    const listed = await list(env, table, url);
    if (session.role !== "team" || table !== "clients") return listed;
    return json((await listed.json()).map(forTeam));
  }
  if (!id && method === "POST") return create(env, table, await request.json());
  if (id && method === "PATCH") return update(env, table, id, await request.json());
  if (id && method === "DELETE") return remove(env, table, id);
  return json({ error: "Metodo non consentito." }, 405);
}

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path ?? []);
  // The title connector on the agents' server: no cookie, its own key, so the
  // same-origin check (against cross-site forms riding a session) does not apply.
  if (path[0] === "bridge") {
    if (!env.BRIDGE_KEY || !(await same(request.headers.get("X-Bridge-Key") ?? "", env.BRIDGE_KEY))) {
      return json({ error: "Accesso richiesto." }, 401);
    }
    return guarded(() => bridge(request, env, path));
  }
  if (!sameOrigin(request)) return json({ error: "Origine non consentita." }, 403);
  if (path[0] === "login" && request.method === "POST") return guarded(() => login(request, env));
  if (path[0] === "logout" && request.method === "POST") {
    return redirect("/crm/login/", { "Set-Cookie": setCookie(STAFF_COOKIE, "", 0) });
  }
  if (path[0] === "team-login" && request.method === "POST") return guarded(() => teamLogin(request, env));
  if (path[0] === "team-enter" && request.method === "GET") return guarded(() => teamEnter(env, new URL(request.url)));
  // The daily metrics refresh (workers/report-reminder's cron), by its own key.
  if (path[0] === "refresh" && path.length === 1 && request.method === "POST" && env.CRON_KEY
      && await same(request.headers.get("X-Cron-Key") ?? "", env.CRON_KEY)) {
    return guarded(() => api(request, env, path, { role: "owner" }));
  }
  const session = await staffSession(request, env);
  if (!session) {
    return path[0] === "tiktok" ? redirect("/crm/login/") : json({ error: "Accesso richiesto." }, 401);
  }
  // The team never reaches money, documents, reports, access or settings.
  if (session.role === "team" && !TEAM_CAN(request.method, path, session)) {
    return path[0] === "tiktok" ? redirect("/crm/#/video") : json({ error: "Non disponibile per il team." }, 403);
  }
  return guarded(() => api(request, env, path, session));
}
