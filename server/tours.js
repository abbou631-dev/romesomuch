// RomeSoMuch's own experiences, booked on the site: availability, the deposit
// paid with Stripe, the customer's emails, and what the CRM's Tour section
// does (edit, cancel with refund, settings). Schema: migrations/0018_tours.sql.
// The balance is paid on the day, outside this system.

import { Invalid, json, today, hmac, same } from "./common.js";
import { mail } from "./access.js";
import { SOURCES } from "./tour-sources.js";
import { guestEmail } from "./tour-emails.js";
import site from "../src/data/site.json";

const ROME = "Europe/Rome";
// A booking waiting for its payment keeps its seats this long.
const HOLD = "(status = 'confirmed' OR (status = 'pending' AND created_at > datetime('now', '-20 minutes')))";
const MONTHS_AHEAD = 12;
const notifyTo = (env) => env.CRM_NOTIFY ?? "romesomuch@gmail.com";
const replyTo = site.contactEmail;

// ---- time in Rome -------------------------------------------------------------

const romeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
// The instant a Rome wall-clock time happens (DST included).
export function romeInstant(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(romeParts.formatToParts(guess).map((x) => [x.type, x.value]));
    guess += wanted - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return guess;
}
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH = /^\d{4}-\d{2}$/;
const isDate = (s) => DATE.test(s ?? "") && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s);

// ---- formatting -----------------------------------------------------------------

const euro = (cents) => `€${(cents / 100).toFixed(2)}`;
const itDate = (date) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
const guestsText = (n) => `${n} ${n === 1 ? "guest" : "guests"}`;

// ---- tours ------------------------------------------------------------------------

const parseTour = (row) => row && { ...row, times: JSON.parse(row.times) };
const getTour = async (env, slug) =>
  parseTour(await env.CRM_DB.prepare("SELECT * FROM tours WHERE slug = ?").bind(String(slug ?? "")).first());

export const totalFor = (tour, guests) => (tour.unit === "group" ? tour.price_cents : tour.price_cents * guests);
export const depositFor = (tour, total) => Math.round((total * tour.deposit_pct) / 100);
// Seats a booking takes in its slot: guests, or one boat for a private group.
const need = (tour, guests) => (tour.unit === "group" ? 1 : guests);
const usedSql = (tour) => (tour.unit === "group" ? "count(*)" : "coalesce(sum(guests), 0)");

// What the site's booking box needs to know about an experience.
const publicTour = (t) => ({
  slug: t.slug, title: t.title, price: t.price_cents, unit: t.unit, depositPct: t.deposit_pct,
  maxGuests: t.max_guests, cancelHours: t.cancel_hours,
});

// Open start times of one month: { "2026-11-21": [{ time, left }] }. A day is
// listed only if it runs and still has a time that can be sold.
async function availability(env, tour, month) {
  const now = Date.now();
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [{ results: used }, { results: closed }] = await env.CRM_DB.batch([
    env.CRM_DB.prepare(`SELECT date, time, ${usedSql(tour)} AS n FROM tour_bookings WHERE slug = ? AND date LIKE ? AND ${HOLD} GROUP BY date, time`)
      .bind(tour.slug, `${month}-%`),
    env.CRM_DB.prepare("SELECT date FROM tour_closures WHERE slug = ? AND date LIKE ?").bind(tour.slug, `${month}-%`),
  ]);
  const taken = new Map(used.map((r) => [`${r.date} ${r.time}`, r.n]));
  const shut = new Set(closed.map((r) => r.date));
  const out = {};
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    if (shut.has(date) || !tour.weekdays.includes(String(weekday(date)))) continue;
    const times = tour.times
      .filter((time) => romeInstant(date, time) - tour.cutoff_hours * 3600e3 > now)
      .map((time) => ({ time, left: Math.max(0, tour.capacity - (taken.get(`${date} ${time}`) ?? 0)) }));
    if (times.length) out[date] = times;
  }
  return out;
}

