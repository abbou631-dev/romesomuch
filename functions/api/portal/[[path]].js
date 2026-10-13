// The client area's API: /api/portal/*. Each client signs in with the email
// and password set for them in the CRM and only ever sees the videos that
// feature them. Clients can change their password, or reset it by email.

import {
  json, redirect, today, addMonths, isMonth, guarded, sameOrigin, sign, setCookie,
  throttled, failed, succeeded, checkPassword, hashPassword, Invalid,
} from "../../../server/common.js";
import { CLIENT_COOKIE, VIEW_COOKIE, signedInClient } from "../../../server/sessions.js";
import { refresh } from "../../../server/platforms.js";
import { download } from "../../../server/files.js";

const SESSION_DAYS = 60;
const RESET_MINUTES = 60;
const FEATURES = "id IN (SELECT video_id FROM video_clients WHERE client_id = ?)";

const sessionCookie = async (env, client) =>
  setCookie(CLIENT_COOKIE, await sign(env, "client", [client.id, client.password.slice(-12)], SESSION_DAYS), SESSION_DAYS);

const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const checkNew = (password, again) => {
  if (password.length < 8) throw new Invalid("La password deve avere almeno 8 caratteri.");
  if (again !== undefined && password !== again) throw new Invalid("Le due password non coincidono.");
};
// What a client sees of a video; never the internal error text or ids.
const VIDEO = "id, platform, url, title, published_on, thumbnail, views, reach, likes, comments, shares, saves, metrics_at";

async function login(request, env) {
  if (await throttled(env, request)) return redirect("/area-clienti/login/?e=troppi");
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const client = email && await env.CRM_DB.prepare("SELECT id, password, status FROM clients WHERE email = ?").bind(email).first();
  if (!client?.password || client.status === "concluso" || !(await checkPassword(password, client.password))) {
    await failed(env, request);
    return redirect(`/area-clienti/login/?e=${env.CRM_PASSWORD ? "password" : "config"}`);
  }
  await succeeded(env, request);
  return redirect("/area-clienti/", { "Set-Cookie": await sessionCookie(env, client) });
}

// "Password dimenticata": a one-hour link by email. The answer is the same
// whether or not the address exists, so the form reveals nobody's email;
// every request counts toward the per-address throttle.
async function forgot(request, env) {
  const sent = redirect("/area-clienti/login/?inviata=1");
  if (await throttled(env, request)) return redirect("/area-clienti/password-dimenticata/?e=troppi");
  await failed(env, request);
  const email = String((await request.formData()).get("email") ?? "").trim();
  const client = email && await env.CRM_DB.prepare("SELECT id, name, email, status, password FROM clients WHERE email = ?").bind(email).first();
  if (!client?.password || client.status === "concluso") return sent;
  if (!env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY is not set: reset link not sent");
    return sent;
  }
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const db = env.CRM_DB;
  await db.batch([
    db.prepare("DELETE FROM password_resets WHERE client_id = ? OR expires_at < ?").bind(client.id, Date.now()),
    db.prepare("INSERT INTO password_resets (token_hash, client_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), client.id, Date.now() + RESET_MINUTES * 60e3),
  ]);
  const link = `${new URL(request.url).origin}/area-clienti/nuova-password/?t=${token}`;
  const mail = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.ENQUIRY_FROM ?? "RomeSoMuch <forms@romesomuch.com>",
      to: [client.email],
      subject: "RomeSoMuch · nuova password per l'area clienti",
      text: `Ciao ${client.name},\n\nper scegliere una nuova password dell'area clienti RomeSoMuch apri questo link entro un'ora:\n${link}\n\nSe non l'hai chiesto tu, ignora questa email: la password attuale resta valida.\n\nRomeSoMuch`,
    }),
  });
  if (!mail.ok) console.log("resend rejected the reset email", mail.status, await mail.text());
  return sent;
}

