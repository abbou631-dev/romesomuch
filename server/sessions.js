// Who is signed in: the agency (one password) or a client (email and password).
import { verify, readCookie } from "./common.js";

export const STAFF_COOKIE = "rsm_crm";
export const CLIENT_COOKIE = "rsm_client";
// Set by the CRM's "Vedi come cliente": the agency looks at one client's area.
export const VIEW_COOKIE = "rsm_view";

export const staffSignedIn = async (request, env) =>
  Boolean(await verify(env, "staff", readCookie(request, STAFF_COOKIE)));

const CLIENT = `SELECT id, name, contact, videos_total, start_date, end_date, status, instagram, tiktok FROM clients WHERE id = ?`;

// The agency previewing a client comes first; otherwise the person's own
// cookie: their id and session version, valid while they are approved, the
// version matches (raising it signs them out) and the client is not closed.
export async function signedInClient(request, env) {
  const viewing = await verify(env, "view", readCookie(request, VIEW_COOKIE));
  if (viewing && (await staffSignedIn(request, env))) {
    const client = await env.CRM_DB.prepare(CLIENT).bind(Number(viewing[0])).first();
    if (client) return { ...client, preview: true };
  }
  const parts = await verify(env, "client", readCookie(request, CLIENT_COOKIE));
  if (!parts) return null;
  const [userId, version] = parts;
  const row = await env.CRM_DB.prepare(
    `SELECT c.id, c.name, c.contact, c.videos_total, c.start_date, c.end_date, c.status, c.instagram, c.tiktok,
       u.id AS user_id, u.name AS user_name, u.email AS user_email, u.status AS user_status, u.session_version
     FROM client_users u JOIN clients c ON c.id = u.client_id WHERE u.id = ?`,
  ).bind(Number(userId)).first();
  if (!row || row.user_status !== "approvato" || row.status === "concluso" || String(row.session_version) !== version) return null;
  return row;
}
