// Buying a gift card on the site (src/pages/gift-cards.astro): the card is
// paid in full with Stripe, then the buyer gets an email with the card and a
// link to its printable page (functions/gift). Using a card on a booking, and
// its balance, live in server/tours.js (giftByCode, the booking hold).
// Schema: migrations/0027_gift_cards.sql.

import { Invalid, today } from "./common.js";
import { mail } from "./access.js";
import { stripe } from "./stripe.js";
import { GIFT_AMOUNTS, GIFT_DESIGNS, giftCardEmail } from "./gift-design.js";
import { SITE, LOGO, FROM, esc, euro, firstName, longDate, whatsappUrl } from "./tour-emails.js";
import site from "../src/data/site.json";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const pick = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => CHARS[b % CHARS.length]).join("");
const newCode = () => `GIFT-${pick(4)}-${pick(4)}`;
const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const GIFT_CODE = /^GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const giftUrl = (g) => `${SITE}/gift/${encodeURIComponent(g.code)}?k=${g.token}`;
const notifyTo = (env) => env.CRM_NOTIFY ?? "romesomuch@gmail.com";

// A year from today, minus a day: bought 24 Nov 2026, last use 23 Nov 2027.
function yearFrom(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const publicGift = (g) => ({
  code: g.code, amount: g.amount_cents, to: g.recipient_name, expires: g.expires_on, status: g.status, url: g.status === "paid" ? giftUrl(g) : null,
});

// Step 1: a pending card and a Stripe payment for its full value.
export async function holdGift(env, body) {
  const amount = Number(body.amount);
  if (!GIFT_AMOUNTS.includes(amount)) throw new Invalid("gift_amount");
  const buyer = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const to = String(body.to ?? "").trim().slice(0, 60) || null;
  const message = String(body.message ?? "").trim().slice(0, 300) || null;
  if (buyer.length < 2 || !EMAIL.test(email)) throw new Invalid("missing_fields");
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PUBLISHABLE_KEY) throw new Invalid("payments_off");
  const code = newCode();
  await env.CRM_DB.prepare("INSERT INTO gift_cards (code, token, amount_cents, buyer_name, buyer_email, recipient_name, message) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(code, newToken(), amount, buyer, email, to, message).run();
  try {
    const intent = await stripe(env, "POST", "payment_intents", {
      amount, currency: "eur", automatic_payment_methods: { enabled: true }, receipt_email: email,
      description: `Gift card ${code} · ${euro(amount)}${to ? ` · for ${to}` : ""}`,
      metadata: { gift: code },
    }, `gift-${code}`);
    await env.CRM_DB.prepare("UPDATE gift_cards SET payment_intent = ? WHERE code = ?").bind(intent.id, code).run();
    return { code, clientSecret: intent.client_secret, pk: env.STRIPE_PUBLISHABLE_KEY, amount };
  } catch (error) {
    await env.CRM_DB.prepare("DELETE FROM gift_cards WHERE code = ?").bind(code).run();
    throw error;
  }
}

// Step 2, from the browser and from Stripe's webhook (whichever comes first):
// a succeeded payment makes the card valid for a year and emails the buyer.
export async function confirmGift(env, intentId) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(intentId ?? "")) throw new Invalid("Pagamento non valido.");
  const g = await env.CRM_DB.prepare("SELECT * FROM gift_cards WHERE payment_intent = ?").bind(intentId).first();
  if (!g) throw new Invalid("Gift card non trovata.");
  if (g.status !== "pending") return publicGift(g);
  const intent = await stripe(env, "GET", `payment_intents/${intentId}`);
  if (intent.status !== "succeeded") return { ...publicGift(g), payment: intent.status };
  const expires = yearFrom(today());
  const { meta } = await env.CRM_DB.prepare("UPDATE gift_cards SET status = 'paid', paid_at = datetime('now'), expires_on = ? WHERE id = ? AND status = 'pending'")
    .bind(expires, g.id).run();
  const paid = { ...g, status: "paid", expires_on: expires };
  if (meta.changes) await Promise.all([mail(env, { to: g.buyer_email, from: FROM, replyTo: site.contactEmail, ...giftEmail(paid) }), notifyOwner(env, paid)]);
  return publicGift(paid);
}

