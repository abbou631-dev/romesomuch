// GitHub OAuth, step 2: swap the code for a token and hand it to the CMS window.
// The handshake is the one Netlify defined and Sveltia CMS still speaks: the
// pop-up announces itself, the CMS window answers, and only then is the token
// posted back — to that window's origin, and only if the origin is allowed.

const DEFAULT_ORIGINS = [
  "https://romesomuch.pages.dev",
  "https://*.romesomuch.pages.dev",
  "http://localhost:4321",
  "http://localhost:4322",
];

const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const page = (body) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Signing in…</title>${body}`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

const failure = (reason) => page(`<p>Sign-in failed: ${reason.replace(/[<&]/g, "")}</p>`);

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (request.headers.get("Cookie") ?? "").match(/cms_oauth_state=([^;]+)/)?.[1];

  if (!code || !state || !expected || state !== expected) {
    return failure("the request could not be verified. Close this window and try again.");
  }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return failure("GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing on this Pages project.");
  }

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "romesomuch-cms",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    return failure(String(data.error_description ?? data.error ?? `GitHub answered ${res.status}`));
  }

  const configured = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  return page(`<p>Signed in. You can close this window.</p>
<script>
(() => {
  const payload = "authorization:github:success:" + ${json(
    JSON.stringify({ token: data.access_token, provider: "github" }),
  )};
  const allowed = ${json(configured.length ? configured : DEFAULT_ORIGINS)};
  const matches = (origin) =>
    allowed.some((entry) =>
      entry.includes("*")
        ? new RegExp(
            "^" +
              entry.replace(/[.+?^\${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, "[^.]+") +
              "$",
          ).test(origin)
        : entry === origin,
    );
  const handshake = (event) => {
    if (!matches(event.origin)) return;
    window.removeEventListener("message", handshake, false);
    window.opener.postMessage(payload, event.origin);
  };
  window.addEventListener("message", handshake, false);
  window.opener.postMessage("authorizing:github", "*");
})();
</script>`);
};
