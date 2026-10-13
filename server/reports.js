// The monthly recap email: each venue's numbers for a month, written for the
// people who follow it. The CRM shows a preview and sends only when the
// agency presses the button, one client per request.
import { addMonths } from "./common.js";
import { mail } from "./access.js";

// The client area's rule of thumb (src/lib/crm/portal.ts): ~1 customer every 5,000 views.
const VIEWS_PER_CUSTOMER = 5000;
const count = new Intl.NumberFormat("it-IT");
const monthName = (period) =>
  new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
const dayName = (date) =>
  new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

const SUMS = `count(*) AS videos, coalesce(sum(v.views), 0) AS views, coalesce(sum(v.reach), 0) AS reach,
  coalesce(sum(v.likes), 0) + coalesce(sum(v.comments), 0) + coalesce(sum(v.shares), 0) + coalesce(sum(v.saves), 0) AS interactions`;
const JOIN = "FROM videos v JOIN video_clients l ON l.video_id = v.id";
const EMPTY = { videos: 0, views: 0, reach: 0, interactions: 0 };

// Every active client's month (or just `onlyId`): numbers, the month before,
// recipients, sent or not. A fixed handful of queries, however many clients.
export async function reportList(env, period, onlyId) {
  const db = env.CRM_DB;
  const only = onlyId ? "AND l.client_id = ?" : "";
  const bind = (statement, ...values) => statement.bind(...values, ...(onlyId ? [onlyId] : []));
  const [clients, now, before, done, people, videos] = await db.batch([
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
  ]);
  const by = (rows) => new Map(rows.results.map((r) => [r.client_id, r]));
  const group = (rows) => rows.results.reduce((m, r) => m.set(r.client_id, [...(m.get(r.client_id) ?? []), r]), new Map());
  const [nowBy, beforeBy, doneBy, peopleBy, videosBy] = [by(now), by(before), by(done), group(people), group(videos)];
  return clients.results.map((c) => ({
    ...c, period, month: nowBy.get(c.id) ?? EMPTY, before: beforeBy.get(c.id) ?? EMPTY, done: doneBy.get(c.id)?.videos ?? 0,
    people: peopleBy.get(c.id) ?? [], videos: videosBy.get(c.id) ?? [],
  }));
}

const change = (now, before) => {
  if (!before) return "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct ? ` (${pct > 0 ? "+" : ""}${pct}% sul mese prima)` : " (come il mese prima)";
};

// The email text for one person of one client. With `whatsapp`, the same
// recap for a chat: no name in the greeting, headings in *bold*.
export function reportText(r, person, origin, { whatsapp = false } = {}) {
  const m = r.month;
  const bold = (text) => (whatsapp ? `*${text}*` : text);
  const lines = [
    whatsapp ? "Ciao!" : `Ciao${person?.name ? ` ${person.name.split(" ")[0]}` : ""},`,
    "",
    bold(`Ecco come sono andati i video di ${r.name} a ${monthName(r.period)}:`),
    "",
    `• Video pubblicati: ${m.videos}`,
    `• Visualizzazioni: ${count.format(m.views)}${change(m.views, r.before.views)}`,
    `• Account raggiunti: ${count.format(m.reach)}`,
    `• Interazioni (mi piace, commenti, condivisioni, salvataggi): ${count.format(m.interactions)}`,
    `• Possibili nuovi clienti: circa ${count.format(Math.round(m.views / VIEWS_PER_CUSTOMER))} (stima: in media 1 ogni ${count.format(VIEWS_PER_CUSTOMER)} visualizzazioni)`,
  ];
  if (r.videos.length) {
    lines.push("", bold("I video del mese:"));
    for (const v of r.videos) lines.push(`– ${v.title || "Video"} · ${count.format(v.views ?? 0)} visualizzazioni · ${v.url}`);
  }
  const pack = [r.videos_total ? `${r.done} di ${r.videos_total} video pubblicati` : "", r.end_date ? `contratto fino al ${dayName(r.end_date)}` : ""]
    .filter(Boolean).join(" · ");
  if (pack) lines.push("", `Il tuo pacchetto: ${pack}.`);
  lines.push("", `Trovi tutti i dettagli, i documenti e le previsioni nella tua area clienti: ${origin}/area-clienti/`, "", "A presto,", "RomeSoMuch");
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
    if (await mail(env, { to: person.email, subject: reportSubject(r), text: reportText(r, person, origin) })) sent++;
  }
  if (sent) {
    await env.CRM_DB.prepare(
      `INSERT INTO monthly_reports (client_id, period, recipients) VALUES (?, ?, ?)
       ON CONFLICT(client_id, period) DO UPDATE SET sent_at = datetime('now'), recipients = excluded.recipients`,
    ).bind(clientId, period, r.people.map((p) => p.email).join(", ")).run();
  }
  return { sent, of: r.people.length };
}