// ---- Stripe -------------------------------------------------------------------------

// Stripe's API takes form fields; nested objects become key[sub]=value.
function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(env, method, path, params, idempotencyKey) {
  if (!env.STRIPE_SECRET_KEY) throw new Invalid("I pagamenti online non sono configurati (manca STRIPE_SECRET_KEY).");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: params ? form(params) : undefined,
  });
  const body = await response.json();
  if (!response.ok) {
    console.log("stripe error", path, response.status, JSON.stringify(body.error ?? body));
    throw new Invalid(`Stripe: ${body.error?.message ?? response.status}`);
  }
  return body;
}

// Stripe signs each webhook: header "t=<time>,v1=<hmac>", HMAC-SHA256 of
// "<time>.<raw body>" with the endpoint's secret.
async function signedEvent(env, request) {
  const raw = await request.text();
  const header = request.headers.get("Stripe-Signature") ?? "";
  const t = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...header.matchAll(/(?:^|,)v1=([0-9a-f]+)/g)].map((m) => m[1]);
  if (!t || !signatures.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  const expected = await hmac(env.STRIPE_WEBHOOK_SECRET, `${t}.${raw}`);
  for (const s of signatures) if (await same(s, expected)) return JSON.parse(raw);
  return null;
}

// ---- emails ---------------------------------------------------------------------------

// Guests get HTML with a text twin, from a bookings address so they can
// tell these from the site's other messages; replies reach the owner.
const FROM = "RomeSoMuch Bookings <bookings@romesomuch.com>";
export const sendEmail = (env, kind, b, origin, ...extra) =>
  mail(env, { to: b.email, from: FROM, replyTo, ...guestEmail(kind, b, ...extra) });

const notifyOwner = (env, b, origin) => mail(env, {
  to: notifyTo(env),
  subject: `Nuova prenotazione: ${b.title}, ${itDate(b.date)} ${b.time}`,
  replyTo: b.email,
  text: [
    `${b.name} ha prenotato ${b.title}.`,
    "",
    `Quando: ${itDate(b.date)}, ${b.time}`,
    `Ospiti: ${b.guests}`,
    `Email: ${b.email}`,
    `Telefono: ${b.phone ?? "—"} · WhatsApp: ${b.whatsapp === 1 ? `sì (https://wa.me/${String(b.phone ?? "").replace(/\D/g, "").replace(/^00/, "")})` : b.whatsapp === 0 ? "no" : "—"}`,
    ...(b.notes ? [`Note: ${b.notes}`] : []),
    `Ci ha conosciuti: ${SOURCES[b.source] ?? "—"}`,
    "",
    `Totale ${euro(b.total_cents)} · deposito incassato ${euro(b.paid_cents)} · saldo sul posto ${euro(b.total_cents - b.paid_cents)}`,
    `Codice ${b.code}`,
    "",
    `Gestionale: ${origin}/crm/tour/`,
  ].join("\n"),
});

// A booking with everything the emails print.
const BOOKING = `SELECT b.*, t.title, t.unit, t.meeting_point, t.cancel_hours, t.price_cents
  FROM tour_bookings b JOIN tours t ON t.slug = b.slug`;
const bookingBy = (env, column, value) => env.CRM_DB.prepare(`${BOOKING} WHERE b.${column} = ?`).bind(value).first();

// ---- the site: availability, hold, payment ------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => `RSM-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("")}`;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;


const publicOrder = (b) => ({
  code: b.code, title: b.title, date: b.date, time: b.time, guests: b.guests,
  total: b.total_cents, paid: b.paid_cents, balance: b.total_cents - b.paid_cents, status: b.status,
});

// Marks a paid booking confirmed and sends the emails, once: the browser and
// Stripe's webhook may both get here.
async function confirmPayment(env, origin, intentId) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(intentId ?? "")) throw new Invalid("Pagamento non valido.");
  const booking = await bookingBy(env, "payment_intent", intentId);
  if (!booking) throw new Invalid("Prenotazione non trovata.");
  if (booking.status !== "pending") return publicOrder(booking);
  const intent = await stripe(env, "GET", `payment_intents/${intentId}`);
  if (intent.status !== "succeeded") return { ...publicOrder(booking), payment: intent.status };
  const { meta } = await env.CRM_DB.prepare(
    "UPDATE tour_bookings SET status = 'confirmed', paid_cents = ?, confirmed_at = datetime('now') WHERE id = ? AND status = 'pending'",
  ).bind(intent.amount_received, booking.id).run();
  const done = { ...booking, status: "confirmed", paid_cents: intent.amount_received };
  if (meta.changes) await Promise.all([sendEmail(env, "confirmed", done, origin), notifyOwner(env, done, origin)]);
  return publicOrder(done);
}

