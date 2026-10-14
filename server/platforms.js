// Live metrics for the videos published on RomeSoMuch's own accounts.
//
// Instagram and Facebook: Meta Graph API with one Page access token
// (META_TOKEN) of the RomeSoMuch Facebook Page, which also reads the linked
// Instagram professional account (IG_USER_ID). Needs instagram_basic,
// instagram_manage_insights, pages_read_engagement, read_insights.
//
// TikTok: Display API (scope video.list) for the RomeSoMuch account, which
// authorises once from the CRM; TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET
// are the app's, the tokens are kept in the settings table and renewed here.
//
// A platform without its secrets is simply "not connected": its videos keep
// the numbers typed in by hand.

const GRAPH = "https://graph.facebook.com/v23.0";
const TIKTOK = "https://open.tiktokapis.com/v2";

export const connections = async (env) => ({
  instagram: Boolean(env.META_TOKEN && env.IG_USER_ID),
  facebook: Boolean(env.META_TOKEN),
  tiktok: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET && (await tiktokTokens(env))),
  tiktokApp: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
});

// One refresh is one request to the server, which may make only 50 outbound
// calls (Workers free plan). A run counts them, stops before the limit and
// remembers lists it has already read (the account's posts) for every video.
const BUDGET = 40;
class OutOfBudget extends Error {}
const run = (env) => ({ env, calls: 0, cache: new Map() });
const spend = (r) => {
  if (++r.calls > BUDGET) throw new OutOfBudget();
};
const once = (r, key, load) => {
  if (!r.cache.has(key)) r.cache.set(key, load());
  return r.cache.get(key);
};

const graph = async (r, path, params = {}) => {
  spend(r);
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries({ ...params, access_token: r.env.META_TOKEN })) url.searchParams.set(k, v);
  const response = await fetch(url);
  const body = await response.json();
  if (body.error) throw new Error(`Meta: ${body.error.message}`);
  return body;
};
// Insights come back as [{name, values:[{value}]}]; some metrics only exist
// for some media types, so each list is tried in turn until one is accepted.
const insights = async (r, path, lists) => {
  let last;
  for (const metric of lists) {
    try {
      const { data } = await graph(r, path, { metric });
      return Object.fromEntries(data.map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
    } catch (error) {
      if (error instanceof OutOfBudget) throw error;
      last = error;
    }
  }
  throw last;
};

// ---- Instagram -------------------------------------------------------------

const shortcode = (url) => url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/)?.[1];

// The API has no lookup by link: the account's recent media (shortcode -> id),
// read once per run.
const instagramMedia = (r) => once(r, "instagram", async () => {
  const map = new Map();
  let after;
  for (let page = 0; page < 6; page++) {
    const { data, paging } = await graph(r, `${r.env.IG_USER_ID}/media`, { fields: "id,shortcode", limit: "100", ...(after ? { after } : {}) });
    for (const m of data) map.set(m.shortcode, m.id);
    after = paging?.cursors?.after;
    if (!paging?.next) break;
  }
  return map;
});

async function instagramId(r, video) {
  if (video.external_id) return video.external_id;
  const code = shortcode(video.url);
  if (!code) throw new Error("Link Instagram non riconosciuto.");
  const id = (await instagramMedia(r)).get(code);
  if (!id) throw new Error("Video non trovato sul profilo Instagram collegato.");
  return id;
}

async function instagram(r, video) {
  const id = await instagramId(r, video);
  const media = await graph(r, id, { fields: "like_count,comments_count,thumbnail_url,media_url,media_type" });
  const i = await insights(r, `${id}/insights`, ["views,reach,saved,shares,likes,comments", "reach,saved,shares,likes,comments"]);
  return {
    external_id: id,
    views: i.views ?? null,
    reach: i.reach ?? null,
    likes: i.likes ?? media.like_count ?? null,
    comments: i.comments ?? media.comments_count ?? null,
    shares: i.shares ?? null,
    saves: i.saved ?? null,
    thumbnail: media.thumbnail_url ?? media.media_url ?? null,
  };
}

// Share links (facebook.com/share/r/…, tiktok.com/t/…) redirect to the full
// address with the video's id; hops are followed until `done` finds what it
// needs (a later hop may be a login page), at most three.
async function unshorten(r, url, done) {
  for (let hop = 0; hop < 3 && !done(url); hop++) {
    spend(r);
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    const next = response.headers.get("Location");
    if (!next) return url;
    url = new URL(next, url).toString();
  }
  return url;
}

// ---- Facebook ----------------------------------------------------------------