// The page behind the emailed link posts the new password with the token.
async function reset(request, env) {
  const form = await request.formData();
  const token = String(form.get("t") ?? "");
  const back = (code) => redirect(`/area-clienti/nuova-password/?t=${encodeURIComponent(token)}&e=${code}`);
  const row = token && await env.CRM_DB.prepare("SELECT client_id FROM password_resets WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), Date.now()).first();
  if (!row) return redirect("/area-clienti/password-dimenticata/?e=scaduto");
  const password = String(form.get("password") ?? "");
  try {
    checkNew(password, String(form.get("again") ?? ""));
  } catch (error) {
    return back(/coincidono/.test(error.message) ? "diverse" : "corta");
  }
  const hash = await hashPassword(password);
  const db = env.CRM_DB;
  await db.batch([
    db.prepare("UPDATE clients SET password = ? WHERE id = ?").bind(hash, row.client_id),
    db.prepare("DELETE FROM password_resets WHERE client_id = ?").bind(row.client_id),
  ]);
  return redirect("/area-clienti/", { "Set-Cookie": await sessionCookie(env, { id: row.client_id, password: hash }) });
}

// Signed in: current password, then the new one.
async function changePassword(request, env, client) {
  if (client.preview) throw new Invalid("In anteprima non puoi cambiare la password del cliente.");
  const { current, password } = await request.json();
  const stored = (await env.CRM_DB.prepare("SELECT password FROM clients WHERE id = ?").bind(client.id).first())?.password;
  if (!(await checkPassword(String(current ?? ""), stored))) throw new Invalid("La password attuale non è corretta.");
  checkNew(String(password ?? ""));
  const hash = await hashPassword(String(password));
  await env.CRM_DB.prepare("UPDATE clients SET password = ? WHERE id = ?").bind(hash, client.id).run();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": await sessionCookie(env, { id: client.id, password: hash }) },
  });
}

// Month by month since the package started (at most the last 12 months).
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
  const totals = await env.CRM_DB.prepare(
    `SELECT count(*) AS videos, coalesce(sum(views), 0) AS views FROM videos WHERE ${FEATURES}`,
  ).bind(client.id).first();
  return json({ client, today: today(), months, totals });
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
  const [action] = [].concat(params.path ?? []);
  if (action === "login" && request.method === "POST") return guarded(() => login(request, env));
  if (action === "forgot" && request.method === "POST") return guarded(() => forgot(request, env));
  if (action === "reset" && request.method === "POST") return guarded(() => reset(request, env));
  if (action === "logout" && request.method === "POST") {
    // The agency leaving a preview goes back to the CRM, still signed in there.
    if ((await signedInClient(request, env))?.preview) {
      return redirect("/crm/#/clienti", { "Set-Cookie": setCookie(VIEW_COOKIE, "", 0) });
    }
    return redirect("/area-clienti/login/", { "Set-Cookie": setCookie(CLIENT_COOKIE, "", 0) });
  }
  const client = await signedInClient(request, env);
  if (!client) return json({ error: "Accesso richiesto." }, 401);
  const url = new URL(request.url);
  if (action === "overview" && request.method === "GET") return guarded(() => overview(env, client));
  if (action === "documents" && request.method === "GET") {
    return guarded(async () => json((await env.CRM_DB.prepare(
      `SELECT id, name, kind, doc_date, amount, file_name, mime, size, uploaded_at FROM documents
       WHERE client_id = ? ORDER BY doc_date IS NULL, doc_date DESC, uploaded_at DESC`,
    ).bind(client.id).all()).results));
  }
  // Only the signed-in client's own files.
  const fileId = Number([].concat(params.path ?? [])[1]);
  if (action === "files" && Number.isInteger(fileId) && request.method === "GET") return guarded(() => download(env, fileId, client.id));
  if (action === "password" && request.method === "POST") return guarded(() => changePassword(request, env, client));
  if (action === "videos" && request.method === "GET") {
    const month = isMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : today().slice(0, 7);
    return guarded(() => videos(env, client, month, { waitUntil }));
  }
  return json({ error: "Non trovato." }, 404);
}
