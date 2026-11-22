// A booking's ticket: one page the guest opens from the confirmation email
// (functions/ticket/[[path]].js) and the owner opens or previews from the CRM.
// It says the same as the emails (facts and money come from tour-emails.js),
// laid out to show on a phone at the meeting point or to save as a PDF with
// the browser's print dialog.

import site from "../src/data/site.json";
import { SITE, LOGO, esc, longDate, facts, money, mapUrl, whatsappUrl } from "./tour-emails.js";
import { cancelPolicy } from "./tour-policy.js";

const STATES = {
  confirmed: null,
  requested: ["Request, not confirmed yet", "We are checking availability. This ticket is valid once we confirm by email."],
  cancelled: ["Cancelled", "This booking has been cancelled and this ticket is no longer valid."],
  pending: ["Payment not completed", "This booking is not confirmed."],
};

export function ticketHtml(b, { preview = false } = {}) {
  const state = STATES[b.status] ?? null;
  const time = /^\d{2}:\d{2}$/.test(b.time) ? b.time : esc(b.time);
  // The code, date, time and guests are the headline; the rest is a list.
  const rest = facts(b).filter(([k]) => !["Booking code", "Experience", "Date", "Time", "Preferred time", "Guests"].includes(k));
  const row = ([k, v], strong = false) => `<div class="r${strong ? " s" : ""}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const pay = money(b);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" /><title>Ticket ${esc(b.code)} · ${esc(b.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
<style>
  :root{--ink:#0a0a0a;--mute:#5c6560;--hair:rgba(10,10,10,.12);--cream:#f8f4e7;--gold:#b8912f;--yellow:#f3e7c0}
  *{box-sizing:border-box}
  body{margin:0;background:#f4f2ee;color:var(--ink);font:15px/1.5 "Plus Jakarta Sans","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:560px;margin:0 auto;padding:24px 16px 40px}
  .t{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 0 var(--hair)}
  .top{padding:26px 26px 20px;text-align:center}
  .top img{width:140px;height:auto;display:block;margin:0 auto}
  .kick{margin:18px 0 6px;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--mute)}
  h1{margin:0;font:400 34px/1 Anton,Impact,"Arial Narrow",sans-serif;text-transform:uppercase}
  .state{margin:16px 26px 0;padding:12px 16px;border-radius:12px;background:#fdecea;color:#8a1c12;font-size:14px}
  .state.requested{background:var(--yellow);color:var(--ink)}
  .state b{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:12px}
  .big{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);margin-top:20px}
  .big div{padding:14px 10px;text-align:center}
  .big div+div{border-left:1px solid var(--hair)}
  .big span{display:block;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
  .big b{display:block;margin-top:4px;font:400 22px/1.1 Anton,Impact,sans-serif;text-transform:uppercase;overflow-wrap:anywhere}
  .big b.txt{font:700 14px/1.3 "Plus Jakarta Sans",Arial,sans-serif;text-transform:none}
  .tear{position:relative;height:28px;background:#fff}
  .tear::before,.tear::after{content:"";position:absolute;top:0;width:28px;height:28px;border-radius:50%;background:#f4f2ee}
  .tear::before{left:-14px}.tear::after{right:-14px}
  .tear i{position:absolute;left:22px;right:22px;top:13px;border-top:2px dashed var(--hair)}
  .code{text-align:center;padding:0 26px 6px}
  .code span{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--mute)}
  .code b{display:block;font:400 40px/1.1 Anton,Impact,sans-serif;letter-spacing:.06em;margin-top:2px}
  .code small{display:block;color:var(--mute);font-size:13px}
  .list{padding:14px 26px 4px}
  .r{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--hair);font-size:14px}
  .r:last-child{border-bottom:0}
  .r span{color:var(--mute)}
  .r b{font-weight:600;text-align:right;white-space:pre-line}
  .r.s b{font-weight:800}
  .pay{margin:10px 26px 0;padding:6px 16px;border-radius:12px;background:var(--cream)}
  .map{display:block;text-align:right;font-size:13px;color:var(--ink);font-weight:600;margin:2px 0 6px}
  .foot{padding:18px 26px 24px;color:var(--mute);font-size:13px}
  .foot a{color:var(--ink);font-weight:600}
  .bar{display:flex;gap:10px;justify-content:center;margin:18px 0 0}
  .bar button,.bar a{font:700 14px "Plus Jakarta Sans",Arial,sans-serif;border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:999px;padding:11px 22px;cursor:pointer;text-decoration:none}
  .bar a{background:#fff;color:var(--ink)}
  .note{margin:10px 0 0;text-align:center;color:var(--mute);font-size:12px}
  @media print{
    body{background:#fff}
    main{padding:0;max-width:none}
    .t{box-shadow:none;border:1px solid var(--hair)}
    .tear::before,.tear::after{background:#fff}
    .bar,.note{display:none}
    @page{margin:14mm}
  }
</style></head>
<body><main>
  <div class="t">
    <div class="top">
      <a href="${SITE}"><img src="${LOGO}" width="140" alt="RomeSoMuch" /></a>
      <p class="kick">Your ticket</p>
      <h1>${esc(b.title)}</h1>
    </div>
    ${state ? `<div class="state ${esc(b.status)}"><b>${esc(state[0])}</b>${esc(state[1])}</div>` : ""}
    <div class="big">
      <div><span>Date</span><b>${esc(longDate(b.date).replace(/ \d{4}$/, ""))}</b></div>
      <div><span>${b.status === "requested" ? "Preferred time" : "Time"}</span><b${time === b.time ? "" : ' class="txt"'}>${time}</b></div>
      <div><span>Guests</span><b>${esc(b.guests)}</b></div>
    </div>
    <div class="tear"><i></i></div>
    <div class="code"><span>Booking code</span><b>${esc(b.code)}</b><small>Booked by ${esc(b.name)}</small></div>
    <div class="list">
      ${row(["Date", longDate(b.date)])}
      ${rest.map((f) => row(f)).join("")}
      ${b.meeting_point ? `<a class="map" href="${mapUrl(b.meeting_point)}" target="_blank" rel="noopener">Open the meeting point in Google Maps</a>` : ""}
    </div>
    <div class="pay">${pay.map((m, i) => row(m, i === pay.length - 1)).join("")}</div>
    <div class="foot">
      ${esc(cancelPolicy(b))} To change or cancel, write to us on WhatsApp or by email.<br /><br />
      Questions? <a href="${whatsappUrl}">WhatsApp ${esc(site.whatsapp)}</a> · <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>
    </div>
  </div>
  ${preview ? "" : `<div class="bar"><button type="button" onclick="print()">Save as PDF</button><a href="${SITE}/experience/${esc(b.slug)}/">The experience</a></div>
  <p class="note">Show this page on your phone at the meeting point, or save it as a PDF.</p>`}
</main></body></html>`;
}
