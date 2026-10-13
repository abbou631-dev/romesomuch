// Lets a private page through only when `allowed` says so, and keeps it out
// of every cache and search engine either way.
import { redirect } from "./common.js";

// `open` lists the pages reachable without signing in (the first is the login).
export async function gate({ request, env, next }, open, allowed) {
  const path = new URL(request.url).pathname;
  const isOpen = open.some((p) => path === p || path.startsWith(`${p}/`));
  if (!isOpen && !(await allowed(request, env))) return redirect(`${open[0]}/`);
  const page = await next();
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(page.body, { status: page.status, headers });
}
