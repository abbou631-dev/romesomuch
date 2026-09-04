import type { APIRoute } from "astro";
import css from "../../styles/global.css?raw";

// The CMS renders its entry preview inside a sandboxed iframe and loads this
// stylesheet into it (see public/admin/preview.js). Serving the site's own
// global.css keeps the preview from drifting away from the published page;
// the fonts have to be pulled in here because the iframe has no <head> of ours.
const fonts =
  '@import url("https://fonts.googleapis.com/css2?family=Anton&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");\n';

export const GET: APIRoute = () =>
  new Response(fonts + css, {
    headers: { "content-type": "text/css; charset=utf-8" },
  });
