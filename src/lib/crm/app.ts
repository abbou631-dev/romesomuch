// The agency CRM: a hash-routed app over /api/crm (functions/api/crm).
// Every view is rebuilt from the server after each change.

import {
  type Field, type Row, apiFor, say, form, esc, eur, num, short, day, month, shortMonth, ago, today, thisMonth,
  addMonths, head, kpi, table, quota, bars, badge, platform, interactions, PLATFORM,
} from "./ui";

const api = apiFor("/api/crm", "/crm/login/");
const view = document.getElementById("view")!;

const STATUS = { attivo: "Attivo", pausa: "In pausa", concluso: "Concluso" } as Record<string, string>;
const CHARGE = { pagato: "Pagato", scaduto: "Scaduto", da_pagare: "Da pagare" } as Record<string, string>;
const chargeState = (c: Row) => (c.paid_at ? "pagato" : c.due_date < today() ? "scaduto" : "da_pagare");

let clients: Row[] = [];
const clientName = (id: number) => clients.find((c) => c.id === id)?.name ?? "—";
const clientLink = (id: number) => `<a href="#/cliente/${id}">${esc(clientName(id))}</a>`;
const clientLinks = (ids: number[] = []) => ids.map(clientLink).join(", ") || "—";
const clientOptions = (): [string, string][] => clients.map((c) => [String(c.id), c.name]);

// ---- forms -------------------------------------------------------------------

const clientFields = (): Field[] => [
  { name: "name", label: "Nome del locale / cliente", required: true },
  { name: "status", label: "Stato", type: "select", options: Object.entries(STATUS) },
  { name: "fee", label: "Canone mensile (€)", type: "money" },
  { name: "videos_per_month", label: "Video al mese previsti dal pacchetto", type: "number", min: 0, max: 100 },
  { name: "billing_day", label: "Giorno di pagamento", type: "number", min: 1, max: 28 },
  { name: "start_date", label: "Inizio pacchetto", type: "date" },
  { name: "end_date", label: "Fine pacchetto", type: "date" },
  { name: "contact", label: "Referente" },
  { name: "email", label: "Email", type: "email", hint: "È anche il nome utente dell'area clienti" },
  { name: "phone", label: "Telefono / WhatsApp", type: "tel" },
  { name: "instagram", label: "Instagram del locale" },
  { name: "tiktok", label: "TikTok del locale" },
  { name: "vat", label: "P.IVA / Codice fiscale" },
  { name: "notes", label: "Note", type: "textarea" },
];
const videoFields = (): Field[] => [
  { name: "client_ids", label: "Clienti nel video", type: "checks", options: clientOptions(), required: true, hint: "Spunta tutti i locali che compaiono nel video: lo vedranno tutti nella loro area" },
  { name: "platform", label: "Piattaforma", type: "select", options: Object.entries(PLATFORM), required: true },
  { name: "url", label: "Link del video", type: "url", required: true, hint: "Il link pubblico del reel / video / TikTok" },
  { name: "published_on", label: "Pubblicato il", type: "date", required: true },
  { name: "title", label: "Titolo", hint: "Vuoto = prima riga della didascalia, se la piattaforma è collegata" },
  { name: "views", label: "Visualizzazioni", type: "number", min: 0, hint: "Le metriche si compilano da sole se la piattaforma è collegata" },
  { name: "reach", label: "Account raggiunti", type: "number", min: 0 },
  { name: "likes", label: "Mi piace", type: "number", min: 0 },
  { name: "comments", label: "Commenti", type: "number", min: 0 },
  { name: "shares", label: "Condivisioni", type: "number", min: 0 },
  { name: "saves", label: "Salvataggi", type: "number", min: 0 },
];
const chargeFields = (): Field[] => [
  { name: "client_id", label: "Cliente", type: "select", options: clientOptions(), required: true },
  { name: "kind", label: "Tipo", type: "select", options: [["canone", "Canone"], ["extra", "Extra"]] },
  { name: "description", label: "Voce", list: ["Visibilità costante", "Video extra", "Shooting", "ADV"] },
  { name: "period", label: "Mese di competenza", type: "month", required: true },
  { name: "amount", label: "Importo (€)", type: "money", required: true },
  { name: "due_date", label: "Scadenza", type: "date", required: true },
  { name: "invoice_no", label: "N° fattura" },
  { name: "paid_at", label: "Pagato il", type: "date", hint: "Vuoto = non ancora pagato" },
];
const FIELDS: Record<string, () => Field[]> = { clients: clientFields, videos: videoFields, charges: chargeFields };
const TITLES: Record<string, [string, string]> = {
  clients: ["Nuovo cliente", "Modifica cliente"], videos: ["Nuovo video", "Modifica video"], charges: ["Nuovo addebito", "Modifica addebito"],
};
const edit = (table: string, row: Row) =>
  form(TITLES[table][row.id ? 1 : 0], FIELDS[table](), row,
    (d) => (row.id ? api(`${table}/${row.id}`, { method: "PATCH", data: d }) : api(table, { method: "POST", data: d })), render);
