// The emails a guest gets about a booking (server/tours.js sends them):
// confirmed, updated, reminder, cancelled. Each goes out as HTML with a plain
// text twin, which mail clients and spam filters both expect. The HTML is
// tables and inline styles only, the one layout every client (Gmail, Outlook,
// Apple Mail) renders the same; the logo is a PNG on the site because Gmail
// drops SVG.

import site from "../src/data/site.json";

// Images and links must be absolute and public, even when the email is sent
// from a preview or a local server.
const SITE = "https://romesomuch.com";
const LOGO = `${SITE}/email/logo.png`;

const INK = "#111111";
const MUTE = "#6b6b6b";
const HAIR = "#e7e3da";
const CREAM = "#f7f3ea";
const GOLD = "#e8c547";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const euro = (cents) => `€${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
const longDate = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const firstName = (name) => String(name).trim().split(/\s+/)[0];
const guestsText = (n) => `${n} ${n === 1 ? "guest" : "guests"}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const whatsappUrl = `https://wa.me/${site.whatsapp.replace(/\D/g, "")}`;
const mapUrl = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

// What each email says. `details` adds the booking card and the payment split.
const KINDS = {
  confirmed: (b) => ({
    subject: `Booking confirmed: ${b.title}, ${longDate(b.date)}`,
    title: "Your booking is confirmed",
    intro: ["Thank you for booking with us. Everything is set: here is what you need for the day."],
    details: true,
  }),
  updated: (b) => ({
    subject: `Booking updated: ${b.title}, ${longDate(b.date)}`,
    title: "Your booking has been updated",
    intro: ["We have changed your booking. These are the new details."],
    details: true,
  }),
  reminder: (b) => ({
    subject: `See you tomorrow: ${b.title} at ${b.time}`,
    title: "See you tomorrow",
    intro: ["A quick reminder: your experience is tomorrow. Please be at the meeting point a few minutes before the start."],
    details: true,
  }),
  cancelled: (b, refund) => ({
    subject: `Booking cancelled: ${b.title}, ${longDate(b.date)}`,
    title: "Your booking has been cancelled",
    intro: [
      `Your booking ${b.code} (${b.title}, ${longDate(b.date)} at ${b.time}, ${guestsText(b.guests)}) has been cancelled.`,
      refund > 0
        ? `We have refunded ${euro(refund)} to the card you paid with. Banks usually show it within 5 to 10 working days.`
        : "No refund has been issued for this booking.",
    ],
    details: false,
  }),
};

// The booking's facts, as label/value pairs, shared by both versions.
const facts = (b) => [
  ["Booking code", b.code],
  ["Experience", b.title],
  ["Date", longDate(b.date)],
  ["Time", b.time],
  ["Guests", String(b.guests)],
  ...(b.meeting_point ? [["Meeting point", b.meeting_point]] : []),
];
const money = (b) => [
  ["Total", euro(b.total_cents)],
  ["Paid online (deposit)", euro(b.paid_cents)],
  ["To pay on the day", euro(Math.max(0, b.total_cents - b.paid_cents))],
];
const policy = (b) => `Free cancellation up to ${b.cancel_hours} hours before the start. To change or cancel, reply to this email or message us on WhatsApp.`;

function text(b, e) {
  const lines = [`Hi ${firstName(b.name)},`, "", ...e.intro.flatMap((p) => [p, ""])];
  if (e.details) {
    lines.push(...facts(b).map(([k, v]) => `${k}: ${v}`), "");
    lines.push(...money(b).map(([k, v]) => `${k}: ${v}`), "");
    lines.push(`Details and map: ${SITE}/experience/${b.slug}/`, "", policy(b), "");
  }
  lines.push(`Questions? Reply to this email or write to us on WhatsApp: ${site.whatsapp} (${whatsappUrl}).`, "", "See you in Rome,", "RomeSoMuch", SITE);
  return lines.join("\n");
}

const row = ([k, v], strong = false) => `<tr>
  <td style="padding:7px 0;color:${MUTE};font-size:14px;vertical-align:top;width:42%">${esc(k)}</td>
  <td style="padding:7px 0;color:${INK};font-size:14px;text-align:right;font-weight:${strong ? 700 : 500}">${esc(v)}</td></tr>`;

function html(b, e) {
  const card = e.details ? `
    <tr><td style="padding:8px 32px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${HAIR};border-radius:12px">
        <tr><td style="padding:16px 20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${facts(b).map((f) => row(f)).join("")}</table>
          ${b.meeting_point ? `<p style="margin:6px 0 0;text-align:right"><a href="${mapUrl(b.meeting_point)}" style="color:${INK};font-size:13px">Open in Google Maps</a></p>` : ""}
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:14px 32px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};border-radius:12px">
        <tr><td style="padding:14px 20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${money(b).map((m, i) => row(m, i === 2)).join("")}</table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:24px 32px 0">
      <a href="${SITE}/experience/${esc(b.slug)}/" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">See the experience and the map</a>
    </td></tr>
    <tr><td style="padding:20px 32px 0;color:${MUTE};font-size:13px;line-height:1.5">${esc(policy(b))}</td></tr>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" /><title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee">
<div style="display:none;max-height:0;overflow:hidden">${esc(e.intro[0])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;font-family:${FONT}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px">
      <tr><td align="center" style="padding:32px 32px 8px"><a href="${SITE}"><img src="${LOGO}" width="150" height="53" alt="RomeSoMuch" style="display:block;border:0" /></a></td></tr>
      <tr><td align="center" style="padding:0 32px"><div style="width:40px;height:3px;background:${GOLD};margin:14px auto 0"></div></td></tr>
      <tr><td style="padding:22px 32px 0;color:${INK}">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;text-align:center">${esc(e.title)}</h1>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.55">Hi ${esc(firstName(b.name))},</p>
        ${e.intro.map((p) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.55">${esc(p)}</p>`).join("")}
      </td></tr>${card}
      <tr><td style="padding:22px 32px 30px;color:${INK};font-size:15px;line-height:1.55">
        Questions? Reply to this email or <a href="${whatsappUrl}" style="color:${INK};font-weight:700">write to us on WhatsApp</a>.<br /><br />See you in Rome,<br /><strong>RomeSoMuch</strong>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;color:${MUTE};font-size:12px;font-family:${FONT}"><a href="${SITE}" style="color:${MUTE}">romesomuch.com</a> · ${esc(site.whatsapp)}</p>
  </td></tr>
</table>
</body></html>`;
}

export function guestEmail(kind, b, ...extra) {
  const e = KINDS[kind](b, ...extra);
  return { subject: e.subject, text: text(b, e), html: html(b, e) };
}