async function hold(env, body) {
  const tour = await getTour(env, body.tour);
  if (!tour || !tour.active) throw new Invalid("tour_closed");
  const { date, time } = body;
  const guests = Number(body.guests);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const notes = String(body.notes ?? "").trim().slice(0, 1000) || null;
  const source = String(body.source ?? "");
  const whatsapp = { 1: 1, 0: 0 }[String(body.whatsapp)];
  if (whatsapp === undefined) throw new Invalid("missing_fields");
  if (!SOURCES[source]) throw new Invalid("missing_fields");
  if (name.length < 2 || !EMAIL.test(email) || phone.replace(/\D/g, "").length < 6) throw new Invalid("missing_fields");
  if (!Number.isInteger(guests) || guests < 1 || guests > tour.max_guests) throw new Invalid("guests");
  if (!isDate(date) || !TIME.test(time ?? "") || !tour.times.includes(time)) throw new Invalid("slot_closed");
  const open = await availability(env, tour, date.slice(0, 7));
  const slot = open[date]?.find((s) => s.time === time);
  if (!slot) throw new Invalid("slot_closed");
  if (slot.left < need(tour, guests)) throw new Invalid("slot_full");
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PUBLISHABLE_KEY) throw new Invalid("payments_off");

  const total = totalFor(tour, guests);
  const deposit = depositFor(tour, total);
  const code = newCode();
  // The seat check and the insert are one statement, so two people cannot
  // both take the last seats.
  const { meta } = await env.CRM_DB.prepare(
    `INSERT INTO tour_bookings (code, slug, date, time, guests, name, email, phone, whatsapp, notes, source, total_cents, deposit_cents)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT ${usedSql(tour)} FROM tour_bookings WHERE slug = ? AND date = ? AND time = ? AND ${HOLD}) + ? <= ?`,
  ).bind(code, tour.slug, date, time, guests, name, email, phone, whatsapp, notes, source, total, deposit,
    tour.slug, date, time, need(tour, guests), tour.capacity).run();
  if (!meta.changes) throw new Invalid("slot_full");

  try {
    const intent = await stripe(env, "POST", "payment_intents", {
      amount: deposit,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      receipt_email: email,
      description: `Deposit ${code} · ${tour.title} · ${date} ${time} · ${guestsText(guests)}`,
      metadata: { code, tour: tour.slug, date, time, guests },
    }, `hold-${code}`);
    await env.CRM_DB.prepare("UPDATE tour_bookings SET payment_intent = ? WHERE code = ?").bind(intent.id, code).run();
    return { code, clientSecret: intent.client_secret, pk: env.STRIPE_PUBLISHABLE_KEY, total, deposit, balance: total - deposit };
  } catch (error) {
    await env.CRM_DB.prepare("DELETE FROM tour_bookings WHERE code = ?").bind(code).run();
    throw error;
  }
}