const fresh = (table: string, clientId?: number): Row => {
  if (table === "clients") return { status: "attivo", billing_day: 1, videos_per_month: 4, start_date: today() };
  if (table === "videos") return { client_ids: clientId ? [clientId] : [], platform: "instagram", published_on: today() };
  return { client_id: clientId ?? clients[0]?.id, kind: "extra", period: thisMonth(), due_date: today() };
};

// A client's area password: typed or generated, then copied with an invite
// ready to paste into WhatsApp, since it is never shown again.
const generate = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => alphabet[b % alphabet.length]).join("");
};
const access = (c: Row) =>
  form("Accesso all'area clienti", [
    { name: "password", label: `Password per ${c.email}`, required: true, hint: "Almeno 8 caratteri. Già generata: puoi tenerla o cambiarla." },
  ], { password: generate() }, async (d) => {
    await api(`clients/${c.id}/access`, { method: "POST", data: d });
    const invite = `Ciao! Da oggi trovi i video che pubblichiamo per ${c.name} e le loro metriche nella tua area riservata RomeSoMuch:\n${location.origin}/area-clienti/\nEmail: ${c.email}\nPassword: ${d.password}`;
    try {
      await navigator.clipboard.writeText(invite);
      setTimeout(() => say("Password salvata. Invito copiato: incollalo su WhatsApp"), 50);
    } catch {
      setTimeout(() => say("Password salvata"), 50);
    }
  }, render);

// ---- shared pieces --------------------------------------------------------------

const add = (table: string, label: string, clientId?: number) =>
  `<button class="btn primary" data-add="${table}"${clientId ? ` data-client="${clientId}"` : ""}>${esc(label)}</button>`;
const rowActions = (table: string, id: number) =>
  `<button class="link" data-edit="${table}" data-id="${id}">Modifica</button><button class="link danger" data-del="${table}" data-id="${id}">Elimina</button>`;

const chargeRows = (charges: Row[], showClient = true) => charges.map((c) => {
  const state = chargeState(c);
  return `<tr>${showClient ? `<td>${clientLink(c.client_id)}</td>` : ""}<td>${esc(month(c.period))}</td><td>${esc(c.description ?? "")}</td>
    <td class="num">${eur(c.amount)}</td><td>${day(c.due_date)}</td><td>${badge(state, CHARGE[state])}</td>
    <td class="row-actions"><button class="btn small${c.paid_at ? "" : " primary"}" data-pay="${c.id}" data-paid="${c.paid_at ? 1 : 0}">${c.paid_at ? "Annulla" : "Segna pagato"}</button>${rowActions("charges", c.id)}</td></tr>`;
});
const chargeHeads = (showClient = true) => [...(showClient ? ["Cliente"] : []), "Mese", "Voce", "Importo", "Scadenza", "Stato", ""];

