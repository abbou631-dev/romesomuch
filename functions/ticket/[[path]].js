// /ticket/<code>?k=<key>: a guest's ticket, linked from their emails. The key
// is the booking's random ticket_token, so a code alone opens nothing.

import { same } from "../../server/common.js";
import { ticketHtml } from "../../server/tour-ticket.js";
import { bookingBy } from "../../server/tours.js";

const notFound = () => new Response("Ticket not found. Check the link in your confirmation email, or write to us.", {
  status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
});

export async function onRequestGet({ request, env, params }) {
  const code = String([].concat(params.path ?? [])[0] ?? "");
  const key = new URL(request.url).searchParams.get("k") ?? "";
  if (!/^[A-Z0-9-]{4,40}$/.test(code) || !/^[0-9a-f]{32}$/.test(key)) return notFound();
  const b = await bookingBy(env, "code", code);
  if (!b || !b.ticket_token || b.status === "pending" || !(await same(key, b.ticket_token))) return notFound();
  return new Response(ticketHtml(b), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
