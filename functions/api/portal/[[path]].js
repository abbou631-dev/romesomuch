// The client area's API: /api/portal/*. No passwords: a person opens the
// venue's private invite link, asks for access with name and email, the
// agency approves once in the CRM, and from then on they sign in with a link
// emailed to them. The session lasts ~400 days and renews on every visit.
// Each person only ever sees the videos and documents of their own venue.

import { json, redirect, today, addMonths, isMonth, guarded, sameOrigin, setCookie, throttled, failed } from "../../../server/common.js";
import { CLIENT_COOKIE, VIEW_COOKIE, signedInClient } from "../../../server/sessions.js";
import { sendLinks, sessionCookie, sha256, mail } from "../../../server/access.js";
import { refresh } from "../../../server/platforms.js";
import { download } from "../../../server/files.js";

// Where the agency hears about new access requests.
const notifyTo = (env) => env.CRM_NOTIFY ?? "romesomuch@gmail.com";
// What a client sees of a video; never internal errors or the other venues.
const VIDEO = "id, platform, url, title, published_on, thumbnail, views, reach, likes, comments, shares, saves, metrics_at";
const FEATURES = "id IN (SELECT video_id FROM video_clients WHERE client_id = ?)";
const looksLikeEmail = (value) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);

const inviteFor = (env, token) => token
  ? env.CRM_DB.prepare("SELECT id, name FROM clients WHERE invite_token = ? AND status != 'concluso'").bind(token).first()
  : null;

// "Chiedi accesso" from the invite page. An approved email gets its sign-in
// link straight away; a new one waits for the agency.
async function requestAccess(request, env) {
  const form = await request.formData();
  const token = String(form.get("t") ?? "");
  const back = (code) => redirect(`/area-clienti/invito/?t=${encodeURIComponent(token)}&r=${code}`);
  if (await throttled(env, request)) return back("troppi");
  await failed(env, request);
  const client = await inviteFor(env, token);
  if (!client) return back("link");
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const venue = String(form.get("venue") ?? "").trim().slice(0, 160);
  if (!name || !venue || !looksLikeEmail(email)) return back("dati");

  const db = env.CRM_DB;
  const existing = await db.prepare("SELECT * FROM client_users WHERE client_id = ? AND email = ?").bind(client.id, email).first();
  const origin = new URL(request.url).origin;
  if (existing?.status === "approvato") {
    await sendLinks(env, origin, [{ ...existing, client_name: client.name }]);
    return back("approvato");
  }
  // A refused person sees the same answer as a new one, and is not re-queued.
  if (existing?.status === "rifiutato") return back("inviata");
  if (!existing) {
    await db.prepare("INSERT INTO client_users (client_id, name, email, venue) VALUES (?, ?, ?, ?)").bind(client.id, name, email, venue).run();
  }
  await mail(env, {
    to: notifyTo(env),
    subject: `Richiesta d'accesso: ${name} per ${client.name}`,
    text: `${name} (${email}) chiede di entrare nell'area clienti di ${client.name}.\nLocale indicato: ${venue}\n\nApprova o rifiuta dal CRM: ${origin}/crm/#/cliente/${client.id}`,
  });
  return back("inviata");
}

// The sign-in page: one email, a link for each venue it is approved for.
// Same answer whether or not the email is known.
async function loginLink(request, env) {
  if (await throttled(env, request)) return redirect("/area-clienti/login/?e=troppi");
  await failed(env, request);
  const email = String((await request.formData()).get("email") ?? "").trim().toLowerCase();
  if (looksLikeEmail(email)) {
    const { results } = await env.CRM_DB.prepare(
      `SELECT u.*, c.name AS client_name FROM client_users u JOIN clients c ON c.id = u.client_id
       WHERE u.email = ? AND u.status = 'approvato' AND c.status != 'concluso'`,
    ).bind(email).all();
    await sendLinks(env, new URL(request.url).origin, results);
  }
  return redirect("/area-clienti/login/?inviata=1");
}

// The emailed link. It works for its whole validity (not once only), since
// mail scanners often open links before the person does.
async function enter(env, url) {
  const token = url.searchParams.get("t") ?? "";
  const user = token && await env.CRM_DB.prepare(
    `SELECT u.* FROM login_links l JOIN client_users u ON u.id = l.user_id JOIN clients c ON c.id = u.client_id
     WHERE l.token_hash = ? AND l.expires_at > ? AND u.status = 'approvato' AND c.status != 'concluso'`,
  ).bind(await sha256(token), Date.now()).first();
  if (!user) return redirect("/area-clienti/login/?e=scaduto");
  await env.CRM_DB.prepare("UPDATE client_users SET last_seen = datetime('now') WHERE id = ?").bind(user.id).run();
  return redirect("/area-clienti/", { "Set-Cookie": await sessionCookie(env, user) });
}

