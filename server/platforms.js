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

const graph = async (env, path, params = {}) => {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries({ ...params, access_token: env.META_TOKEN })) url.searchParams.set(k, v);
  const response = await fetch(url);
  const body = await response.json();
  if (body.error) throw new Error(`Meta: ${body.error.message}`);
  return body;
};
// Insights come back as [{name, values:[{value}]}]; some metrics only exist
// for some media types, so each list is tried in turn until one is accepted.
const insights = async (env, path, lists) => {
  let last;
  for (const metric of lists) {
    try {
      const { data } = await graph(env, path, { metric });
      return Object.fromEntries(data.map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
    } catch (error) {
      last = error;
    }
  }
  throw last;
};

// ---- Instagram -------------------------------------------------------------

const shortcode = (url) => url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/)?.[1];

async function instagramId(env, video) {
  if (video.external_id) return video.external_id;
  const code = shortcode(video.url);
  if (!code) throw new Error("Link Instagram non riconosciuto.");
  // The API has no lookup by link: walk the account's recent media.
  let after;
  for (let page = 0; page < 8; page++) {
    const { data, paging } = await graph(env, `${env.IG_USER_ID}/media`, { fields: "id,shortcode", limit: "100", ...(after ? { after } : {}) });
    const hit = data.find((m) => m.shortcode === code);
    if (hit) return hit.id;
    after = paging?.cursors?.after;
    if (!paging?.next) break;
  }
  throw new Error("Video non trovato sul profilo Instagram collegato.");
}

async function instagram(env, video) {
  const id = await instagramId(env, video);
  const media = await graph(env, id, { fields: "like_count,comments_count,thumbnail_url,media_url,media_type" });
  const i = await insights(env, `${id}/insights`, ["views,reach,saved,shares,likes,comments", "reach,saved,shares,likes,comments"]);
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
async function unshorten(url, done) {
  for (let hop = 0; hop < 3 && !done(url); hop++) {
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    const next = response.headers.get("Location");
    if (!next) return url;
    url = new URL(next, url).toString();
  }
  return url;
}

// ---- Facebook ----------------------------------------------------------------

const facebookIdIn = (url) => url.match(/(?:reel|videos)\/(\d+)/)?.[1] || url.match(/[?&]v=(\d+)/)?.[1];
async function facebookId(video) {
  if (video.external_id) return video.external_id;
  return facebookIdIn(video.url) || facebookIdIn(await unshorten(video.url, facebookIdIn));
}

async function facebook(env, video) {
  const id = await facebookId(video);
  // fb.watch links send to a login page and never reveal the id.
  if (!id) throw new Error("Link Facebook non riconosciuto: usa il link del reel (facebook.com/reel/…), non fb.watch.");
  const node = await graph(env, id, { fields: "picture,likes.summary(true).limit(0),comments.summary(true).limit(0)" });
  const i = await insights(env, `${id}/video_insights`, [
    "blue_reels_play_count,post_impressions_unique",
    "total_video_views,total_video_impressions_unique",
  ]);
  return {
    external_id: id,
    views: i.blue_reels_play_count ?? i.total_video_views ?? null,
    reach: i.post_impressions_unique ?? i.total_video_impressions_unique ?? null,
    likes: node.likes?.summary?.total_count ?? null,
    comments: node.comments?.summary?.total_count ?? null,
    shares: null,
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

async function tiktokId(video) {
  if (video.external_id) return video.external_id;
  let url = video.url;
  // Short share links (vm./vt.tiktok.com, tiktok.com/t/) redirect to the full one.
  if (/\/\/(vm|vt)\.tiktok\.com\/|tiktok\.com\/t\//.test(url)) url = await unshorten(url, (u) => /\/video\/\d+/.test(u));
  const id = url.match(/\/video\/(\d+)/)?.[1];
  if (!id) throw new Error("Link TikTok non riconosciuto.");
  return id;
}

// TikTok answers up to 20 videos per call, so they go together.
async function tiktokBatch(env, videos) {
  const access = await tiktokAccess(env);
  const ids = new Map();
  for (const v of videos) ids.set(v.id, await tiktokId(v));
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

  const results = [];
  const tiktok = due.filter((v) => v.platform === "tiktok");
  if (tiktok.length) {
    try {
      results.push(...(await tiktokBatch(env, tiktok)));
    } catch (error) {
      results.push(...tiktok.map((video) => ({ video, error: error.message })));
    }
  }
  for (const video of due.filter((v) => v.platform !== "tiktok")) {
    try {
      results.push({ video, metrics: await (video.platform === "instagram" ? instagram : facebook)(env, video) });
    } catch (error) {
      results.push({ video, error: error.message });
    }
  }

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
