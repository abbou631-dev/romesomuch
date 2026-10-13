// Passwordless access to the client area: invite links, access requests,
// and sign-in links sent by email (through Resend, like the site's forms).
import { setCookie, sign } from "./common.js";
import { CLIENT_COOKIE } from "./sessions.js";

// Browsers keep a cookie at most ~400 days; every visit renews it, so a
// person who opens the area at least once a year never signs in again.
export const SESSION_DAYS = 400;
const LINK_MINUTES = 30;

export const randomToken = (bytes = 24) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

export const sessionCookie = async (env, user) =>
  setCookie(CLIENT_COOKIE, await sign(env, "client", [user.id, user.session_version], SESSION_DAYS), SESSION_DAYS);

export async function mail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY is not set: email not sent", subject);
    return false;
  }
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ENQUIRY_FROM ?? "RomeSoMuch <forms@romesomuch.com>", to: [to], subject, text }),
  });
  if (!sent.ok) console.log("resend rejected", subject, sent.status, await sent.text());
  return sent.ok;
}

// One sign-in link per approved access of this email (a person may follow
// several venues), all in one message. `minutes` is how long they work.
export async function sendLinks(env, origin, users, { minutes = LINK_MINUTES, intro } = {}) {
  if (!users.length) return;
  const db = env.CRM_DB;
  const links = [];
  const statements = [db.prepare("DELETE FROM login_links WHERE expires_at < ?").bind(Date.now())];
  for (const user of users) {
    const token = randomToken();
    statements.push(db.prepare("INSERT INTO login_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), user.id, Date.now() + minutes * 60e3));
    links.push(`${user.client_name}: ${origin}/api/portal/enter?t=${token}`);
  }
  await db.batch(statements);
  const valid = minutes >= 1440 ? `${Math.round(minutes / 1440)} giorni` : `${minutes} minuti`;
  await mail(env, {
    to: users[0].email,
    subject: "RomeSoMuch · il tuo accesso all'area clienti",
    text: `Ciao${users[0].name ? ` ${users[0].name}` : ""},\n\n${intro ?? "ecco il link per entrare nell'area clienti RomeSoMuch."}\n\n${links.join("\n\n")}\n\nIl link vale ${valid}. Una volta dentro resti collegato su questo dispositivo: la prossima volta ti basta aprire ${origin}/area-clienti/.\nSe non l'hai chiesto tu, ignora questa email.\n\nRomeSoMuch`,
  });
}
