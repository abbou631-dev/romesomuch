// Who is signed in: the agency (one password) or a client (email and password).
import { verify, readCookie } from "./common.js";

export const STAFF_COOKIE = "rsm_crm";
export const CLIENT_COOKIE = "rsm_client";
// Set by the CRM's "Vedi come cliente": the agency looks at one client's area.
export const VIEW_COOKIE = "rsm_view";

export const staffSignedIn = async (request, env) =>
  Boolean(await verify(env, "staff", readCookie(request, STAFF_COOKIE)));

const CLIENT = `SELECT id, name, contact, email, password, videos_total, start_date, end_date, status, instagram, tiktok
  FROM clients WHERE id = ?`;

// The agency previewing a client comes first; otherwise the client's own
// cookie, which carries its id and a fragment of its password hash, so a new
// password, revoked access or a closed account ends the session.
export async function signedInClient(request, env) {
  const viewing = await verify(env, "view", readCookie(request, VIEW_COOKIE));
  if (viewing && (await staffSignedIn(request, env))) {
    const client = await env.CRM_DB.prepare(CLIENT).bind(Number(viewing[0])).first();
    if (client) {
      delete client.password;
      return { ...client, preview: true };
    }
  }
  const parts = await verify(env, "client", readCookie(request, CLIENT_COOKIE));
  if (!parts) return null;
  const [id, stamp] = parts;
  const client = await env.CRM_DB.prepare(CLIENT).bind(Number(id)).first();
  if (!client?.password || client.status === "concluso" || client.password.slice(-12) !== stamp) return null;
  delete client.password;
  return client;
}
