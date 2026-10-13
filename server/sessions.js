// Who is signed in: the agency (one password) or a client (email and password).
import { verify, readCookie } from "./common.js";

export const STAFF_COOKIE = "rsm_crm";
export const CLIENT_COOKIE = "rsm_client";

export const staffSignedIn = async (request, env) =>
  Boolean(await verify(env, "staff", readCookie(request, STAFF_COOKIE)));

// The client's cookie carries its id and a fragment of its password hash:
// a new password, revoked access or a closed account ends the session.
export async function signedInClient(request, env) {
  const parts = await verify(env, "client", readCookie(request, CLIENT_COOKIE));
  if (!parts) return null;
  const [id, stamp] = parts;
  const client = await env.CRM_DB.prepare(
    "SELECT id, name, email, password, videos_per_month, start_date, status, instagram, tiktok FROM clients WHERE id = ?",
  ).bind(Number(id)).first();
  if (!client?.password || client.status === "concluso" || client.password.slice(-12) !== stamp) return null;
  delete client.password;
  return client;
}
