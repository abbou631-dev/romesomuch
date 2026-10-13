// The client area's API: /api/portal/*. Each client signs in with the email
// and password set for them in the CRM and only ever sees their own videos.

import {
  json, redirect, today, addMonths, isMonth, guarded, sameOrigin, sign, setCookie,
  throttled, failed, succeeded, checkPassword,
} from "../../../server/common.js";
import { CLIENT_COOKIE, signedInClient } from "../../../server/sessions.js";
import { refresh } from "../../../server/platforms.js";

const SESSION_DAYS = 60;
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
  const value = await sign(env, "client", [client.id, client.password.slice(-12)], SESSION_DAYS);
  return redirect("/area-clienti/", { "Set-Cookie": setCookie(CLIENT_COOKIE, value, SESSION_DAYS) });
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
     FROM videos WHERE client_id = ? AND published_on >= ? GROUP BY month`,
  ).bind(client.id, `${from}-01`).all();
  const byMonth = new Map(results.map((r) => [r.month, r]));
  const months = [];
  for (let m = from; m <= now; m = addMonths(m, 1)) {
    months.push(byMonth.get(m) ?? { month: m, videos: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
  }
  const totals = await env.CRM_DB.prepare(
    "SELECT count(*) AS videos, coalesce(sum(views), 0) AS views FROM videos WHERE client_id = ?",
  ).bind(client.id).first();
  return json({ client, today: today(), months, totals });
}

// The month's videos, with fresh numbers for any read more than 15 minutes ago.
async function videos(env, client, month, ctx) {
  const statement = env.CRM_DB.prepare(`SELECT * FROM videos WHERE client_id = ? AND published_on LIKE ? ORDER BY published_on DESC, id DESC`)
    .bind(client.id, `${month}-%`);
  const { results } = await statement.all();
  // Fresh numbers first when there are few to read; otherwise answer at once
  // and read them in the background for the next view.
  const reading = refresh(env, results, { maxAgeMinutes: 15 });
  if (results.length <= 6) await reading; else ctx.waitUntil(reading);
  const { results: rows } = await env.CRM_DB.prepare(`SELECT ${VIDEO} FROM videos WHERE client_id = ? AND published_on LIKE ? ORDER BY published_on DESC, id DESC`)
    .bind(client.id, `${month}-%`).all();
  return json(rows);
}

export async function onRequest({ request, env, params, waitUntil }) {
  if (!sameOrigin(request)) return json({ error: "Origine non consentita." }, 403);
  const [action] = [].concat(params.path ?? []);
  if (action === "login" && request.method === "POST") return guarded(() => login(request, env));
  if (action === "logout" && request.method === "POST") {
    return redirect("/area-clienti/login/", { "Set-Cookie": setCookie(CLIENT_COOKIE, "", 0) });
  }
  const client = await signedInClient(request, env);
  if (!client) return json({ error: "Accesso richiesto." }, 401);
  const url = new URL(request.url);
  if (action === "overview" && request.method === "GET") return guarded(() => overview(env, client));
  if (action === "videos" && request.method === "GET") {
    const month = isMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : today().slice(0, 7);
    return guarded(() => videos(env, client, month, { waitUntil }));
  }
  return json({ error: "Non trovato." }, 404);
}
