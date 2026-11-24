// RomeSoMuch's own experiences, booked on the site: availability, the deposit
// paid with Stripe, the customer's emails, and what the CRM's Tour section
// does (edit, cancel with refund, settings). Schema: migrations/0018_tours.sql.
// The balance is paid on the day, outside this system.

import { Invalid, json, today, hmac, same } from "./common.js";
import { mail } from "./access.js";
import { SOURCES } from "./tour-sources.js";
import { guestEmail, EMAIL_KINDS, ticketUrl } from "./tour-emails.js";
import { ticketHtml } from "./tour-ticket.js";
import { cancelPolicy } from "./tour-policy.js";
import site from "../src/data/site.json";

const ROME = "Europe/Rome";
// Seats are taken by confirmed bookings, by requests waiting for the owner
// (card authorised), and by a booking waiting for its payment for 20 minutes.
const HOLD = "(status IN ('confirmed', 'requested') OR (status = 'pending' AND created_at > datetime('now', '-20 minutes')))";
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

const parseTour = (row) => row && {
  ...row, times: JSON.parse(row.times), price_tiers: row.price_tiers ? JSON.parse(row.price_tiers) : null, extras: parseExtras(row.extras),
};
// Optional extras ([{ name, price_cents }]), flat per booking: offered on a
// tour, and the ones chosen on a booking.
export const parseExtras = (raw) => (raw ? JSON.parse(raw) : []);
const extrasCents = (list) => list.reduce((sum, x) => sum + x.price_cents, 0);
const getTour = async (env, slug) =>
  parseTour(await env.CRM_DB.prepare("SELECT * FROM tours WHERE slug = ?").bind(String(slug ?? "")).first());

// A private group priced by size (price_tiers) pays the price for its number
// of guests; otherwise the price is per person, or flat per group (a boat).
export const totalFor = (tour, guests) =>
  tour.price_tiers ? tour.price_tiers[guests] ?? tour.price_cents
    : tour.unit === "group" ? tour.price_cents : tour.price_cents * guests;
export const depositFor = (tour, total) => Math.round((total * tour.deposit_pct) / 100);
// No fixed start times: the guest writes, in their own words, when they would
// like to start ("morning, around 10"); tour_bookings.time keeps that text
// until the owner replaces it with the agreed time. The day is the slot
// (capacity counts per day).
const freeTime = (tour) => tour.times.length === 0;
// The bookings that share a slot with one at `time`: same time, or same day.
// The guest's own words for the start time: 2 to 80 characters.
const timeNote = (s) => typeof s === "string" && s.trim().length >= 2 && s.length <= 80;
const slotSql = (tour) => (freeTime(tour) ? "" : "AND time = ?");
const slotBind = (tour, time) => (freeTime(tour) ? [] : [time]);
// Seats a booking takes in its slot: guests, or one boat for a private group.
const need = (tour, guests) => (tour.unit === "group" ? 1 : guests);
const usedSql = (tour) => (tour.unit === "group" ? "count(*)" : "coalesce(sum(guests), 0)");

// What the site's booking box needs to know about an experience.
const publicTour = (t) => ({
  slug: t.slug, title: t.title, price: t.price_cents, unit: t.unit, depositPct: t.deposit_pct,
  maxGuests: t.max_guests, cancelHours: t.cancel_hours, freeTime: freeTime(t), policy: cancelPolicy(t), tiers: t.price_tiers, verify: Boolean(t.verify),
  extras: t.extras.map((x) => ({ name: x.name, price: x.price_cents })),
});
// Most guests the "from" price covers (2 for €485 when one and two pay the same).
const fromGuests = (t) => (t.price_tiers
  ? Math.max(...Object.entries(t.price_tiers).filter(([, c]) => c === t.price_cents).map(([n]) => Number(n)), 1)
  : null);

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
    if (freeTime(tour)) {
      // One slot for the day; the guest's own time is checked on booking.
      const n = used.filter((r) => r.date === date).reduce((a, r) => a + r.n, 0);
      if (romeInstant(date, "23:59") - tour.cutoff_hours * 3600e3 > now) out[date] = [{ time: "", left: Math.max(0, tour.capacity - n) }];
      continue;
    }
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