// Day-before reminders, called once a day by workers/report-reminder.
export async function sendReminders(env, origin) {
  const tomorrow = addDays(today(), 1);
  const { results } = await env.CRM_DB.prepare(`${BOOKING} WHERE b.date = ? AND b.status = 'confirmed' AND b.reminded_at IS NULL`)
    .bind(tomorrow).all();
  let sent = 0;
  for (const b of results) {
    if (await sendEmail(env, "reminder", b, origin)) {
      await env.CRM_DB.prepare("UPDATE tour_bookings SET reminded_at = datetime('now') WHERE id = ?").bind(b.id).run();
      sent++;
    }
  }
  return { date: tomorrow, due: results.length, sent };
}

// /api/tours/*: what the site's booking box calls.
export async function siteApi(request, env, path) {
  const url = new URL(request.url);
  const [what] = path;
  if (what === "availability" && request.method === "GET") {
    const tour = await getTour(env, url.searchParams.get("tour"));
    if (!tour || !tour.active) return json({ error: "tour_closed" }, 404);
    const month = url.searchParams.get("month") ?? today().slice(0, 7);
    const first = today().slice(0, 7);
    const [y, m] = first.split("-").map(Number);
    const last = new Date(Date.UTC(y, m - 1 + MONTHS_AHEAD, 1)).toISOString().slice(0, 7);
    if (!MONTH.test(month) || month < first || month > last) return json({ tour: publicTour(tour), days: {} });
    return json({ tour: publicTour(tour), days: await availability(env, tour, month), last });
  }
  // Live prices for cards and pages (src/components/TourPrice.astro).
  if (what === "prices" && request.method === "GET") {
    const { results } = await env.CRM_DB.prepare("SELECT slug, price_cents, unit FROM tours WHERE active = 1").all();
    return Response.json(Object.fromEntries(results.map((t) => [t.slug, { price: t.price_cents, unit: t.unit }])), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
  if (what === "hold" && request.method === "POST") return json(await hold(env, await request.json()));
  if (what === "confirm" && request.method === "POST") {
    const { pi } = await request.json();
    return json(await confirmPayment(env, url.origin, pi));
  }
  return json({ error: "Non trovato." }, 404);
}

export async function webhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "webhook not configured" }, 503);
  const event = await signedEvent(env, request);
  if (!event) return json({ error: "bad signature" }, 400);
  if (event.type === "payment_intent.succeeded" && event.data?.object?.metadata?.code) {
    await confirmPayment(env, new URL(request.url).origin, event.data.object.id).catch((e) => console.log("webhook confirm", e?.message));
  }
  return json({ received: true });
}

// ---- the CRM: /api/crm/tours/* (owner only) ----------------------------------------------------

const TOUR_FIELDS = {
  title: "t", price_cents: "i", unit: "t", deposit_pct: "i", capacity: "i", max_guests: "i",
  weekdays: "t", cutoff_hours: "i", cancel_hours: "i", meeting_point: "t", active: "i",
};

function tourValues(body) {
  const out = {};
  for (const [key, type] of Object.entries(TOUR_FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (type === "i") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new Invalid(`${key}: numero non valido`);
      out[key] = n;
    } else out[key] = raw === null || raw === "" ? null : String(raw).trim().slice(0, 300);
  }
  if ("title" in out && !out.title) throw new Invalid("Il titolo è obbligatorio.");
  if ("unit" in out && !["person", "group"].includes(out.unit)) throw new Invalid("Unità non valida.");
  if ("deposit_pct" in out && (out.deposit_pct < 1 || out.deposit_pct > 100)) throw new Invalid("Il deposito va da 1 a 100%.");
  if ("price_cents" in out && out.price_cents < 100) throw new Invalid("Prezzo non valido.");
  for (const k of ["capacity", "max_guests"]) if (k in out && out[k] < 1) throw new Invalid(`${k}: almeno 1.`);
  if ("weekdays" in out) {
    out.weekdays = [...new Set(String(out.weekdays ?? "").replace(/\D/g, ""))].filter((d) => d <= "6").sort().join("");
    if (!out.weekdays) throw new Invalid("Scegli almeno un giorno.");
  }
  if ("times" in body) {
    const times = [...new Set([].concat(body.times ?? []).flatMap((t) => String(t).split(/[\s,;]+/)).filter(Boolean)
      .map((t) => t.replace(".", ":").replace(/^(\d):/, "0$1:")))].sort();
    if (!times.length || !times.every((t) => TIME.test(t))) throw new Invalid("Orari non validi: scrivili come 09:30, 14:00.");
    out.times = JSON.stringify(times);
  }
  return out;
}