const notifyOwner = (env, g) => mail(env, {
  to: notifyTo(env),
  subject: `Gift card venduta: ${euro(g.amount_cents)} · ${g.buyer_name}`,
  replyTo: g.buyer_email,
  text: [
    `${g.buyer_name} (${g.buyer_email}) ha comprato una gift card da ${euro(g.amount_cents)}, pagata online.`,
    ...(g.recipient_name ? [`Per: ${g.recipient_name}`] : []),
    `Codice ${g.code} · valida fino al ${g.expires_on}`,
    "",
    "Gestionale: https://romesomuch.com/crm/tour/#/gift",
  ].join("\n"),
});

// ---- the buyer's email -----------------------------------------------------------

const INK = "#111111";
const MUTE = "#6b6b6b";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const howTo = (g) => [
  `Choose any experience on ${SITE.replace("https://", "")} and, in the booking box, type the code ${g.code} under "Gift card".`,
  "The card pays the whole price: what is paid online and what is due on the day. If the booking costs less, the rest stays on the card for another one.",
  `Book by ${longDate(g.expires_on)}: the date of the experience itself can be later.`,
];

export function giftEmail(g) {
  const subject = `Your RomeSoMuch gift card: ${euro(g.amount_cents)}`;
  const intro = `Thank you for your order. Here is your ${euro(g.amount_cents)} gift card${g.recipient_name ? ` for ${g.recipient_name}` : ""}: print it, or forward the link below.`;
  const text = [
    `Hi ${firstName(g.buyer_name)},`, "", intro, "",
    `Gift card: ${euro(g.amount_cents)}`, `Code: ${g.code}`, `Valid until: ${longDate(g.expires_on)}`,
    ...(g.message ? [`Your message: ${g.message}`] : []), "",
    `Printable card: ${giftUrl(g)}`, "",
    "How it works:", ...howTo(g).map((l) => `- ${l}`), "",
    `Questions? Reply to this email or write to us on WhatsApp: ${site.whatsapp} (${whatsappUrl}).`, "", "RomeSoMuch", SITE,
  ].join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee">
<div style="display:none;max-height:0;overflow:hidden">${esc(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;font-family:${FONT}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px">
      <tr><td align="center" style="padding:32px 32px 8px"><a href="${SITE}"><img src="${LOGO}" width="150" height="53" alt="RomeSoMuch" style="display:block;border:0" /></a></td></tr>
      <tr><td style="padding:18px 32px 0;color:${INK}">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;text-align:center">Your gift card is ready</h1>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.55">Hi ${esc(firstName(g.buyer_name))},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55">${esc(intro)}</p>
      </td></tr>
      <tr><td align="center" style="padding:0 24px">${giftCardEmail(g.amount_cents, { to: g.recipient_name, code: g.code, expires: longDate(g.expires_on), site: SITE })}</td></tr>
      ${g.message ? `<tr><td style="padding:18px 32px 0;color:${INK};font-size:15px;line-height:1.55;font-style:italic;text-align:center">“${esc(g.message)}”</td></tr>` : ""}
      <tr><td align="center" style="padding:24px 32px 0">
        <a href="${esc(giftUrl(g))}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">Open the printable card</a>
      </td></tr>
      <tr><td style="padding:24px 32px 0;color:${INK}">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${MUTE};font-weight:700">How it works</p>
        ${howTo(g).map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.55">${esc(l)}</p>`).join("")}
        <p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:${MUTE}">Valid until ${esc(longDate(g.expires_on))}. Not exchangeable for cash. <a href="${SITE}/legal/terms/" style="color:${MUTE}">Terms</a></p>
      </td></tr>
      <tr><td style="padding:22px 32px 30px;color:${INK};font-size:15px;line-height:1.55">
        Questions? Reply to this email or <a href="${whatsappUrl}" style="color:${INK};font-weight:700">write to us on WhatsApp</a>.<br /><br /><strong>RomeSoMuch</strong>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { subject, text, html };
}

