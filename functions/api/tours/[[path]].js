// /api/tours/*: the site's booking box (availability, hold, confirm), Stripe's
// webhook, and the daily reminders run by workers/report-reminder.
// The logic lives in server/tours.js.

import { json, guarded, sameOrigin, same } from "../../../server/common.js";
import { siteApi, webhook, sendReminders } from "../../../server/tours.js";

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path ?? []);
  // Stripe calls from its own servers, signed with the webhook secret.
  if (path[0] === "stripe" && request.method === "POST") return guarded(() => webhook(request, env));
  if (path[0] === "reminders" && request.method === "POST") {
    if (!env.CRON_KEY || !(await same(request.headers.get("X-Cron-Key") ?? "", env.CRON_KEY))) {
      return json({ error: "Accesso richiesto." }, 401);
    }
    return guarded(async () => json(await sendReminders(env, new URL(request.url).origin)));
  }
  if (!sameOrigin(request)) return json({ error: "Origine non consentita." }, 403);
  return guarded(() => siteApi(request, env, path));
}
