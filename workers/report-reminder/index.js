// The monthly reminder: "last month's reports are ready, check them and press
// Manda". It only reminds; the recaps themselves leave from the CRM.

const monthName = (period) =>
  new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export default {
  async scheduled(event, env) {
    const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(event.scheduledTime).slice(0, 7);
    const [y, m] = now.split("-").map(Number);
    const period = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const { n } = await env.CRM_DB.prepare(
      `SELECT count(*) AS n FROM clients c WHERE c.status = 'attivo'
         AND EXISTS (SELECT 1 FROM client_users WHERE client_id = c.id AND status = 'approvato')
         AND NOT EXISTS (SELECT 1 FROM monthly_reports WHERE client_id = c.id AND period = ?)`,
    ).bind(period).first();
    if (!n) return console.log("no reports due for", period);
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "RomeSoMuch CRM <forms@romesomuch.com>",
        to: [env.NOTIFY],
        subject: `Promemoria: manda i report di ${monthName(period)}`,
        text: `Ciao!\n\nOggi è il primo del mese: i report di ${monthName(period)} sono pronti per ${n} ${n === 1 ? "cliente" : "clienti"}.\n\nControlla l'anteprima e premi Manda:\n${env.CRM_URL}?mese=${period}\n\nRomeSoMuch CRM`,
      }),
    });
    console.log("reminder", period, n, sent.status, sent.ok ? "" : await sent.text());
  },
};