async function listBookings(env, url) {
  const scope = url.searchParams.get("scope") ?? "upcoming";
  const where = [];
  const binds = [];
  const now = today();
  let order = "b.date, b.time";
  if (scope === "upcoming") { where.push("b.status = 'confirmed' AND b.date >= ?"); binds.push(now); }
  else if (scope === "past") { where.push("b.status = 'confirmed' AND b.date < ?"); binds.push(now); order = "b.date DESC, b.time DESC"; }
  else if (scope === "cancelled") { where.push("b.status = 'cancelled'"); order = "b.cancelled_at DESC"; }
  else throw new Invalid("Elenco non valido.");
  const slug = url.searchParams.get("slug");
  if (slug) { where.push("b.slug = ?"); binds.push(slug); }
  const q = url.searchParams.get("q")?.trim();
  if (q) { where.push("(b.name LIKE ? OR b.email LIKE ? OR b.code LIKE ? OR b.phone LIKE ?)"); binds.push(...Array(4).fill(`%${q}%`)); }
  const { results } = await env.CRM_DB.prepare(`${BOOKING} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`).bind(...binds).all();
  return results;
}

// The owner earns the deposits (the balance goes to the operator on the day),
// so money here is deposits that reached Stripe, net of refunds, counted when
// the booking was paid. Sales (count and full value) are the small print.
async function summary(env) {
  const now = today();
  const week = addDays(now, 7);
  const month = `${now.slice(0, 7)}-%`;
  const year = `${now.slice(0, 4)}-%`;
  const PAID = "status != 'pending' AND confirmed_at LIKE";
  const row = await env.CRM_DB.prepare(`SELECT
      (SELECT count(*) FROM tour_bookings WHERE status = 'confirmed' AND date = ?1) AS today_n,
      (SELECT coalesce(sum(guests), 0) FROM tour_bookings WHERE status = 'confirmed' AND date = ?1) AS today_guests,
      (SELECT count(*) FROM tour_bookings WHERE status = 'confirmed' AND date > ?1 AND date <= ?2) AS week_n,
      (SELECT coalesce(sum(guests), 0) FROM tour_bookings WHERE status = 'confirmed' AND date > ?1 AND date <= ?2) AS week_guests,
      (SELECT coalesce(sum(paid_cents - refunded_cents), 0) FROM tour_bookings WHERE status != 'pending' AND confirmed_at >= datetime('now', '-7 days')) AS deposits_week,
      (SELECT coalesce(sum(paid_cents - refunded_cents), 0) FROM tour_bookings WHERE ${PAID} ?3) AS deposits_month,
      (SELECT coalesce(sum(paid_cents - refunded_cents), 0) FROM tour_bookings WHERE ${PAID} ?4) AS deposits_year,
      (SELECT count(*) FROM tour_bookings WHERE status = 'confirmed' AND confirmed_at LIKE ?3) AS sold_month,
      (SELECT coalesce(sum(total_cents), 0) FROM tour_bookings WHERE status = 'confirmed' AND confirmed_at LIKE ?3) AS sold_month_value`)
    .bind(now, week, month, year).first();
  const [{ results: sources }, { results: byTour }] = await Promise.all([
    env.CRM_DB.prepare(`SELECT source, count(*) AS n FROM tour_bookings WHERE ${PAID} ? GROUP BY source ORDER BY n DESC`).bind(month).all(),
    env.CRM_DB.prepare(`SELECT slug, sum(status = 'confirmed') AS n, sum(paid_cents - refunded_cents) AS deposits
      FROM tour_bookings WHERE ${PAID} ? GROUP BY slug`).bind(month).all(),
  ]);
  return {
    ...row,
    sources: sources.map((r) => ({ label: SOURCES[r.source] ?? "Non indicato", n: r.n })),
    by_tour: Object.fromEntries(byTour.map((r) => [r.slug, { n: r.n, deposits: r.deposits }])),
  };
}