// The tour operator who runs the experience, if set, gets the same email.
const notifyOwner = (env, b, origin) => mail(env, {
  to: [notifyTo(env), b.operator_email].filter(Boolean),
  subject: b.status === "requested"
    ? `Richiesta da accettare: ${b.title}, ${itDate(b.date)} ${b.time}`
    : `Nuova prenotazione: ${b.title}, ${itDate(b.date)} ${b.time}`,
  replyTo: b.email,
  text: [
    b.status === "requested"
      ? `${b.name} chiede ${b.title}. La carta è autorizzata per ${euro(b.total_cents)} ma non ancora addebitata: verifica la disponibilità e accetta o rifiuta dal gestionale entro 7 giorni (poi Stripe libera l'autorizzazione).`
      : `${b.name} ha prenotato ${b.title}.`,
    "",
    `Quando: ${itDate(b.date)}, ${b.time}`,
    `Ospiti: ${b.guests}`,
    `Email: ${b.email}`,
    `Telefono: ${b.phone ?? "—"} · WhatsApp: ${b.whatsapp === 1 ? `sì (https://wa.me/${String(b.phone ?? "").replace(/\D/g, "").replace(/^00/, "")})` : b.whatsapp === 0 ? "no" : "—"}`,
    ...(b.participants ? ["Partecipanti:", b.participants] : []),
    ...(b.extras ? [`Extra: ${parseExtras(b.extras).map((x) => `${x.name} (${euro(x.price_cents)})`).join(", ")}`] : []),
    ...(b.notes ? [`Note: ${b.notes}`] : []),
    `Ci ha conosciuti: ${SOURCES[b.source] ?? "—"}`,
    "",
    ...(b.promo_code ? [`Codice sconto: ${b.promo_code} (−${euro(b.discount_cents)})`] : []),
    b.status === "requested"
      ? `Totale ${euro(b.total_cents)} · autorizzato sulla carta, da incassare quando accetti`
      : `Totale ${euro(b.total_cents)} · incassato online ${euro(b.paid_cents)} · saldo sul posto ${euro(b.total_cents - b.paid_cents)}`,
    `Codice ${b.code}`,
    "",
    `Gestionale: ${origin}/crm/tour/`,
  ].join("\n"),
});

// A booking with everything the emails print.
const BOOKING = `SELECT b.*, t.title, t.unit, t.meeting_point, t.cancel_hours, t.partial_refund_pct, t.partial_refund_hours, t.price_cents, t.verify, t.operator_email
  FROM tour_bookings b JOIN tours t ON t.slug = b.slug`;
export const bookingBy = (env, column, value) => env.CRM_DB.prepare(`${BOOKING} WHERE b.${column} = ?`).bind(value).first();

// ---- the site: availability, hold, payment ------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newCode = () => `RSM-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("")}`;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;


const publicOrder = (b) => ({
  code: b.code, title: b.title, date: b.date, time: b.time, guests: b.guests,
  total: b.total_cents, paid: b.paid_cents, balance: b.total_cents - b.paid_cents, status: b.status,
});

// Marks a paid booking confirmed and sends the emails, once: the browser and
// Stripe's webhook may both get here. On a tour the owner verifies, an
// authorised card makes the booking a request instead.
async function confirmPayment(env, origin, intentId) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(intentId ?? "")) throw new Invalid("Pagamento non valido.");
  const booking = await bookingBy(env, "payment_intent", intentId);
  if (!booking) throw new Invalid("Prenotazione non trovata.");
  if (booking.status !== "pending") return publicOrder(booking);
  const intent = await stripe(env, "GET", `payment_intents/${intentId}`);
  if (booking.verify && intent.status === "requires_capture") {
    const { meta } = await env.CRM_DB.prepare("UPDATE tour_bookings SET status = 'requested' WHERE id = ? AND status = 'pending'").bind(booking.id).run();
    const asked = { ...booking, status: "requested" };
    if (meta.changes) await Promise.all([sendEmail(env, "requested", asked, origin), notifyOwner(env, asked, origin)]);
    return publicOrder(asked);
  }
  if (intent.status !== "succeeded") return { ...publicOrder(booking), payment: intent.status };
  const { meta } = await env.CRM_DB.prepare(
    "UPDATE tour_bookings SET status = 'confirmed', paid_cents = ?, confirmed_at = datetime('now') WHERE id = ? AND status = 'pending'",
  ).bind(intent.amount_received, booking.id).run();
  const done = { ...booking, status: "confirmed", paid_cents: intent.amount_received };
  if (meta.changes) await Promise.all([sendEmail(env, "confirmed", done, origin), notifyOwner(env, done, origin)]);
  return publicOrder(done);
}