const videoRows = (videos: Row[], showClient = true) => videos.map((v) => `<tr>
  <td>${day(v.published_on)}</td>${showClient ? `<td>${clientLinks(v.client_ids)}</td>` : ""}
  <td>${platform(v.platform)}</td>
  <td><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title || "Apri video")}</a>${!showClient && v.client_ids?.length > 1 ? `<small class="block mute">con ${v.client_ids.length - 1} altri locali</small>` : ""}${v.metrics_error ? `<small class="block err">${esc(v.metrics_error)}</small>` : ""}</td>
  <td class="num">${num(v.views)}</td><td class="num">${num(v.reach)}</td><td class="num">${num(interactions(v))}</td>
  <td><small class="mute">${v.metrics_at ? ago(v.metrics_at) : "a mano"}</small></td>
  <td class="row-actions"><button class="link" data-refresh="${v.id}">Aggiorna</button>${rowActions("videos", v.id)}</td></tr>`);
const videoHeads = (showClient = true) =>
  ["Data", ...(showClient ? ["Cliente"] : []), "", "Video", "Visualizzazioni", "Raggiunti", "Interazioni", "Metriche", ""];

const monthPicker = (value: string) => `<label class="inline">Mese <input type="month" data-month value="${value}" /></label>`;
let selected = thisMonth();

// ---- views -------------------------------------------------------------------

async function dashboard() {
  const s = await api(`summary?month=${selected}`);
  const active = s.clients.filter((c: Row) => c.status === "attivo");
  const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  const outstanding = sum(s.unpaid, "amount");
  const late = s.unpaid.filter((c: Row) => c.due_date < s.today);
  const connected = Object.entries(s.connections).filter(([k, v]) => v && k !== "tiktokApp").length;
  const trend = new Map(s.trend.map((t: Row) => [t.month, t]));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth(), i - 11));

  const rows = s.clients.filter((c: Row) => c.status !== "concluso").map((c: Row) => `<tr>
    <td><a href="#/cliente/${c.id}"><strong>${esc(c.name)}</strong></a>${c.status === "pausa" ? ` ${badge("pausa", "In pausa")}` : ""}</td>
    <td>${quota(c.videos, c.videos_per_month)}</td><td class="num">${num(c.views)}</td><td class="num">${num(c.interactions)}</td>
    <td>${day(c.last_video)}</td>
    <td>${c.fee ? (c.paid === null ? '<span class="mute">—</span>' : c.paid ? badge("pagato", "Pagato") : badge("da_pagare", "Da pagare")) : '<span class="mute">—</span>'}</td>
    <td>${c.has_access ? badge("yes", "Attiva") : c.email ? badge("no", "Da attivare") : badge("no", "Manca email")}</td></tr>`);

  view.innerHTML = `
    ${head("Visibilità costante", `${monthPicker(selected)}${add("videos", "+ Video")}`, `Panoramica di ${esc(month(selected))}`)}
    ${connected ? "" : `<p class="note warn">Nessuna piattaforma collegata: le metriche vanno inserite a mano. <a href="#/collegamenti">Collega Instagram, Facebook e TikTok →</a></p>`}
    <section class="kpis">
      ${kpi("Clienti attivi", String(active.length), `${s.clients.length} in totale`)}
      ${kpi("Canoni al mese", eur(sum(active, "fee")))}
      ${kpi(`Presenze ${month(selected)}`, `${sum(active, "videos")} / ${sum(active, "videos_per_month")}`, "video dei clienti / previsti dai pacchetti", sum(active, "videos") >= sum(active, "videos_per_month") ? "good" : "")}
      ${kpi("Visualizzazioni del mese", short(s.totals.views), `${s.totals.videos} video · ${num(s.totals.interactions)} interazioni`)}
      ${kpi("Da incassare", eur(outstanding), late.length ? `${late.length} in ritardo` : "nessun ritardo", late.length ? "alert" : "")}
    </section>
    <section class="panel"><h2>Clienti del pacchetto · ${esc(month(selected))}</h2>
      ${table(["Cliente", "Video", "Visualizzazioni", "Interazioni", "Ultimo video", "Canone del mese", "Area clienti"], rows, "Nessun cliente ancora. Aggiungilo da Clienti.")}
    </section>
    <section class="panel"><h2>Visualizzazioni per mese <small class="mute">tutti i clienti</small></h2>
      ${bars(months.map((m) => ({ key: m, label: shortMonth(m), value: (trend.get(m) as Row)?.views ?? 0, title: `${month(m)}: ${num((trend.get(m) as Row)?.views ?? 0)} visualizzazioni, ${(trend.get(m) as Row)?.videos ?? 0} video` })), selected, "data-pick")}
    </section>
    <div class="grid2">
      <section class="panel"><h2>Pagamenti da ricevere</h2>
        ${s.unpaid.length ? `<ul class="list">${s.unpaid.slice(0, 10).map((c: Row) => {
          const state = chargeState(c);
          return `<li><div>${clientLink(c.client_id)}<small>${esc(c.description ?? "")} · ${esc(month(c.period))} · scade ${day(c.due_date)}</small></div>
            <div class="end"><strong>${eur(c.amount)}</strong>${badge(state, CHARGE[state])}<button class="btn small primary" data-pay="${c.id}" data-paid="0">Pagato</button></div></li>`;
        }).join("")}</ul>` : '<p class="empty">Tutti in regola.</p>'}
      </section>
      <section class="panel"><h2>Ultimi video</h2>
        ${s.recent.length ? `<ul class="list">${s.recent.map((v: Row) => `<li><div><span>${clientLinks(v.client_ids)}</span><small>${platform(v.platform)} ${day(v.published_on)} · <a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title || "apri")}</a></small></div>
          <div class="end"><strong>${short(v.views)}</strong><small class="mute">views</small></div></li>`).join("")}</ul>` : '<p class="empty">Nessun video ancora.</p>'}
      </section>
    </div>`;
}

