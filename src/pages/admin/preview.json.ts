import type { APIRoute } from "astro";
import site from "../../data/site.json";

// Copy the site knows and the CMS preview needs: category labels and the
// default cancellation line an experience falls back to. Served rather than
// duplicated in public/admin/preview.js so the two cannot drift.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      categories: site.categories,
      cancellationDefault: site.cancellationDefault,
    }),
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
