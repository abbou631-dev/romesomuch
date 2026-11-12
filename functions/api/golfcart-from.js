// "Starting from" price of a golf cart tour, for ONE guest: the lowest
// per-person price over the coming year, read from the partner's quote API.
// Served at /api/golfcart-from?tour=vip|night|oneday.
//
// The partner prices by date (seasons, our commission rules) and by group size;
// its catalogue's own "from" is for its largest group, which is not what a
// single visitor pays. Asking every day of the year would be ~365 requests, so
// it samples: the next 7 days, then the 1st and 15th of each of the next 12
// months (31 quotes, under the Functions subrequest limit). The answer is
// cached at the edge for 15 minutes, so a rule changed in the back office
// shows up on the site within a quarter of an hour.

const QUOTE = "https://romebycart.com/api/shop/romesomuch/quote";
const TOURS = new Set(["vip", "night", "oneday"]);
const TTL = 900;

const day = (d) => d.toISOString().slice(0, 10);

const sampleDates = () => {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates = new Set();
  // Same-day bookings are not taken, so the first day is tomorrow.
  for (let i = 1; i <= 7; i++) dates.add(day(new Date(base + i * 86400000)));
  for (let m = 0; m < 12; m++) {
    for (const d of [1, 15]) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, d));
      if (at.getTime() > base) dates.add(day(at));
    }
  }
  return [...dates];
};

export const onRequestGet = async ({ request, waitUntil }) => {
  const url = new URL(request.url);
  const tour = url.searchParams.get("tour") ?? "";
  if (!TOURS.has(tour)) return Response.json({ error: "unknown tour" }, { status: 400 });

  const key = new Request(`${url.origin}/api/golfcart-from?tour=${tour}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const quotes = await Promise.all(
    sampleDates().map((date) =>
      fetch(`${QUOTE}?tour=${tour}&date=${date}&guests=1`, { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ),
  );
  // Only days that can actually be booked: a closed day has no open slot.
  const prices = quotes
    .filter((q) => q && Number(q.perPerson) > 0 && (q.slots ?? []).some((s) => s.ok))
    .map((q) => Number(q.perPerson));
  const from = prices.length ? Math.min(...prices) : null;

  const res = Response.json(
    { tour, from, checked: prices.length },
    { headers: { "Cache-Control": `public, max-age=${TTL}` } },
  );
  // A failed lookup is not cached, so the next visitor tries again.
  if (from !== null) waitUntil(cache.put(key, res.clone()));
  return res;
};