// ---- promo codes --------------------------------------------------------------------

const PROMO = /^[A-Z0-9-]{3,30}$/;
const promoCode = (raw) => String(raw ?? "").trim().toUpperCase();
// Bookings that count as a use: paid ones, and ones waiting for their payment.
const promoUses = `(SELECT count(*) FROM tour_bookings u WHERE u.promo_code = p.code
  AND (u.status IN ('confirmed', 'requested') OR (u.status = 'pending' AND u.created_at > datetime('now', '-20 minutes'))))`;

// The code if it works for this experience today, null when none was typed.
async function promoFor(env, raw, tour) {
  const code = promoCode(raw);
  if (!code) return null;
  const p = await env.CRM_DB.prepare(`SELECT p.*, ${promoUses} AS used FROM tour_promos p WHERE p.code = ?`).bind(code).first();
  if (!p || !p.active || (p.slug && p.slug !== tour.slug) || (p.expires_on && p.expires_on < today())
    || (p.max_uses != null && p.used >= p.max_uses)) throw new Invalid("promo_invalid");
  return p;
}
const discountFor = (p, total) => (p ? Math.min(total, p.percent ? Math.round((total * p.percent) / 100) : p.amount_cents) : 0);
const publicPromo = (p) => ({ code: p.code, percent: p.percent, amount: p.amount_cents });