const facebookIdIn = (url) => url.match(/(?:reel|videos)\/(\d+)/)?.[1] || url.match(/[?&]v=(\d+)/)?.[1];
const romeDate = (time) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date(time));

// Facebook often answers a server's request for a share link with its login
// page, so when the link gives no id the video is found on the Page itself
// by its publication day. The Page's reels and videos are read once per run.
const facebookPosts = (r) => once(r, "facebook", async () => {
  const posts = [];
  for (const [edge, pages] of [["video_reels", 4], ["videos", 2]]) {
    let after;
    for (let page = 0; page < pages; page++) {
      const { data, paging } = await graph(r, `me/${edge}`, { fields: "id,created_time,description,title", limit: "100", ...(after ? { after } : {}) });
      for (const v of data) if (!posts.some((p) => p.id === v.id)) posts.push(v);
      after = paging?.cursors?.after;
      if (!paging?.next) break;
    }
  }
  return posts;
});

async function facebookByDate(r, video) {
  const hits = (await facebookPosts(r)).filter((v) => romeDate(v.created_time) === video.published_on);
  if (hits.length <= 1) return hits[0]?.id ?? null;
  // Several that day: the one whose caption shares most words with the title.
  const words = new Set(String(video.title ?? "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const score = (v) => (`${v.title ?? ""} ${v.description ?? ""}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => words.has(w)).length;
  const ranked = hits.map((v) => [score(v), v]).sort((a, b) => b[0] - a[0]);
  if (ranked[0][0] > 0 && ranked[0][0] > ranked[1][0]) return ranked[0][1].id;
  throw new Error("Più video Facebook pubblicati quel giorno: incolla il link del reel (facebook.com/reel/…).");
}

async function facebookId(r, video) {
  if (video.external_id) return video.external_id;
  return facebookIdIn(video.url) || facebookIdIn(await unshorten(r, video.url, facebookIdIn)) || facebookByDate(r, video);
}

// Which insights a video has depends on its kind (reel or classic video), so
// all of them are asked for and the known names picked out.
const total = (value) => (value && typeof value === "object" ? Object.values(value).reduce((t, n) => t + (Number(n) || 0), 0) : value);

async function facebook(r, video) {
  const id = await facebookId(r, video);
  if (!id) throw new Error("Video Facebook non trovato sulla Pagina: incolla il link del reel (facebook.com/reel/…).");
  const [node, { data }] = await Promise.all([
    graph(r, id, { fields: "picture,likes.summary(true).limit(0),comments.summary(true).limit(0)" }),
    graph(r, `${id}/video_insights`),
  ]);
  const i = Object.fromEntries(data.map((d) => [d.name, d.values?.[0]?.value ?? null]));
  const actions = i.post_video_social_actions ?? {};
  return {
    external_id: id,
    views: i.fb_reels_total_plays ?? i.blue_reels_play_count ?? i.total_video_views ?? null,
    reach: i.post_impressions_unique ?? i.total_video_impressions_unique ?? null,
    likes: total(i.post_video_likes_by_reaction_type) ?? node.likes?.summary?.total_count ?? null,
    comments: node.comments?.summary?.total_count ?? actions.COMMENT ?? actions.comment ?? null,
    shares: actions.SHARE ?? actions.share ?? null,
    saves: null,
    thumbnail: node.picture ?? null,
  };
}

// ---- TikTok ------------------------------------------------------------------

export const tiktokRedirect = (origin) => `${origin}/api/crm/tiktok/callback`;

export const tiktokAuthorizeUrl = (env, origin, state) => {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY, scope: "user.info.basic,video.list", response_type: "code",
    redirect_uri: tiktokRedirect(origin), state,
  });
  return url.toString();
};

