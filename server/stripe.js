// Stripe's REST API with a form-encoded body, as Stripe expects. Shared by
// tour bookings (server/tours.js) and gift cards (server/gift-cards.js).

import { Invalid } from "./common.js";

function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
export async function stripe(env, method, path, params, idempotencyKey) {
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