async function editBooking(env, origin, id, body) {
  const b = await bookingBy(env, "id", id);
  if (!b) throw new Invalid("Prenotazione non trovata.");
  const tour = await getTour(env, b.slug);
  const next = {
    date: body.date ?? b.date, time: body.time ?? b.time, guests: body.guests === undefined ? b.guests : Number(body.guests),
    name: String(body.name ?? b.name).trim(), email: String(body.email ?? b.email).trim(),
    phone: body.phone === undefined ? b.phone : String(body.phone).trim() || null,
    notes: body.notes === undefined ? b.notes : String(body.notes).trim() || null,
    whatsapp: body.whatsapp === undefined || body.whatsapp === "" ? b.whatsapp : Number(body.whatsapp) ? 1 : 0,
  };
  if (!isDate(next.date) || !TIME.test(next.time)) throw new Invalid("Data o orario non validi (orario come 09:30).");
  if (!Number.isInteger(next.guests) || next.guests < 1) throw new Invalid("Numero di ospiti non valido.");
  if (next.name.length < 2 || !EMAIL.test(next.email)) throw new Invalid("Nome o email non validi.");
  // Moving or growing a booking must fit the slot, not counting itself.
  if (b.status === "confirmed" && (next.date !== b.date || next.time !== b.time || next.guests !== b.guests)) {
    const { n } = await env.CRM_DB.prepare(`SELECT ${usedSql(tour)} AS n FROM tour_bookings WHERE slug = ? AND date = ? AND time = ? AND id != ? AND ${HOLD}`)
      .bind(b.slug, next.date, next.time, id).first();
    const left = tour.capacity - n;
    if (left < need(tour, next.guests)) throw new Invalid(`Non c'è posto in quello slot: ${Math.max(0, left)} ${tour.unit === "group" ? "barche" : "posti"} liberi.`);
  }
  // A change in guests reprices the booking unless a total was typed.
  let total = body.total_cents === undefined || body.total_cents === null ? b.total_cents : Number(body.total_cents);
  if (next.guests !== b.guests && Number(body.total_cents) === b.total_cents) total = totalFor(tour, next.guests);
  if (!Number.isInteger(total) || total < 0) throw new Invalid("Totale non valido.");
  await env.CRM_DB.prepare("UPDATE tour_bookings SET date = ?, time = ?, guests = ?, name = ?, email = ?, phone = ?, whatsapp = ?, notes = ?, total_cents = ? WHERE id = ?")
    .bind(next.date, next.time, next.guests, next.name, next.email, next.phone, next.whatsapp, next.notes, total, id).run();
  const updated = await bookingBy(env, "id", id);
  let emailed = false;
  if (body.notify && updated.status === "confirmed") emailed = await sendEmail(env, "updated", updated, origin);
  return { booking: updated, emailed };
}