const tokenRequest = async (env, params) => {
  const response = await fetch(`${TIKTOK}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, ...params }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`TikTok: ${body.error_description || body.error || response.status}`);
  const now = Date.now();
  const tokens = {
    access: body.access_token, refresh: body.refresh_token, open_id: body.open_id,
    access_until: now + (body.expires_in - 120) * 1000, refresh_until: now + body.refresh_expires_in * 1000,
  };
  await env.CRM_DB.prepare("INSERT INTO settings (key, value) VALUES ('tiktok', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(tokens)).run();
  return tokens;
};

export const tiktokExchange = (env, origin, code) =>
  tokenRequest(env, { code, grant_type: "authorization_code", redirect_uri: tiktokRedirect(origin) });

async function tiktokTokens(env) {
  const row = await env.CRM_DB.prepare("SELECT value FROM settings WHERE key = 'tiktok'").first();
  const tokens = row && JSON.parse(row.value);
  return tokens && tokens.refresh_until > Date.now() ? tokens : null;
}

async function tiktokAccess(env) {
  const tokens = await tiktokTokens(env);
  if (!tokens) throw new Error("TikTok non collegato: collegalo dal CRM.");
  if (tokens.access_until > Date.now()) return tokens.access;
  return (await tokenRequest(env, { grant_type: "refresh_token", refresh_token: tokens.refresh })).access;
}

async function tiktokId(r, video) {
  if (video.external_id) return video.external_id;
  let url = video.url;
  // Short share links (vm./vt.tiktok.com, tiktok.com/t/) redirect to the full one.
  if (/\/\/(vm|vt)\.tiktok\.com\/|tiktok\.com\/t\//.test(url)) url = await unshorten(r, url, (u) => /\/video\/\d+/.test(u));
  const id = url.match(/\/video\/(\d+)/)?.[1];
  if (!id) throw new Error("Link TikTok non riconosciuto.");
  return id;
}

// TikTok answers up to 20 videos per call, so they go together.
async function tiktokBatch(r, videos) {
  const access = await tiktokAccess(r.env);
  const ids = new Map();
  for (const v of videos) ids.set(v.id, await tiktokId(r, v));
  spend(r);
  const response = await fetch(`${TIKTOK}/video/query/?fields=id,cover_image_url,view_count,like_count,comment_count,share_count`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filters: { video_ids: [...new Set(ids.values())] } }),
  });
  const body = await response.json();
  if (body.error?.code && body.error.code !== "ok") throw new Error(`TikTok: ${body.error.message || body.error.code}`);
  const found = new Map((body.data?.videos ?? []).map((v) => [v.id, v]));
  return videos.map((video) => {
    const t = found.get(ids.get(video.id));
    if (!t) return { video, error: "Video non trovato sull'account TikTok collegato." };
    return {
      video,
      metrics: {
        external_id: t.id, views: t.view_count ?? null, reach: null, likes: t.like_count ?? null,
        comments: t.comment_count ?? null, shares: t.share_count ?? null, saves: null,
        thumbnail: t.cover_image_url ?? null,
      },
    };
  });
}

// ---- refreshing --------------------------------------------------------------

// Reads fresh numbers for the videos whose last reading is older than
// `maxAgeMinutes`, at most `limit` per call (a request may only make so many
// outbound calls), and stores them. Returns how many were updated.
export async function refresh(env, videos, { maxAgeMinutes = 30, limit = 12 } = {}) {
  const live = await connections(env);
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60e3).toISOString();
  const due = videos.filter((v) => live[v.platform] && (!v.metrics_at || v.metrics_at < cutoff)).slice(0, limit);
  if (!due.length) return 0;

  const r = run(env);
  const results = [];
  const tiktok = due.filter((v) => v.platform === "tiktok");
  if (tiktok.length) {
    try {
      results.push(...(await tiktokBatch(r, tiktok)));
    } catch (error) {
      if (!(error instanceof OutOfBudget)) results.push(...tiktok.map((video) => ({ video, error: error.message })));
    }
  }
  for (const video of due.filter((v) => v.platform !== "tiktok")) {
    try {
      results.push({ video, metrics: await (video.platform === "instagram" ? instagram : facebook)(r, video) });
    } catch (error) {
      // Out of calls: this video and the rest wait for the next refresh.
      if (error instanceof OutOfBudget) break;
      results.push({ video, error: error.message });
    }
  }
  if (!results.length) return 0;

  const now = new Date().toISOString();
  const db = env.CRM_DB;
  await db.batch(results.map(({ video, metrics, error }) => metrics
    ? db.prepare(`UPDATE videos SET external_id = ?, views = ?, reach = ?, likes = ?, comments = ?, shares = ?, saves = ?,
        thumbnail = coalesce(?, thumbnail), metrics_at = ?, metrics_error = NULL WHERE id = ?`)
      .bind(metrics.external_id, metrics.views, metrics.reach, metrics.likes, metrics.comments, metrics.shares, metrics.saves,
        metrics.thumbnail, now, video.id)
    // A failed reading keeps the last numbers and says why; metrics_at moves
    // on so a broken link is not retried on every page view.
    : db.prepare("UPDATE videos SET metrics_error = ?, metrics_at = ? WHERE id = ?").bind(error.slice(0, 300), now, video.id)));
  return results.filter((r) => r.metrics).length;
}
