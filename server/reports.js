// The monthly recap email: each venue's numbers for a month, written for the
// people who follow it. The CRM shows a preview and sends only when the
// agency presses the button, one client per request.
import { addMonths } from "./common.js";
import { mail } from "./access.js";
import { platformViews, withFacebook } from "./crossposts.js";

const monthName = (period) =>
  new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

const SUMS = `count(*) AS videos, coalesce(sum(v.views), 0) AS views, coalesce(sum(v.reach), 0) AS reach,
  coalesce(sum(v.likes), 0) AS likes, coalesce(sum(v.comments), 0) AS comments,
  coalesce(sum(v.shares), 0) AS shares, coalesce(sum(v.saves), 0) AS saves,
  coalesce(sum(v.likes), 0) + coalesce(sum(v.comments), 0) + coalesce(sum(v.shares), 0) + coalesce(sum(v.saves), 0) AS interactions`;
const JOIN = "FROM videos v JOIN video_clients l ON l.video_id = v.id";
const EMPTY = { videos: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, interactions: 0 };

// Every active client's month (or just `onlyId`): numbers, the month before,
// recipients, sent or not. A fixed handful of queries, however many clients.
export async function reportList(env, period, onlyId) {
  const db = env.CRM_DB;
  const only = onlyId ? "AND l.client_id = ?" : "";
  const bind = (statement, ...values) => statement.bind(...values, ...(onlyId ? [onlyId] : []));
  const [clients, now, before, done, people, videos] = await db.batch([
    db.prepare(
      `SELECT c.id, c.name, c.contact, c.videos_total, c.end_date,
         (SELECT sent_at FROM monthly_reports WHERE client_id = c.id AND period = ?) AS sent_at
       FROM clients c WHERE c.status = 'attivo' ${onlyId ? "AND c.id = ?" : ""} ORDER BY c.name COLLATE NOCASE`,
    ).bind(period, ...(onlyId ? [onlyId] : [])),
    bind(db.prepare(`SELECT l.client_id, ${SUMS} ${JOIN} WHERE v.published_on LIKE ? ${only} GROUP BY l.client_id`), `${period}-%`),
    bind(db.prepare(`SELECT l.client_id, ${SUMS} ${JOIN} WHERE v.published_on LIKE ? ${only} GROUP BY l.client_id`), `${addMonths(period, -1)}-%`),
    bind(db.prepare(`SELECT l.client_id, count(*) AS videos ${JOIN} WHERE v.published_on < ? ${only} GROUP BY l.client_id`), `${addMonths(period, 1)}-01`),
    bind(db.prepare(`SELECT l.client_id, l.name, l.email FROM client_users l WHERE l.status = 'approvato' ${only}`)),
    bind(db.prepare(`SELECT l.client_id, v.platform, v.title, v.url, v.views, v.published_on ${JOIN} WHERE v.published_on LIKE ? ${only} ORDER BY v.published_on`), `${period}-%`),
  ]);
  const by = (rows) => new Map(rows.results.map((r) => [r.client_id, r]));
  const group = (rows) => rows.results.reduce((m, r) => m.set(r.client_id, [...(m.get(r.client_id) ?? []), r]), new Map());
  const [nowBy, beforeBy, doneBy, peopleBy, videosBy] = [by(now), by(before), by(done), group(people), group(videos)];
  return clients.results.map((c) => ({
    ...c, period, month: nowBy.get(c.id) ?? EMPTY, before: beforeBy.get(c.id) ?? EMPTY, done: doneBy.get(c.id)?.videos ?? 0,
    people: peopleBy.get(c.id) ?? [], videos: videosBy.get(c.id) ?? [],
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

// The client area's rule of thumb (src/lib/crm/portal.ts): ~1 customer every 5,000 views.
const VIEWS_PER_CUSTOMER = 5000;

// The monthly recap, in the agency's own style, after a short greeting to
// `name` (the person emailed, or the venue's contact for WhatsApp). No links
// to single videos: the client area has those.
export function reportText(r, origin, name) {
  const m = r.month;
  // Instagram with its Facebook copies, as Instagram shows it (crossposts.js).
  const views = platformViews(r.videos);
  const first = String(name ?? "").trim().split(" ")[0];
  const previous = monthName(addMonths(r.period, -1)).split(" ")[0];
  const change = r.before.views
    ? ` (${Math.round(((m.views - r.before.views) / r.before.views) * 100) >= 0 ? "+" : ""}${Math.round(((m.views - r.before.views) / r.before.views) * 100)}% rispetto a ${previous})`
    : "";
  const best = withFacebook(r.videos).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const lines = [
    first ? `Ciao ${first},` : "Ciao!",
    "",
    `ecco come sono andati i video di ${r.name} a ${monthName(r.period)}:`,
    "",
    `Video pubblicati: ${m.videos}${r.videos_total ? ` (${r.done} di ${r.videos_total} del pacchetto)` : ""}`,
    `Visualizzazioni tra le varie piattaforme: ${big(m.views)}${change}`,
    // Reach exists only where the platform reports it (not TikTok).
    ...(m.reach ? [`Account raggiunti: ${big(m.reach)}`] : []),
    `Mi piace: ${big(m.likes)}`,
    `Commenti: ${big(m.comments)}`,
    `Condivisioni: ${big(m.shares)}`,
    `Salvati: ${big(m.saves)}`,
    "----",
    // Only the platforms the month's videos were on.
    ...PLATFORMS.filter(([key]) => views.has(key)).map(([key, label]) => `Visualizzazioni ${label}: ${big(views.get(key))}`),
    "----",
    ...(best?.views ? [`Video più visto: ${best.title ? `"${best.title}"` : "uno dei video del mese"}, con ${big(best.views)} visualizzazioni`] : []),
    `Possibili nuovi clienti nel locale: circa ${big(Math.round(m.views / VIEWS_PER_CUSTOMER))} (stima: in media 1 ogni ${big(VIEWS_PER_CUSTOMER)} visualizzazioni)`,
    "",
    ...(r.end_date ? [`Il tuo pacchetto termina a ${monthName(r.end_date.slice(0, 7))}.`, ""] : []),
    `Metriche complete qui: ${origin}/area-clienti/`,
    "",
    "A presto,",
    "RomeSoMuch",
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
    if (await mail(env, { to: person.email, subject: reportSubject(r), text: reportText(r, origin, person.name) })) sent++;
  }
  if (sent) {
    await env.CRM_DB.prepare(
      `INSERT INTO monthly_reports (client_id, period, recipients) VALUES (?, ?, ?)
       ON CONFLICT(client_id, period) DO UPDATE SET sent_at = datetime('now'), recipients = excluded.recipients`,
    ).bind(clientId, period, r.people.map((p) => p.email).join(", ")).run();
  }
  return { sent, of: r.people.length };
}
