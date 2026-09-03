// GitHub OAuth, step 1: send the CMS pop-up to GitHub.
// Cloudflare Pages serves this at /auth, which is what Sveltia CMS opens.

const ALLOWED_SCOPES = ["repo", "public_repo", "user", "read:user", "user:email"];

export const onRequestGet = ({ request, env }) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "github";

  if (provider !== "github") {
    return new Response("Only the GitHub backend is supported.", { status: 400 });
  }
  if (!env.GITHUB_CLIENT_ID) {
    return new Response(
      "GITHUB_CLIENT_ID is not set on this Pages project.",
      { status: 500 },
    );
  }

  // Never request more than the CMS needs, whatever the caller asks for.
  const requested = (url.searchParams.get("scope") ?? "").split(/[ ,]+/).filter(Boolean);
  const scope = requested.filter((s) => ALLOWED_SCOPES.includes(s));
  const state = crypto.randomUUID();

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/callback`);
  authorize.searchParams.set("scope", (scope.length ? scope : ["repo", "user"]).join(","));
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.href,
      "Set-Cookie": `cms_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      "Cache-Control": "no-store",
    },
  });
};
