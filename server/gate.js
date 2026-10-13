// Lets a private page through only when `allowed` says so, and keeps it out
// of every cache and search engine either way.
import { redirect } from "./common.js";

export async function gate({ request, env, next }, login, allowed) {
  const path = new URL(request.url).pathname;
  const open = path === login || path.startsWith(`${login}/`);
  if (!open && !(await allowed(request, env))) return redirect(`${login}/`);
  const page = await next();
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(page.body, { status: page.status, headers });
}