async function clientsView() {
  const s = await api(`summary?month=${thisMonth()}`);
  const rows = s.clients.map((c: Row) => `<tr><td><a href="#/cliente/${c.id}"><strong>${esc(c.name)}</strong></a></td>
    <td>${badge(c.status, STATUS[c.status])}</td><td class="num">${eur(c.fee)}</td><td>${quota(c.videos, c.videos_per_month)}</td>
    <td class="num ${c.outstanding ? "warn" : ""}">${eur(c.outstanding)}</td><td>${c.has_access ? badge("yes", "Attiva") : badge("no", "No")}</td></tr>`);
  view.innerHTML = `${head("Clienti", add("clients", "+ Nuovo cliente"))}
    <section class="panel">${table(["Cliente", "Stato", "Canone", `Video ${shortMonth(thisMonth())}`, "Da incassare", "Area clienti"], rows, "Nessun cliente. Aggiungi il primo.")}</section>`;
}

async function clientView(id: number) {
  const c = clients.find((x) => x.id === id);
  if (!c) return void (view.innerHTML = head("Cliente non trovato") + '<p><a href="#/clienti">← Clienti</a></p>');
  const [videos, charges] = await Promise.all([api<Row[]>(`videos?client_id=${id}`), api<Row[]>(`charges?client_id=${id}`)]);
  const now = videos.filter((v) => v.published_on.startsWith(thisMonth()));
  const views = (rows: Row[]) => rows.reduce((t, v) => t + (v.views ?? 0), 0);
  const outstanding = charges.filter((x) => !x.paid_at).reduce((t, x) => t + x.amount, 0);
  const info: [string, string][] = [
    ["Pacchetto", `${eur(c.fee)} / mese · ${c.videos_per_month} video / mese`],
    ["Dal", `${day(c.start_date)}${c.end_date ? ` al ${day(c.end_date)}` : ""}`],
    ["Referente", esc(c.contact ?? "—")],
    ["Email", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"],
    ["Telefono", c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "—"],
    ["Instagram", esc(c.instagram ?? "—")],
    ["TikTok", esc(c.tiktok ?? "—")],
    ["P.IVA / CF", esc(c.vat ?? "—")],
  ];
  view.innerHTML = `
    <p class="crumb"><a href="#/clienti">← Clienti</a></p>
    ${head(`${esc(c.name)} ${badge(c.status, STATUS[c.status])}`, `<button class="btn" data-edit="clients" data-id="${c.id}">Modifica</button><button class="btn danger" data-del="clients" data-id="${c.id}">Elimina</button>`)}
    <section class="kpis">
      ${kpi(`Video ${month(thisMonth())}`, `${now.length} / ${c.videos_per_month}`, "pubblicati / previsti", now.length >= c.videos_per_month ? "good" : "")}
      ${kpi("Visualizzazioni del mese", short(views(now)))}
      ${kpi("Visualizzazioni totali", short(views(videos)), `${videos.length} video`)}
      ${kpi("Da incassare", eur(outstanding), "", outstanding ? "alert" : "")}
    </section>
    <div class="grid2">
      <section class="panel"><h2>Scheda</h2><dl class="info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}</section>
      <section class="panel"><h2>Area clienti</h2>
        ${!c.email ? `<p class="empty">Inserisci l'email del cliente (Modifica): sarà il suo nome utente.</p><div class="actions"><button class="btn" data-view="${c.id}">Vedi come cliente</button></div>`
          : c.has_access ? `<p>${badge("yes", "Attiva")} Il cliente entra su <a href="/area-clienti/" target="_blank">${esc(location.host)}/area-clienti/</a> con <strong>${esc(c.email)}</strong>.</p>
            <div class="actions"><button class="btn primary" data-view="${c.id}">Vedi come cliente</button><button class="btn" data-access="${c.id}">Nuova password</button><button class="btn danger" data-revoke="${c.id}">Revoca accesso</button></div>`
          : `<p class="mute">Non ha ancora accesso. Imposta una password: il CRM copia un messaggio d'invito da mandargli su WhatsApp.</p>
            <div class="actions"><button class="btn primary" data-access="${c.id}">Attiva accesso</button><button class="btn" data-view="${c.id}">Vedi come cliente</button></div>`}
      </section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Video</h2><div class="actions"><button class="btn" data-refresh-client="${id}">Aggiorna metriche</button>${add("videos", "+ Video", id)}</div></div>
      ${table(videoHeads(false), videoRows(videos, false), "Nessun video ancora.")}</section>
    <section class="panel"><div class="panel-head"><h2>Pagamenti</h2>${add("charges", "+ Addebito", id)}</div>
      ${table(chargeHeads(false), chargeRows(charges, false), "Nessun addebito. Il canone del mese si crea da solo quando apri il CRM.")}</section>`;
}

let videoClient = "";
async function videosView() {
  const all = await api<Row[]>(`videos?month=${selected}`);
  const rows = all.filter((v) => !videoClient || v.client_ids.includes(Number(videoClient)));
  view.innerHTML = `${head("Video", `<button class="btn" data-refresh-all>Aggiorna metriche</button>${add("videos", "+ Video")}`)}
    <div class="filters">${monthPicker(selected)}
      <label>Cliente <select data-video-client><option value="">Tutti</option>${clientOptions().map(([k, l]) => `<option value="${k}"${k === videoClient ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>
    <section class="panel">${table(videoHeads(), videoRows(rows), `Nessun video in ${month(selected)}.`)}</section>`;
}

let payState = "tutti";
async function paymentsView() {
  const all = await api<Row[]>("charges");
  const rows = all.filter((c) => c.period === selected && (payState === "tutti" || chargeState(c) === payState));
  const total = rows.reduce((t, c) => t + c.amount, 0);
  const paid = rows.filter((c) => c.paid_at).reduce((t, c) => t + c.amount, 0);
  view.innerHTML = `${head("Pagamenti", `<button class="btn" data-charge-month>Genera canoni del mese</button>${add("charges", "+ Addebito")}`)}
    <div class="filters">${monthPicker(selected)}
      <label>Stato <select data-pay-state>${[["tutti", "Tutti"], ...Object.entries(CHARGE)].map(([k, l]) => `<option value="${k}"${k === payState ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <section class="panel">
      <div class="totals"><div><span>Totale</span><strong>${eur(total)}</strong></div><div><span>Pagato</span><strong>${eur(paid)}</strong></div><div><span>Da pagare</span><strong class="${total - paid ? "warn" : ""}">${eur(total - paid)}</strong></div></div>
      ${table(chargeHeads(), chargeRows(rows), "Nessun addebito con questi filtri.")}
    </section>`;
}

async function connectionsView() {
  const s = await api(`summary?month=${thisMonth()}`);
  const c = s.connections;
  const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const message = query.get("ok") === "tiktok" ? '<p class="note pos">TikTok collegato.</p>'
    : query.get("e") === "tiktok" ? '<p class="note neg">Collegamento TikTok non riuscito: riprova.</p>'
    : query.get("e") === "tiktok-app" ? '<p class="note neg">Mancano le chiavi dell\'app TikTok sul server.</p>' : "";
  const state = (on: boolean) => (on ? badge("yes", "Collegato") : badge("no", "Non collegato"));
  view.innerHTML = `${head("Collegamenti", "", "Da dove arrivano le metriche dei video")}
    ${message}
    <div class="conn">
      <section class="panel"><h2>${platform("instagram")} Instagram ${state(c.instagram)}</h2>
        <p class="mute">Visualizzazioni, account raggiunti, like, commenti, condivisioni e salvataggi di ogni reel.</p>
        <ol><li>Su developers.facebook.com crea un'app di tipo Business.</li>
        <li>Genera un token della Pagina Facebook RomeSoMuch con <code>instagram_basic</code>, <code>instagram_manage_insights</code>, <code>pages_read_engagement</code>, <code>read_insights</code> (meglio un token di System User, non scade).</li>
        <li>Nel Terminale: <code>npx wrangler pages secret put META_TOKEN</code> e <code>npx wrangler pages secret put IG_USER_ID</code> (ID dell'account Instagram professionale).</li></ol></section>
      <section class="panel"><h2>${platform("facebook")} Facebook ${state(c.facebook)}</h2>
        <p class="mute">Riproduzioni, persone raggiunte, like e commenti dei video e reel della Pagina.</p>
        <ol><li>Usa lo stesso <code>META_TOKEN</code> di Instagram: basta quello.</li></ol></section>
      <section class="panel"><h2>${platform("tiktok")} TikTok ${state(c.tiktok)}</h2>
        <p class="mute">Visualizzazioni, like, commenti e condivisioni dei video dell'account RomeSoMuch.</p>
        <ol><li>Su developers.tiktok.com crea un'app con Login Kit e lo scope <code>video.list</code>; come redirect URI metti <code>${esc(location.origin)}/api/crm/tiktok/callback</code>.</li>
        <li>Nel Terminale: <code>npx wrangler pages secret put TIKTOK_CLIENT_KEY</code> e <code>TIKTOK_CLIENT_SECRET</code>.</li>
        <li>Poi premi il pulsante qui sotto ed entra con l'account TikTok RomeSoMuch.</li></ol>
        ${c.tiktokApp ? `<p><a class="btn primary" href="/api/crm/tiktok/connect">${c.tiktok ? "Ricollega TikTok" : "Collega TikTok"}</a></p>` : ""}</section>
    </div>`;
}

// ---- routing and events ------------------------------------------------------------

async function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => {
    const target = a.getAttribute("href")!.replace(/^#\/?/, "");
    a.classList.toggle("on", target === route || (route === "cliente" && target === "clienti"));
  });
  try {
    clients = await api<Row[]>("clients");
    if (route === "clienti") await clientsView();
    else if (route === "cliente") await clientView(Number(arg));
    else if (route === "video") await videosView();
    else if (route === "pagamenti") await paymentsView();
    else if (route === "collegamenti") await connectionsView();
    else await dashboard();
  } catch (error) {
    view.innerHTML = `<p class="empty">Impossibile caricare: ${esc((error as Error).message)}</p>`;
  }
}

async function act(work: () => Promise<unknown>, done: string) {
  try {
    const message = await work();
    say(typeof message === "string" ? message : done);
    render();
  } catch (error) {
    say((error as Error).message, true);
  }
}
const refreshed = ({ updated }: Row) => (updated ? `${updated} video aggiornati` : "Niente da aggiornare (piattaforma non collegata o letto da poco)");

view.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  const d = el.dataset;
  if (d.add) edit(d.add, fresh(d.add, d.client ? Number(d.client) : undefined));
  else if (d.edit) {
    const rows = d.edit === "clients" ? Promise.resolve(clients) : api<Row[]>(d.edit);
    rows.then((all) => { const row = all.find((r) => r.id === Number(d.id)); if (row) edit(d.edit!, row); });
  } else if (d.del) {
    const what = d.del === "clients"
      ? "Eliminare il cliente con tutti i suoi video e pagamenti? Non si può annullare. Se ha solo smesso, mettilo in stato Concluso."
      : "Eliminare definitivamente?";
    if (!confirm(what)) return;
    act(() => api(`${d.del}/${d.id}`, { method: "DELETE" }), "Eliminato").then(() => {
      if (d.del === "clients") location.hash = "#/clienti";
    });
  } else if (d.pay) {
    act(() => api(`charges/${d.pay}`, { method: "PATCH", data: { paid_at: d.paid === "1" ? null : today() } }), d.paid === "1" ? "Segnato da pagare" : "Segnato pagato");
  } else if (d.access) {
    const c = clients.find((x) => x.id === Number(d.access));
    if (c) access(c);
  } else if (d.view) {
    // Opened before the request so the browser does not block the new tab.
    const tab = window.open("about:blank", "_blank");
    api(`clients/${d.view}/view`, { method: "POST", data: {} })
      .then(() => { if (tab) tab.location.href = "/area-clienti/"; else location.href = "/area-clienti/"; })
      .catch((error) => { tab?.close(); say(error.message, true); });
  } else if (d.revoke) {
    if (!confirm("Revocare l'accesso? Il cliente non potrà più entrare finché non imposti una nuova password.")) return;
    act(() => api(`clients/${d.revoke}/access`, { method: "POST", data: { password: "" } }), "Accesso revocato");
  } else if (d.refresh) {
    act(async () => refreshed(await api("refresh", { method: "POST", data: { id: Number(d.refresh) } })), "");
  } else if (d.refreshClient) {
    act(async () => refreshed(await api("refresh", { method: "POST", data: { client_id: Number(d.refreshClient) } })), "");
  } else if ("refreshAll" in d) {
    act(async () => refreshed(await api("refresh", { method: "POST", data: {} })), "");
  } else if ("chargeMonth" in d) {
    act(async () => `${(await api("charge-month", { method: "POST", data: { period: selected } })).created} canoni creati per ${month(selected)}`, "");
  } else if (d.pick) {
    selected = d.pick;
    render();
  }
});

view.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  if ("month" in el.dataset && el.value) { selected = el.value; render(); }
  else if ("videoClient" in el.dataset) { videoClient = el.value; render(); }
  else if ("payState" in el.dataset) { payState = el.value; render(); }
});

export function start() {
  addEventListener("hashchange", render);
  render();
}
