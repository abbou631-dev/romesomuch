// The monthly recap email: each venue's numbers for a month, written for the
// people who follow it. The CRM shows a preview and sends only when the
// agency presses the button, one client per request.
import { addMonths } from "./common.js";
import { mail } from "./access.js";

const monthName = (period) =>
  new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

const SUMS = `count(*) AS videos, coalesce(sum(v.views), 0) AS views, coalesce(sum(v.reach), 0) AS reach,
  coalesce(sum(v.shares), 0) AS shares, coalesce(sum(v.saves), 0) AS saves,
  coalesce(sum(v.likes), 0) + coalesce(sum(v.comments), 0) + coalesce(sum(v.shares), 0) + coalesce(sum(v.saves), 0) AS interactions`;
const JOIN = "FROM videos v JOIN video_clients l ON l.video_id = v.id";
const EMPTY = { videos: 0, views: 0, reach: 0, shares: 0, saves: 0, interactions: 0 };

// Every active client's month (or just `onlyId`): numbers, the month before,
// recipients, sent or not. A fixed handful of queries, however many clients.
export async function reportList(env, period, onlyId) {
  const db = env.CRM_DB;
  const only = onlyId ? "AND l.client_id = ?" : "";
  const bind = (statement, ...values) => statement.bind(...values, ...(onlyId ? [onlyId] : []));
  const [clients, now, before, done, people, videos, platforms] = await db.batch([
    db.prepare(
      `SELECT c.id, c.name, c.videos_total, c.end_date,
         (SELECT sent_at FROM monthly_reports WHERE client_id = c.id AND period = ?) AS sent_at
       FROM clients c WHERE c.status = 'attivo' ${onlyId ? "AND c.id = ?" : ""} ORDER BY c.name COLLATE NOCASE`,
    ).bind(period, ...(onlyId ? [onlyId] : [])),
    bind(db.prepare(`SELECT l.client_id, ${SUMS} ${JOIN} WHERE v.published_on LIKE ? ${only} GROUP BY l.client_id`), `${period}-%`),
    bind(db.prepare(`SELECT l.client_id, ${SUMS} ${JOIN} WHERE v.published_on LIKE ? ${only} GROUP BY l.client_id`), `${addMonths(period, -1)}-%`),
    bind(db.prepare(`SELECT l.client_id, count(*) AS videos ${JOIN} WHERE v.published_on < ? ${only} GROUP BY l.client_id`), `${addMonths(period, 1)}-01`),
    bind(db.prepare(`SELECT l.client_id, l.name, l.email FROM client_users l WHERE l.status = 'approvato' ${only}`)),
    bind(db.prepare(`SELECT l.client_id, v.title, v.url, v.views, v.published_on ${JOIN} WHERE v.published_on LIKE ? ${only} ORDER BY v.published_on`), `${period}-%`),
    bind(db.prepare(`SELECT l.client_id, v.platform, coalesce(sum(v.views), 0) AS views ${JOIN} WHERE v.published_on LIKE ? ${only} GROUP BY l.client_id, v.platform`), `${period}-%`),
  ]);
  const by = (rows) => new Map(rows.results.map((r) => [r.client_id, r]));
  const group = (rows) => rows.results.reduce((m, r) => m.set(r.client_id, [...(m.get(r.client_id) ?? []), r]), new Map());
  const [nowBy, beforeBy, doneBy, peopleBy, videosBy, platformsBy] = [by(now), by(before), by(done), group(people), group(videos), group(platforms)];
  return clients.results.map((c) => ({
    ...c, period, month: nowBy.get(c.id) ?? EMPTY, before: beforeBy.get(c.id) ?? EMPTY, done: doneBy.get(c.id)?.videos ?? 0,
    people: peopleBy.get(c.id) ?? [], videos: videosBy.get(c.id) ?? [], platforms: platformsBy.get(c.id) ?? [],
  }));
}

// "777.7mila", "1.2 milioni": the way the agency writes numbers in chat.
const big = (n) => {
  const one = (x) => x.toFixed(1).replace(/\.0$/, "");
  if (n >= 1e6) return `${one(n / 1e6)} milioni`;
  if (n >= 1e3) return `${one(n / 1e3)}mila`;
  return String(n);
};
const PLATFORMS = [["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"]];

// The monthly recap, in the agency's own format; the same text goes by email
// and is copied for WhatsApp.
export function reportText(r, origin) {
  const m = r.month;
  const views = new Map(r.platforms.map((p) => [p.platform, p.views]));
  const lines = [
    `REPORT ${monthName(r.period).split(" ")[0].toUpperCase()} - ${r.name.toUpperCase()}`,
    `Visualizzazioni tra le varie piattaforme: ${big(m.views)}`,
    `Condivisioni: ${big(m.shares)}`,
    `Salvati: ${big(m.saves)}`,
    "----",
    // Only the platforms the month's videos were on.
    ...PLATFORMS.filter(([key]) => views.has(key)).map(([key, label]) => `Visualizzazioni ${label}: ${big(views.get(key))}`),
    "",
    `Metriche complete qui: ${origin}/area-clienti/`,
  ];
  return lines.join("\n");
}

export const reportSubject = (r) => `RomeSoMuch · i risultati di ${monthName(r.period)} per ${r.name}`;

// Sends one client's report to each approved person and records it.
export async function sendReport(env, origin, clientId, period) {
  const [r] = await reportList(env, period, clientId);
  if (!r) return { sent: 0, error: "Cliente non attivo." };
  if (!r.people.length) return { sent: 0, error: "Nessuna persona con accesso." };
  let sent = 0;
  for (const person of r.people) {
    if (await mail(env, { to: person.email, subject: reportSubject(r), text: reportText(r, origin) })) sent++;
  }
  if (sent) {
    await env.CRM_DB.prepare(
      `INSERT INTO monthly_reports (client_id, period, recipients) VALUES (?, ?, ?)
       ON CONFLICT(client_id, period) DO UPDATE SET sent_at = datetime('now'), recipients = excluded.recipients`,
    ).bind(clientId, period, r.people.map((p) => p.email).join(", ")).run();
  }
  return { sent, of: r.people.length };
}