// Month by month since the package started (at most the last 12 months).
// Also renews the person's session, so regular visitors never sign in again.
async function overview(env, client) {
  const now = today().slice(0, 7);
  const first = client.start_date?.slice(0, 7);
  const from = first && first > addMonths(now, -11) ? first : addMonths(now, -11);
  const { results } = await env.CRM_DB.prepare(
    `SELECT substr(published_on, 1, 7) AS month, count(*) AS videos,
       coalesce(sum(views), 0) AS views, coalesce(sum(reach), 0) AS reach, coalesce(sum(likes), 0) AS likes,
       coalesce(sum(comments), 0) AS comments, coalesce(sum(shares), 0) AS shares, coalesce(sum(saves), 0) AS saves
     FROM videos WHERE ${FEATURES} AND published_on >= ? GROUP BY month`,
  ).bind(client.id, `${from}-01`).all();
  const byMonth = new Map(results.map((r) => [r.month, r]));
  const months = [];
  for (let m = from; m <= now; m = addMonths(m, 1)) {
    months.push(byMonth.get(m) ?? { month: m, videos: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
  }
  const totals = await env.CRM_DB.prepare(`SELECT count(*) AS videos, coalesce(sum(views), 0) AS views FROM videos WHERE ${FEATURES}`)
    .bind(client.id).first();
  const headers = { "Cache-Control": "no-store" };
  if (client.user_id) {
    await env.CRM_DB.prepare("UPDATE client_users SET last_seen = datetime('now') WHERE id = ?").bind(client.user_id).run();
    headers["Set-Cookie"] = await sessionCookie(env, { id: client.user_id, session_version: client.session_version });
  }
  const { session_version, user_status, ...visible } = client;
  return Response.json({ client: visible, today: today(), months, totals }, { headers });
}

// The month's videos, with fresh numbers for any read more than 15 minutes ago.
async function videos(env, client, month, ctx) {
  const { results } = await env.CRM_DB.prepare(`SELECT * FROM videos WHERE ${FEATURES} AND published_on LIKE ?`)
    .bind(client.id, `${month}-%`).all();
  // Fresh numbers first when there are few to read; otherwise answer at once
  // and read them in the background for the next view.
  const reading = refresh(env, results, { maxAgeMinutes: 15 });
  if (results.length <= 6) await reading; else ctx.waitUntil(reading);
  const { results: rows } = await env.CRM_DB.prepare(`SELECT ${VIDEO} FROM videos WHERE ${FEATURES} AND published_on LIKE ? ORDER BY published_on DESC, id DESC`)
    .bind(client.id, `${month}-%`).all();
  return json(rows);
}

export async function onRequest({ request, env, params, waitUntil }) {
  if (!sameOrigin(request)) return json({ error: "Origine non consentita." }, 403);
  const url = new URL(request.url);
  const [action, idText] = [].concat(params.path ?? []);
  const method = request.method;

  if (action === "invite" && method === "GET") {
    return guarded(async () => {
      const client = await inviteFor(env, url.searchParams.get("t"));
      return client ? json({ name: client.name }) : json({ error: "Link non valido." }, 404);
    });
  }
  if (action === "request" && method === "POST") return guarded(() => requestAccess(request, env));
  if (action === "login" && method === "POST") return guarded(() => loginLink(request, env));
  if (action === "enter" && method === "GET") return guarded(() => enter(env, url));
  if (action === "logout" && method === "POST") {
    // The agency leaving a preview goes back to the CRM, still signed in there.
    if ((await signedInClient(request, env))?.preview) {
      return redirect("/crm/#/clienti", { "Set-Cookie": setCookie(VIEW_COOKIE, "", 0) });
    }
    return redirect("/area-clienti/login/", { "Set-Cookie": setCookie(CLIENT_COOKIE, "", 0) });
  }

  const client = await signedInClient(request, env);
  if (!client) return json({ error: "Accesso richiesto." }, 401);
  if (action === "overview" && method === "GET") return guarded(() => overview(env, client));
  if (action === "videos" && method === "GET") {
    const month = isMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : today().slice(0, 7);
    return guarded(() => videos(env, client, month, { waitUntil }));
  }
  if (action === "documents" && method === "GET") {
    return guarded(async () => json((await env.CRM_DB.prepare(
      `SELECT id, name, kind, doc_date, amount, file_name, mime, size, uploaded_at FROM documents
       WHERE client_id = ? ORDER BY doc_date IS NULL, doc_date DESC, uploaded_at DESC`,
    ).bind(client.id).all()).results));
  }
  // Only the venue's own files.
  if (action === "files" && Number.isInteger(Number(idText)) && method === "GET") return guarded(() => download(env, Number(idText), client.id));
  return json({ error: "Non trovato." }, 404);
}
