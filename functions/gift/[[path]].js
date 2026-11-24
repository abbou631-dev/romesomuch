// /gift/<code>?k=<key>: a gift card's own page, linked from the buyer's
// email, to print or forward. The key is the card's random token, so a code
// alone opens nothing. It shows what is left on the card.

import { same, today } from "../../server/common.js";
import { giftByCode } from "../../server/tours.js";
import { giftCardHtml, giftCss } from "../../server/gift-design.js";
import { esc, longDate, euro, SITE } from "../../server/tour-emails.js";

const notFound = () => new Response("Gift card not found. Check the link in your email, or write to us.", {
  status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
});

export async function onRequestGet({ request, env, params }) {
  const code = String([].concat(params.path ?? [])[0] ?? "");
  const key = new URL(request.url).searchParams.get("k") ?? "";
  if (!/^GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) || !/^[0-9a-f]{32}$/.test(key)) return notFound();
  const g = await giftByCode(env, code);
  if (!g || g.status !== "paid" || !(await same(key, g.token))) return notFound();
  const expired = g.expires_on < today();
  const left = Math.max(0, g.balance_cents);
  const state = expired ? `Expired on ${longDate(g.expires_on)}.`
    : left < g.amount_cents ? `${euro(left)} left of ${euro(g.amount_cents)}. Valid until ${longDate(g.expires_on)}.`
      : `Valid until ${longDate(g.expires_on)}.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" /><title>RomeSoMuch gift card · ${esc(euro(g.amount_cents))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f4f2ee;color:#0a0a0a;font:15px/1.55 "Plus Jakarta Sans","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:620px;margin:0 auto;padding:28px 16px 48px}
  ${giftCss}
  .msg{margin:26px 0 0;font-size:19px;line-height:1.5;text-align:center;font-style:italic}
  .from{margin:6px 0 0;text-align:center;color:#5c6560}
  .box{margin:26px 0 0;background:#fff;border-radius:16px;padding:20px 22px}
  h2{margin:0 0 8px;font:400 22px/1.1 Anton,Impact,sans-serif;text-transform:uppercase}
  ol{margin:0;padding-left:20px}
  li{margin:0 0 6px}
  .state{font-weight:700}
  .box a{color:inherit}
  .acts{display:flex;gap:10px;justify-content:center;margin:24px 0 0;flex-wrap:wrap}
  .btn{display:inline-block;border:0;border-radius:999px;padding:12px 22px;font:700 15px "Plus Jakarta Sans",Arial,sans-serif;background:#0a0a0a;color:#fff;text-decoration:none;cursor:pointer}
  .btn.ghost{background:transparent;color:#0a0a0a;box-shadow:inset 0 0 0 1.5px #0a0a0a}
  .fine{margin:18px 0 0;font-size:12.5px;color:#5c6560;text-align:center}
  .fine a{color:inherit}
  @media print{body{background:#fff}.acts,.fine{display:none}.box{padding:0}.gc{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><main>
  ${giftCardHtml(g.amount_cents, { to: g.recipient_name ?? "", code: g.code })}
  ${g.message ? `<p class="msg">“${esc(g.message)}”</p>` : ""}
  <p class="from">From ${esc(g.buyer_name)}</p>
  <div class="box">
    <h2>How to use it</h2>
    <ol>
      <li>Choose an experience on <a href="${SITE}/experiences/all/">romesomuch.com</a> and pick a date.</li>
      <li>In the booking box, type <b>${esc(g.code)}</b> under “Gift card” and press Apply.</li>
      <li>The card pays the whole price; whatever is left stays on the card for another booking.</li>
    </ol>
    <p class="state" style="margin:12px 0 0">${esc(state)}</p>
  </div>
  <div class="acts"><button class="btn" type="button" onclick="print()">Print or save as PDF</button><a class="btn ghost" href="${SITE}/experiences/all/">Choose an experience</a></div>
  <p class="fine">Book by the last valid day; the experience itself can be later. Not exchangeable for cash. <a href="${SITE}/legal/terms/">Terms</a></p>
</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