async function hold(env, body) {
  const tour = await getTour(env, body.tour);
  if (!tour || !tour.active) throw new Invalid("tour_closed");
  const { date } = body;
  // On a tour without fixed times this is the guest's own words.
  const time = freeTime(tour) ? String(body.time ?? "").trim().replace(/\s+/g, " ").slice(0, 80) : body.time;
  const guests = Number(body.guests);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const notes = String(body.notes ?? "").trim().slice(0, 1000) || null;
  const participants = String(body.participants ?? "").trim().slice(0, 2000) || null;
  if (tour.verify && (participants ?? "").length < 5) throw new Invalid("missing_fields");
  const source = String(body.source ?? "");
  const whatsapp = { 1: 1, 0: 0 }[String(body.whatsapp)];
  if (whatsapp === undefined) throw new Invalid("missing_fields");
  if (!SOURCES[source]) throw new Invalid("missing_fields");
  if (name.length < 2 || !EMAIL.test(email) || phone.replace(/\D/g, "").length < 6) throw new Invalid("missing_fields");
  if (!Number.isInteger(guests) || guests < 1 || guests > tour.max_guests) throw new Invalid("guests");
  if (!isDate(date)) throw new Invalid("slot_closed");
  if (freeTime(tour)) {
    if (!timeNote(time)) throw new Invalid("missing_fields");
  } else {
    if (!TIME.test(time ?? "") || !tour.times.includes(time)) throw new Invalid("slot_closed");
    if (romeInstant(date, time) - tour.cutoff_hours * 3600e3 <= Date.now()) throw new Invalid("slot_closed");
  }
  const open = await availability(env, tour, date.slice(0, 7));
  const slot = open[date]?.find((s) => freeTime(tour) || s.time === time);
  if (!slot) throw new Invalid("slot_closed");
  if (slot.left < need(tour, guests)) throw new Invalid("slot_full");
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PUBLISHABLE_KEY) throw new Invalid("payments_off");
  const chosen = [...new Set([].concat(body.extras ?? []).map(String))];
  const extras = tour.extras.filter((x) => chosen.includes(x.name));
  if (extras.length !== chosen.length) throw new Invalid("extras");

  const promo = await promoFor(env, body.promo, tour);
  const full = totalFor(tour, guests) + extrasCents(extras);
  const discount = discountFor(promo, full);
  const total = full - discount;
  const deposit = depositFor(tour, total);
  // Stripe's smallest card payment.
  if (deposit < 50) throw new Invalid("promo_too_big");
  const code = newCode();
  // The seat check and the insert are one statement, so two people cannot
  // both take the last seats.
  const { meta } = await env.CRM_DB.prepare(
    `INSERT INTO tour_bookings (code, slug, date, time, guests, name, email, phone, whatsapp, notes, participants, source, total_cents, deposit_cents, promo_code, discount_cents, ticket_token, extras)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT ${usedSql(tour)} FROM tour_bookings WHERE slug = ? AND date = ? ${slotSql(tour)} AND ${HOLD}) + ? <= ?
       AND (SELECT count(*) FROM tour_bookings WHERE promo_code = ? AND ${HOLD}) < ?`,
  ).bind(code, tour.slug, date, time, guests, name, email, phone, whatsapp, notes, participants, source, total, deposit, promo?.code ?? null, discount, newToken(), extras.length ? JSON.stringify(extras) : null,
    tour.slug, date, ...slotBind(tour, time), need(tour, guests), tour.capacity, promo?.code ?? null, promo?.max_uses ?? 1e9).run();
  if (!meta.changes) throw new Invalid("slot_full");

  try {
    const intent = await stripe(env, "POST", "payment_intents", {
      amount: deposit,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      // Verified tours only authorise the card; the CRM charges it on accept.
      ...(tour.verify ? { capture_method: "manual" } : {}),
      receipt_email: email,
      description: `${deposit === total ? "Payment" : "Deposit"} ${code} · ${tour.title} · ${date} ${time} · ${guestsText(guests)}${extras.map((x) => ` + ${x.name}`).join("")}${promo ? ` · code ${promo.code}` : ""}`,
      metadata: { code, tour: tour.slug, date, time, guests, ...(promo ? { promo: promo.code } : {}) },
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
    const { results } = await env.CRM_DB.prepare("SELECT slug, price_cents, unit, price_tiers, times FROM tours WHERE active = 1").all();
    return Response.json(Object.fromEntries(results.map(parseTour).map((t) => [t.slug, { price: t.price_cents, unit: t.unit, for: fromGuests(t) }])), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
  // A promo code typed in the booking box, checked before the guest pays.
  if (what === "promo" && request.method === "GET") {
    const tour = await getTour(env, url.searchParams.get("tour"));
    if (!tour || !tour.active) return json({ error: "tour_closed" }, 404);
    const promo = await promoFor(env, url.searchParams.get("code"), tour);
    if (!promo) return json({ error: "promo_invalid" }, 404);
    return json(publicPromo(promo));
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
  // amount_capturable_updated: a verified tour's card was authorised.
  if (["payment_intent.succeeded", "payment_intent.amount_capturable_updated"].includes(event.type) && event.data?.object?.metadata?.code) {
    await confirmPayment(env, new URL(request.url).origin, event.data.object.id).catch((e) => console.log("webhook confirm", e?.message));
  }
  return json({ received: true });
}

// ---- the CRM: /api/crm/tours/* (owner only) ----------------------------------------------------

const TOUR_FIELDS = {
  title: "t", price_cents: "i", unit: "t", deposit_pct: "i", capacity: "i", max_guests: "i",
  weekdays: "t", cutoff_hours: "i", cancel_hours: "i", meeting_point: "t", active: "i", verify: "i",
  partial_refund_pct: "i", partial_refund_hours: "i", operator_email: "t",
};

// "Classic Italian Gourmet Basket = 50", one per line (euros, as typed in the
// CRM), to [{ name, price_cents }]. Empty means no extras.
function extrasValue(raw) {
  const list = [];
  for (const line of String(raw ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) {
    const m = line.match(/^(.{2,80}?)\s*[=:]\s*€?\s*(\d+(?:[.,]\d{1,2})?)$/);
    if (!m) throw new Invalid(`Extra: «${line}» non è nel formato Nome = 50.`);
    list.push({ name: m[1].trim(), price_cents: Math.round(Number(m[2].replace(",", ".")) * 100) });
  }
  if (new Set(list.map((x) => x.name)).size !== list.length) throw new Invalid("Extra: due extra hanno lo stesso nome.");
  return list.length ? JSON.stringify(list) : null;
}

// "2=485, 3=540" (euros, as typed in the CRM) to {"2": 48500, "3": 54000}.
// Empty means no tiers. Every size from 1 to the largest must have a price.
function tiersValue(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const tiers = {};
  for (const part of text.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[=:]\s*€?\s*(\d+(?:[.,]\d{1,2})?)$/);
    if (!m) throw new Invalid(`Prezzi per persone: «${part}» non è nel formato 2=485.`);
    tiers[Number(m[1])] = Math.round(Number(m[2].replace(",", ".")) * 100);
  }
  const top = Math.max(...Object.keys(tiers).map(Number));
  for (let n = 1; n <= top; n++) if (!tiers[n]) throw new Invalid(`Prezzi per persone: manca il prezzo per ${n}.`);
  return JSON.stringify(tiers);
}

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
  if (out.operator_email && !EMAIL.test(out.operator_email)) throw new Invalid("Email dell'operatore non valida.");
  if ("title" in out && !out.title) throw new Invalid("Il titolo è obbligatorio.");
  if ("unit" in out && !["person", "group"].includes(out.unit)) throw new Invalid("Unità non valida.");
  if ("deposit_pct" in out && (out.deposit_pct < 1 || out.deposit_pct > 100)) throw new Invalid("Il deposito va da 1 a 100%.");
  if ("price_cents" in out && out.price_cents < 100) throw new Invalid("Prezzo non valido.");
  if ("partial_refund_pct" in out && out.partial_refund_pct > 99) throw new Invalid("Il rimborso parziale va da 0 a 99%.");
  for (const k of ["capacity", "max_guests"]) if (k in out && out[k] < 1) throw new Invalid(`${k}: almeno 1.`);
  if ("weekdays" in out) {
    out.weekdays = [...new Set(String(out.weekdays ?? "").replace(/\D/g, ""))].filter((d) => d <= "6").sort().join("");
    if (!out.weekdays) throw new Invalid("Scegli almeno un giorno.");
  }
  if ("price_tiers" in body) out.price_tiers = tiersValue(body.price_tiers);
  if ("extras" in body) out.extras = extrasValue(body.extras);
  if ("times" in body) {
    const times = [...new Set([].concat(body.times ?? []).flatMap((t) => String(t).split(/[\s,;]+/)).filter(Boolean)
      .map((t) => t.replace(".", ":").replace(/^(\d):/, "0$1:")))].sort();
    // Empty: no fixed times, the guest writes the time they would like.
    if (!times.every((t) => TIME.test(t))) throw new Invalid("Orari non validi: scrivili come 09:30, 14:00.");
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
  if (scope === "requested") where.push("b.status = 'requested'");
  else if (scope === "upcoming") { where.push("b.status = 'confirmed' AND b.date >= ?"); binds.push(now); }
  else if (scope === "past") { where.push("b.status = 'confirmed' AND b.date < ?"); binds.push(now); order = "b.date DESC, b.time DESC"; }
  else if (scope === "cancelled") { where.push("b.status = 'cancelled'"); order = "b.cancelled_at DESC"; }
  else throw new Invalid("Elenco non valido.");
  // "recent": the newest bookings first, whatever the tour date.
  if (url.searchParams.get("sort") === "recent") order = "b.created_at DESC, b.id DESC";
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
      (SELECT count(*) FROM tour_bookings WHERE status = 'requested') AS requested_n,
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
  // Where guests heard of us: this month and since the start, paid bookings.
  const sourcesFor = (period) => env.CRM_DB.prepare(`SELECT source, count(*) AS n FROM tour_bookings WHERE ${PAID} ? GROUP BY source ORDER BY n DESC`).bind(period).all();
  const [{ results: sources }, { results: byTour }, { results: sourcesAll }] = await Promise.all([
    sourcesFor(month),
    env.CRM_DB.prepare(`SELECT slug, sum(status = 'confirmed') AS n, sum(paid_cents - refunded_cents) AS deposits
      FROM tour_bookings WHERE ${PAID} ? GROUP BY slug`).bind(month).all(),
    sourcesFor("%"),
  ]);
  const sourceRows = (rows) => rows.map((r) => ({ key: SOURCES[r.source] ? r.source : "none", label: SOURCES[r.source] ?? "Non indicato", n: r.n }));
  return {
    ...row,
    sources: sourceRows(sources),
    sources_all: sourceRows(sourcesAll),
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
    participants: body.participants === undefined ? b.participants : String(body.participants).trim() || null,
    notes: body.notes === undefined ? b.notes : String(body.notes).trim() || null,
    whatsapp: body.whatsapp === undefined || body.whatsapp === "" ? b.whatsapp : Number(body.whatsapp) ? 1 : 0,
  };
  next.time = String(next.time).trim();
  if (!isDate(next.date) || !(TIME.test(next.time) || (freeTime(tour) && timeNote(next.time)))) throw new Invalid("Data o orario non validi (orario come 09:30).");
  if (!Number.isInteger(next.guests) || next.guests < 1) throw new Invalid("Numero di ospiti non valido.");
  if (next.name.length < 2 || !EMAIL.test(next.email)) throw new Invalid("Nome o email non validi.");
  // Moving or growing a booking must fit the slot, not counting itself.
  if (["confirmed", "requested"].includes(b.status) && (next.date !== b.date || next.time !== b.time || next.guests !== b.guests)) {
    const { n } = await env.CRM_DB.prepare(`SELECT ${usedSql(tour)} AS n FROM tour_bookings WHERE slug = ? AND date = ? ${slotSql(tour)} AND id != ? AND ${HOLD}`)
      .bind(b.slug, next.date, ...slotBind(tour, next.time), id).first();
    const left = tour.capacity - n;
    if (left < need(tour, next.guests)) throw new Invalid(`Non c'è posto in quello slot: ${Math.max(0, left)} ${tour.unit === "group" ? "barche" : "posti"} liberi.`);
  }
  // A change in guests reprices the booking unless a total was typed.
  let total = body.total_cents === undefined || body.total_cents === null ? b.total_cents : Number(body.total_cents);
  if (next.guests !== b.guests && Number(body.total_cents) === b.total_cents) total = totalFor(tour, next.guests) + extrasCents(parseExtras(b.extras));
  if (!Number.isInteger(total) || total < 0) throw new Invalid("Totale non valido.");
  await env.CRM_DB.prepare("UPDATE tour_bookings SET date = ?, time = ?, guests = ?, name = ?, email = ?, phone = ?, whatsapp = ?, notes = ?, participants = ?, total_cents = ? WHERE id = ?")
    .bind(next.date, next.time, next.guests, next.name, next.email, next.phone, next.whatsapp, next.notes, next.participants, total, id).run();
  const updated = await bookingBy(env, "id", id);
  let emailed = false;
  if (body.notify && updated.status === "confirmed") emailed = await sendEmail(env, "updated", updated, origin);
  return { booking: updated, emailed };
}

// A verified tour's request: accepting charges the authorised card (up to
// what was authorised) and confirms; declining releases the authorisation.
async function acceptBooking(env, origin, id) {
  const b = await bookingBy(env, "id", id);
  if (!b || b.status !== "requested") throw new Invalid("Questa richiesta non è più da accettare.");
  const intent = await stripe(env, "GET", `payment_intents/${b.payment_intent}`);
  if (intent.status !== "requires_capture") throw new Invalid("L'autorizzazione sulla carta non c'è più (scaduta dopo 7 giorni o annullata): rifiuta la richiesta e scrivi al cliente.");
  const captured = await stripe(env, "POST", `payment_intents/${b.payment_intent}/capture`,
    { amount_to_capture: Math.min(b.deposit_cents, intent.amount_capturable) }, `capture-${b.code}`);
  await env.CRM_DB.prepare("UPDATE tour_bookings SET status = 'confirmed', paid_cents = ?, confirmed_at = datetime('now') WHERE id = ? AND status = 'requested'")
    .bind(captured.amount_received, id).run();
  const done = await bookingBy(env, "id", id);
  return { emailed: await sendEmail(env, "confirmed", done, origin) };
}

async function declineBooking(env, origin, id, body) {
  const b = await bookingBy(env, "id", id);
  if (!b || b.status !== "requested") throw new Invalid("Questa richiesta non è più da rifiutare.");
  const intent = await stripe(env, "GET", `payment_intents/${b.payment_intent}`);
  if (intent.status === "requires_capture") await stripe(env, "POST", `payment_intents/${b.payment_intent}/cancel`, {}, `decline-${b.code}`);
  await env.CRM_DB.prepare("UPDATE tour_bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ? AND status = 'requested'").bind(id).run();
  return { emailed: body.notify ? await sendEmail(env, "declined", b, origin) : false };
}

async function cancelBooking(env, origin, id, body) {
  const b = await bookingBy(env, "id", id);
  if (!b) throw new Invalid("Prenotazione non trovata.");
  // Nothing was charged on a request: cancelling it releases the card.
  if (b.status === "requested") return declineBooking(env, origin, id, body);
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

// CRM → Tour → Codici sconto. A used code can be switched off, not deleted,
// so the bookings that used it keep their history.
async function promosApi(request, env, key) {
  const db = env.CRM_DB;
  const method = request.method;
  const usedPaid = "(SELECT count(*) FROM tour_bookings u WHERE u.promo_code = p.code AND u.status != 'pending')";
  if (!key && method === "GET") {
    const { results } = await db.prepare(`SELECT p.*, ${usedPaid} AS used,
        (SELECT coalesce(sum(discount_cents), 0) FROM tour_bookings u WHERE u.promo_code = p.code AND u.status = 'confirmed') AS discounted
      FROM tour_promos p ORDER BY p.active DESC, p.created_at DESC`).all();
    return json(results);
  }
  if (!key && method === "POST") {
    const body = await request.json();
    const code = promoCode(body.code);
    if (!PROMO.test(code)) throw new Invalid("Il codice va da 3 a 30 caratteri: lettere, numeri e trattini.");
    const value = Number(body.value);
    const percent = body.kind === "percent" ? value : null;
    const amount = body.kind === "amount" ? Math.round(value) : null;
    if (percent !== null && !(Number.isInteger(percent) && percent >= 1 && percent <= 100)) throw new Invalid("La percentuale va da 1 a 100.");
    if (amount !== null && !(amount >= 1)) throw new Invalid("Lo sconto in euro deve essere maggiore di zero.");
    if (percent === null && amount === null) throw new Invalid("Scegli percentuale o importo.");
    const slug = body.slug ? String(body.slug) : null;
    if (slug && !(await getTour(env, slug))) throw new Invalid("Esperienza non trovata.");
    const maxUses = body.max_uses === "" || body.max_uses == null ? null : Number(body.max_uses);
    if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1)) throw new Invalid("Gli usi massimi sono un numero da 1 in su.");
    const expires = body.expires_on ? String(body.expires_on) : null;
    if (expires && !isDate(expires)) throw new Invalid("Data di scadenza non valida.");
    const { meta } = await db.prepare(`INSERT OR IGNORE INTO tour_promos (code, percent, amount_cents, slug, max_uses, expires_on, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(code, percent, amount, slug, maxUses, expires, String(body.note ?? "").trim() || null).run();
    if (!meta.changes) throw new Invalid(`Il codice ${code} esiste già.`);
    return json({ code });
  }
  if (key && method === "PATCH") {
    const { active } = await request.json();
    await db.prepare("UPDATE tour_promos SET active = ? WHERE code = ?").bind(active ? 1 : 0, promoCode(key)).run();
    return json({ ok: true });
  }
  if (key && method === "DELETE") {
    const code = promoCode(key);
    const { meta } = await db.prepare("DELETE FROM tour_promos WHERE code = ? AND NOT EXISTS (SELECT 1 FROM tour_bookings WHERE promo_code = ?)").bind(code, code).run();
    if (!meta.changes) throw new Invalid("Questo codice è già stato usato: disattivalo invece di eliminarlo.");
    return json({ ok: true });
  }
  return json({ error: "Non trovato." }, 404);
}

// A made-up booking of this experience, for the sample email and the previews.
function sampleBooking(env, tour) {
  const total = totalFor(tour, 2);
  return {
    code: "RSM-SAMPLE", slug: tour.slug, title: tour.title, date: addDays(today(), 7), time: tour.times[0] ?? "10:00", guests: 2,
    name: "Jane Smith", email: notifyTo(env), meeting_point: tour.meeting_point, cancel_hours: tour.cancel_hours,
    partial_refund_pct: tour.partial_refund_pct, partial_refund_hours: tour.partial_refund_hours, verify: tour.verify,
    participants: tour.verify ? "Jane Smith, 12/03/1985\nJohn Smith, 02/07/1983" : null,
    status: "confirmed", total_cents: total, deposit_cents: depositFor(tour, total), paid_cents: depositFor(tour, total),
    refunded_cents: 0, discount_cents: 0, ticket_token: "0".repeat(32),
  };
}

// What the guest sees, as the CRM previews it: the ticket or one of the emails.
function preview(b, kind) {
  if (kind === "ticket") return { subject: `Ticket ${b.code}`, html: ticketHtml(b, { preview: true }) };
  if (!EMAIL_KINDS.includes(kind)) throw new Invalid("Anteprima non valida.");
  // A cancellation shows the refund already made, or the deposit as an example.
  const refund = b.refunded_cents || b.paid_cents;
  const shown = kind === "requested" ? { ...b, status: "requested" } : kind === "cancelled" || kind === "declined" ? b : { ...b, status: "confirmed" };
  const { subject, html } = guestEmail(kind, shown, refund);
  return { subject, html };
}

// The start times of `date` for moving a booking there, with the seats each
// has left not counting the booking itself. Closed days and days the tour
// does not run are flagged; the owner may still move a booking there.
async function slotsFor(env, b, tour, date) {
  if (!isDate(date)) throw new Invalid("Data non valida.");
  const [{ results: used }, closed] = await Promise.all([
    env.CRM_DB.prepare(`SELECT time, ${usedSql(tour)} AS n FROM tour_bookings WHERE slug = ? AND date = ? AND id != ? AND ${HOLD} GROUP BY time`)
      .bind(tour.slug, date, b.id).all(),
    env.CRM_DB.prepare("SELECT 1 FROM tour_closures WHERE slug = ? AND date = ?").bind(tour.slug, date).first(),
  ]);
  const base = { date, closed: Boolean(closed), runs: tour.weekdays.includes(String(weekday(date))), free_time: freeTime(tour), need: need(tour, b.guests), unit: tour.unit };
  if (freeTime(tour)) return { ...base, left: tour.capacity - used.reduce((a, r) => a + r.n, 0), times: [] };
  const taken = new Map(used.map((r) => [r.time, r.n]));
  // A booking at a time no longer on the list keeps that time as a choice.
  const times = [...new Set([...tour.times, ...(date === b.date && TIME.test(b.time) ? [b.time] : [])])].sort();
  return { ...base, times: times.map((time) => ({ time, left: tour.capacity - (taken.get(time) ?? 0), listed: tour.times.includes(time) })) };
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
    if (!action && method === "GET") {
      const b = await bookingBy(env, "id", id);
      if (!b) return json({ error: "Non trovato." }, 404);
      const tour = await getTour(env, b.slug);
      return json({ ...b, tour, ticket_url: ticketUrl(b) });
    }
    if (action === "slots" && method === "GET") {
      const b = await bookingBy(env, "id", id);
      if (!b) return json({ error: "Non trovato." }, 404);
      return json(await slotsFor(env, b, await getTour(env, b.slug), url.searchParams.get("date")));
    }
    if (action === "preview" && method === "GET") {
      const b = await bookingBy(env, "id", id);
      if (!b) return json({ error: "Non trovato." }, 404);
      return json(preview(b, url.searchParams.get("kind") ?? "confirmed"));
    }
    if (!action && method === "PATCH") return json(await editBooking(env, url.origin, id, await request.json()));
    if (action === "accept" && method === "POST") return json(await acceptBooking(env, url.origin, id));
    if (action === "decline" && method === "POST") return json(await declineBooking(env, url.origin, id, await request.json()));
    if (action === "cancel" && method === "POST") return json(await cancelBooking(env, url.origin, id, await request.json()));
    if (action === "resend" && method === "POST") {
      const b = await bookingBy(env, "id", id);
      if (!b || b.status !== "confirmed") throw new Invalid("Si può rimandare solo la conferma di una prenotazione attiva.");
      return json({ emailed: await sendEmail(env, "confirmed", b, url.origin) });
    }
  }
  if (what === "promos") return promosApi(request, env, key);
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
      // No ticket link: the sample's ticket does not exist.
      const sample = { ...sampleBooking(env, tour), name: "RomeSoMuch", ticket_token: null };
      return json({ emailed: await sendEmail(env, "confirmed", sample, url.origin), to: sample.email });
    }
    if (action === "preview" && method === "GET") return json(preview(sampleBooking(env, tour), url.searchParams.get("kind") ?? "confirmed"));
    if (action === "closures" && extra && method === "DELETE") {
      await db.prepare("DELETE FROM tour_closures WHERE slug = ? AND date = ?").bind(key, extra).run();
      return json({ ok: true });
    }
  }
  return json({ error: "Non trovato." }, 404);
}