async function cancelBooking(env, origin, id, body) {
  const b = await bookingBy(env, "id", id);
  if (!b) throw new Invalid("Prenotazione non trovata.");
  const refundable = b.paid_cents - b.refunded_cents;
  const refund = Number(body.refund_cents ?? 0);
  if (!Number.isInteger(refund) || refund < 0 || refund > refundable) {
    throw new Invalid(`Il rimborso va da 0 a ${euro(refundable)}.`);
  }
  if (refund > 0) {
    if (!b.payment_intent) throw new Invalid("Questa prenotazione non ha un pagamento Stripe da rimborsare.");
    await stripe(env, "POST", "refunds", {
      payment_intent: b.payment_intent, amount: refund, metadata: { code: b.code },
    }, `refund-${b.code}-${b.refunded_cents}-${refund}`);
  }
  await env.CRM_DB.prepare(
    "UPDATE tour_bookings SET status = 'cancelled', refunded_cents = refunded_cents + ?, cancelled_at = coalesce(cancelled_at, datetime('now')) WHERE id = ?",
  ).bind(refund, id).run();
  let emailed = false;
  if (body.notify) emailed = await sendEmail(env, "cancelled", { ...b, refunded_cents: b.refunded_cents + refund }, origin, refund);
  return { refunded: refund, emailed };
}

export async function crmApi(request, env, path) {
  const url = new URL(request.url);
  const method = request.method;
  const [, what, key, action, extra] = path;
  const db = env.CRM_DB;

  if (what === "summary" && method === "GET") return json(await summary(env));
  if (what === "bookings" && !key && method === "GET") return json(await listBookings(env, url));
  if (what === "bookings" && key) {
    const id = Number(key);
    if (!Number.isInteger(id)) return json({ error: "Non trovato." }, 404);
    if (!action && method === "PATCH") return json(await editBooking(env, url.origin, id, await request.json()));
    if (action === "cancel" && method === "POST") return json(await cancelBooking(env, url.origin, id, await request.json()));
    if (action === "resend" && method === "POST") {
      const b = await bookingBy(env, "id", id);
      if (!b || b.status !== "confirmed") throw new Invalid("Si può rimandare solo la conferma di una prenotazione attiva.");
      return json({ emailed: await sendEmail(env, "confirmed", b, url.origin) });
    }
  }
  if (what === "catalog" && !key && method === "GET") {
    const [{ results: tours }, { results: closures }] = await db.batch([
      db.prepare("SELECT * FROM tours ORDER BY title"),
      db.prepare("SELECT slug, date FROM tour_closures WHERE date >= ? ORDER BY date").bind(today()),
    ]);
    return json(tours.map((t) => ({ ...parseTour(t), closures: closures.filter((c) => c.slug === t.slug).map((c) => c.date) })));
  }
  if (what === "catalog" && key) {
    const tour = await getTour(env, key);
    if (!tour) return json({ error: "Non trovato." }, 404);
    if (!action && method === "PATCH") {
      const v = tourValues(await request.json());
      const keys = Object.keys(v);
      if (keys.length) {
        await db.prepare(`UPDATE tours SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE slug = ?`).bind(...keys.map((k) => v[k]), key).run();
      }
      return json(parseTour(await db.prepare("SELECT * FROM tours WHERE slug = ?").bind(key).first()));
    }
    if (action === "closures" && method === "POST") {
      const { date } = await request.json();
      if (!isDate(date)) throw new Invalid("Data non valida.");
      await db.prepare("INSERT OR IGNORE INTO tour_closures (slug, date) VALUES (?, ?)").bind(key, date).run();
      return json({ ok: true });
    }
    // What a guest of this experience receives, sent to the owner to check.
    if (action === "sample-email" && method === "POST") {
      const date = addDays(today(), 7);
      const total = totalFor(tour, 2);
      const sample = {
        code: "RSM-SAMPLE", slug: tour.slug, title: tour.title, date, time: tour.times[0], guests: 2,
        name: "RomeSoMuch", email: notifyTo(env), meeting_point: tour.meeting_point, cancel_hours: tour.cancel_hours,
        total_cents: total, paid_cents: depositFor(tour, total),
      };
      return json({ emailed: await sendEmail(env, "confirmed", sample, url.origin), to: sample.email });
    }
    if (action === "closures" && extra && method === "DELETE") {
      await db.prepare("DELETE FROM tour_closures WHERE slug = ? AND date = ?").bind(key, extra).run();
      return json({ ok: true });
    }
  }
  return json({ error: "Non trovato." }, 404);
}
