// Who is signed in: the agency (one password) or a client (email and password).
import { verify, readCookie } from "./common.js";

export const STAFF_COOKIE = "rsm_crm";
export const CLIENT_COOKIE = "rsm_client";
// Set by the CRM's "Vedi come cliente": the agency looks at one client's area.
export const VIEW_COOKIE = "rsm_view";

// The CRM has two kinds of session: the owner (the CRM password, cookie
// parts ["crm"]) and team members (emailed link, parts ["team", id, version]),
// who only add videos and look up clients. Raising a member's version, or
// removing them, ends their session.
export async function staffSession(request, env) {
  const parts = await verify(env, "staff", readCookie(request, STAFF_COOKIE));
  if (!parts) return null;
  if (parts[0] === "crm") return { role: "owner" };
  if (parts[0] !== "team") return null;
  const member = await env.CRM_DB.prepare("SELECT id, name, email, session_version, can_titles FROM team_members WHERE id = ?")
    .bind(Number(parts[1])).first();
  return member && String(member.session_version) === parts[2] ? { role: "team", ...member } : null;
}

export const staffSignedIn = async (request, env) => Boolean(await staffSession(request, env));
// Previews of the client area show documents and invoices: owner only.
export const ownerSignedIn = async (request, env) => (await staffSession(request, env))?.role === "owner";

const CLIENT = `SELECT id, name, contact, videos_total, start_date, end_date, status, instagram, tiktok FROM clients WHERE id = ?`;

// The agency previewing a client comes first; otherwise the person's own
// cookie: their id and session version, valid while they are approved, the
// version matches (raising it signs them out) and the client is not closed.
export async function signedInClient(request, env) {
  const viewing = await verify(env, "view", readCookie(request, VIEW_COOKIE));
  if (viewing && (await ownerSignedIn(request, env))) {
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
