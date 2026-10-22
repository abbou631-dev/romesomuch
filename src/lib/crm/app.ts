// The agency CRM: a hash-routed app over /api/crm (functions/api/crm).
// Every view is rebuilt from the server after each change.

import {
  type Field, type Row, apiFor, say, form, esc, eur, num, short, day, month, shortMonth, ago, today, thisMonth,
  addMonths, addDays, head, kpi, table, quota, bars, badge, platform, interactions, PLATFORM,
} from "./ui";

const api = apiFor("/api/crm", "/crm/login/");
const view = document.getElementById("view")!;

const STATUS = { attivo: "Attivo", pausa: "In pausa", concluso: "Concluso" } as Record<string, string>;
const EVERY = { 1: "Mensile", 3: "Trimestrale", 6: "Semestrale" } as Record<string, string>;
// The fee is what the client pays each period (the whole semester, say);
// a month is that divided by the months it covers.
const perMonth = (c: Row) => Math.round((c.fee ?? 0) / Math.max(c.billing_every || 1, 1));
// "1.800,00 € · semestrale (300,00 € / mese)"
const feeLine = (c: Row) => `${eur(c.fee)} · ${(EVERY[c.billing_every] ?? "Mensile").toLowerCase()}${c.billing_every > 1 ? ` (${eur(perMonth(c))} / mese)` : ""}`;
// The kinds of venue; a client can be in several (stored as "key,key").
const CATEGORY = {
  trattoria: "Trattoria/Osteria", ristorante: "Ristoranti medio-alti", negozio: "Negozi", street_food: "Street food", cafe: "Cafe",
} as Record<string, string>;
const categoriesOf = (c: Row): string[] => String(c.categories ?? "").split(",").filter((k) => CATEGORY[k]);
const categoryTags = (c: Row) => categoriesOf(c).map((k) => `<span class="cat">${esc(CATEGORY[k])}</span>`).join("");
// The Clienti page's filter: a category key, or "" for all.
let category = "";
const inCategory = (c: Row) => !category || categoriesOf(c).includes(category);
const categoryFilter = (rows: Row[]) => `<nav class="months cats" aria-label="Categoria">${[["", "Tutti"], ...Object.entries(CATEGORY)].map(([k, l]) => {
  const n = k ? rows.filter((c) => categoriesOf(c).includes(k)).length : rows.length;
  return `<button type="button" data-category="${k}" class="${k === category ? "on" : ""}">${esc(l)} <small>${n}</small></button>`;
}).join("")}</nav>`;
const CHARGE = { pagato: "Pagato", scaduto: "Scaduto", da_pagare: "Da pagare" } as Record<string, string>;
const chargeState = (c: Row) => (c.paid_at ? "pagato" : c.due_date < today() ? "scaduto" : "da_pagare");

let clients: Row[] = [];
// "owner" sees everything; "team" only Clienti and Video, without money.
let role = "owner";
const isTeam = () => role === "team";
const clientName = (id: number) => clients.find((c) => c.id === id)?.name ?? "—";
const clientLink = (id: number) => `<a href="#/cliente/${id}">${esc(clientName(id))}</a>`;
const clientLinks = (ids: number[] = []) => ids.map(clientLink).join(", ") || "—";
const clientOptions = (): [string, string][] => clients.map((c) => [String(c.id), c.name]);

// ---- forms -------------------------------------------------------------------

const clientFields = (): Field[] => [
  { name: "name", label: "Nome del locale / cliente", required: true },
  { name: "status", label: "Stato", type: "select", options: Object.entries(STATUS) },
  { name: "categories", label: "Categorie", type: "checks", options: Object.entries(CATEGORY), hint: "Anche più di una" },
  { name: "fee", label: "Canone semestrale / del periodo (€)", type: "money", hint: "Il totale di ogni rata: per il semestrale, il prezzo dei 6 mesi" },
  { name: "fee_month", label: "Oppure canone mensile (€)", type: "money", hint: "Se scrivi qui, il canone del periodo diventa mensile × mesi del pagamento" },
  { name: "videos_per_month", label: "Video al mese", type: "number", min: 0, max: 100, hint: "Il pacchetto: di solito 6 (2 per Instagram, Facebook e TikTok)" },
  { name: "billing_every", label: "Pagamento", type: "select", options: Object.entries(EVERY), hint: "Una rata pari al canone all'inizio di ogni periodo: il CRM la crea da sola" },
  { name: "billing_day", label: "Giorno di pagamento", type: "number", min: 1, max: 28 },
  { name: "start_date", label: "Inizio contratto", type: "date" },
  { name: "end_date", label: "Fine contratto", type: "date", hint: "Il cliente la vede nella sua area" },
  { name: "contact", label: "Referente", hint: "Nome della persona: l'area clienti la saluta così" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Telefono / WhatsApp", type: "tel" },
  { name: "instagram", label: "Instagram del locale" },
  { name: "tiktok", label: "TikTok del locale" },
  { name: "vat", label: "P.IVA / Codice fiscale" },
  { name: "notes", label: "Note", type: "textarea" },
];
// A new video can go out on several platforms at once, one link each: it is
// saved as one video per platform (each has its own numbers). Editing touches
// one platform's video.
const newVideoFields = (): Field[] => [
  { name: "client_ids", label: "Clienti nel video", type: "checks", options: clientOptions(), required: true, hint: "Spunta tutti i locali che compaiono nel video: lo vedranno tutti nella loro area" },
  { name: "links", label: "Piattaforme e link", type: "links", options: Object.entries(PLATFORM), required: true, hint: "Spunta dove è uscito il video e incolla il link di ognuno" },
  { name: "published_on", label: "Pubblicato il", type: "date", required: true },
  { name: "title", label: "Titolo", required: true, hint: "Lo scrivi tu: è il nome con cui il cliente vede il video" },
];
const videoFields = (): Field[] => [
  { name: "client_ids", label: "Clienti nel video", type: "checks", options: clientOptions(), required: true, hint: "Spunta tutti i locali che compaiono nel video: lo vedranno tutti nella loro area" },
  { name: "platform", label: "Piattaforma", type: "select", options: Object.entries(PLATFORM), required: true },
  { name: "url", label: "Link del video", type: "url", required: true, hint: "Il link pubblico del reel / video / TikTok" },
  { name: "published_on", label: "Pubblicato il", type: "date", required: true },
  { name: "title", label: "Titolo", required: true, hint: "Lo scrivi tu: è il nome con cui il cliente vede il video" },
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
const DOC = { contratto: "Contratto", fattura: "Fattura", altro: "Altro" } as Record<string, string>;
const documentFields = (withFile: boolean): Field[] => [
  { name: "client_id", label: "Cliente", type: "select", options: clientOptions(), required: true },
  ...(withFile ? [{ name: "file", label: "File (PDF o immagine, max 25 MB)", type: "file", required: true } as Field] : []),
  { name: "kind", label: "Tipo", type: "select", options: Object.entries(DOC) },
  { name: "name", label: "Titolo", hint: withFile ? "Vuoto = nome del file. Es. «Fattura n. 12/2026»" : undefined },
  { name: "doc_date", label: "Data", type: "date" },
  { name: "amount", label: "Importo (€, solo fatture)", type: "money" },
];
// A promo sold on the pages: its price goes into the month's revenue, its
// cost (the people paid to make it) comes off it.
const promoFields = (): Field[] => [
  { name: "venue", label: "Locale / cliente", required: true, list: clients.map((c) => c.name), hint: "Anche chi non ha il pacchetto" },
  { name: "title", label: "Promo", hint: "Es. «Reel apertura nuovo menu»" },
  { name: "date", label: "Data di uscita", type: "date", required: true, hint: "Conta nel fatturato di questo mese" },
  { name: "price", label: "Prezzo (€)", type: "money", required: true },
  { name: "cost", label: "Costo (€)", type: "money", hint: "Quanto paghi i ragazzi per farla" },
  { name: "cost_to", label: "Pagato a", hint: "Chi l'ha fatta" },
  { name: "url", label: "Link al post", type: "url" },
  { name: "paid_at", label: "Incassato il", type: "date", hint: "Vuoto = il locale non ha ancora pagato" },
  { name: "notes", label: "Note", type: "textarea" },
];
const FIELDS: Record<string, (row: Row) => Field[]> = {
  clients: clientFields, videos: videoFields, charges: chargeFields, documents: (row) => documentFields(!row.id), promos: promoFields,
  ugc: () => ugcFields(),
};
const TITLES: Record<string, [string, string]> = {
  clients: ["Nuovo cliente", "Modifica cliente"], videos: ["Nuovo video", "Modifica video"], charges: ["Nuovo addebito", "Modifica addebito"],
  documents: ["Carica documento", "Modifica documento"], promos: ["Nuova promo", "Modifica promo"],
  ugc: ["Candidatura UGC", "Candidatura UGC"],
};
const edit = (table: string, row: Row) =>
  // The categories checkboxes want the list, the record has "key,key".
  form(TITLES[table][row.id ? 1 : 0], table === "videos" && !row.id ? newVideoFields() : FIELDS[table](row),
    table === "clients" ? { ...row, categories: categoriesOf(row), fee_month: row.fee ? perMonth(row) : null } : row, async (d, raw) => {
    // Either price can be typed: a changed monthly one sets the period's.
    if (table === "clients") {
      const { fee_month, ...rest } = d;
      if (fee_month != null && fee_month !== (row.fee ? perMonth(row) : null) && d.fee === (row.fee ?? null)) {
        rest.fee = fee_month * Math.max(Number(d.billing_every) || 1, 1);
      }
      d = rest;
    }
    if (row.id) return api(`${table}/${row.id}`, { method: "PATCH", data: d });
    // One video per ticked platform, same clients, date and title.
    if (table === "videos") {
      const { links, ...shared } = d;
      for (const { platform, url } of links) await api("videos", { method: "POST", data: { ...shared, platform, url } });
      return;
    }
    // A new document travels as a file upload, its details alongside.
    if (table === "documents") {
      for (const [k, v] of Object.entries(d)) raw.set(k, v ?? "");
      return api(table, { method: "POST", body: raw });
    }
    return api(table, { method: "POST", data: d });
  }, render);
const fresh = (table: string, clientId?: number): Row => {
  if (table === "clients") return { status: "attivo", billing_day: 1, billing_every: 6, videos_per_month: 6, start_date: today() };
  if (table === "documents") return { client_id: clientId ?? clients[0]?.id, kind: "contratto", doc_date: today() };
  if (table === "videos") return { client_ids: clientId ? [clientId] : [], platform: "instagram", published_on: today() };
  if (table === "promos") return { date: selected.startsWith(thisMonth()) || selected > thisMonth() ? today() : `${selected}-01` };
  return { client_id: clientId ?? clients[0]?.id, kind: "extra", period: thisMonth(), due_date: today() };
};

// ---- client-area access ------------------------------------------------------

const inviteUrl = (token: string) => `${location.origin}/area-clienti/invito/?t=${token}`;
// The invite, ready to paste into WhatsApp.
async function copyInvite(c: Row, token = c.invite_token) {
  const text = `Ciao! Da oggi trovi i video che pubblichiamo per ${c.name}, le metriche, i documenti e le previsioni nella vostra area riservata RomeSoMuch.\nApri questo link, scrivi nome ed email e ti diamo l'accesso (niente password):\n${inviteUrl(token)}`;
  try {
    await navigator.clipboard.writeText(text);
    say("Invito copiato: incollalo su WhatsApp");
  } catch {
    prompt("Copia l'invito:", text);
  }
}
const addPerson = (clientId: number) =>
  form("Aggiungi persona", [
    { name: "name", label: "Nome" },
    { name: "email", label: "Email", type: "email", required: true, hint: "Riceve subito un'email con il link per entrare (vale 7 giorni)" },
  ], {}, (d) => api("users", { method: "POST", data: { ...d, client_id: clientId } }), render);

const USER = { in_attesa: "In attesa", approvato: "Approvato", rifiutato: "Rifiutato" } as Record<string, string>;
const userActions = (u: Row) => u.status === "in_attesa"
  ? `<button class="btn small primary" data-approve="${u.id}">Approva</button><button class="link danger" data-reject="${u.id}">Rifiuta</button>`
  : `${u.status === "rifiutato" ? `<button class="link" data-approve="${u.id}">Approva</button>` : ""}<button class="link danger" data-remove-user="${u.id}">Rimuovi</button>`;

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

// Everything someone owes, fees and promos alike, in one shape: the
// Pagamenti reminder and the Panoramica list read it. A promo is due the day
// it goes out.
type Due = { kind: "charge" | "promo"; id: number; who: string; what: string; period: string; amount: number; due: string; paid_at: string | null };
const chargeDue = (c: Row): Due => ({
  kind: "charge", id: c.id, who: clientLink(c.client_id), what: esc(c.description || "Canone"), period: c.period,
  amount: c.amount, due: c.due_date, paid_at: c.paid_at,
});
const promoDue = (p: Row): Due => ({
  kind: "promo", id: p.id, who: `<strong>${esc(p.venue)}</strong>`, what: `Promo${p.title ? ` · ${esc(p.title)}` : ""}`,
  period: p.date.slice(0, 7), amount: p.price, due: p.date, paid_at: p.paid_at,
});
// Due by the end of this month: what the reminder asks for. Later instalments
// show up in their own month.
const dueNow = (d: Due) => !d.paid_at && d.period <= thisMonth();
const dueState = (d: Due) => (d.paid_at ? "pagato" : d.due < today() ? "scaduto" : "da_pagare");
const byDue = (a: Due, b: Due) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind);
// The button that flips a fee or a promo between paid and not paid.
const payButton = (d: Due, label = d.paid_at ? "Annulla" : "Segna pagato") =>
  `<button class="btn small${d.paid_at ? "" : " primary"}" ${d.kind === "promo" ? "data-promo-paid" : "data-pay"}="${d.id}" data-paid="${d.paid_at ? 1 : 0}">${label}</button>`;
const dueRows = (dues: Due[]) => dues.map((d) => {
  const state = dueState(d);
  return `<tr class="${state === "scaduto" ? "late" : ""}"><td>${d.who}</td><td>${d.what}</td><td>${esc(month(d.period))}</td>
    <td class="num"><strong>${eur(d.amount)}</strong></td><td>${day(d.due)}</td>
    <td>${badge(state, CHARGE[state])}${d.paid_at ? `<small class="block mute">${day(d.paid_at)}</small>` : ""}</td>
    <td class="row-actions">${payButton(d)}${d.kind === "charge" ? rowActions("charges", d.id) : rowActions("promos", d.id)}</td></tr>`;
});
const dueHeads = ["Chi", "Voce", "Mese", "Importo", "Scadenza", "Stato", ""];

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

// Reminders on the Panoramica can be closed. The choice is remembered in this
// browser; the report reminder is keyed by month, so the next one shows again.
const DISMISSED = "crm-dismissed";
const dismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DISMISSED) ?? "[]"); } catch { return []; }
};
const dismiss = (key: string) => {
  try { localStorage.setItem(DISMISSED, JSON.stringify([...new Set([...dismissed(), key])])); } catch { /* not remembered */ }
};
const notice = (key: string, html: string) => dismissed().includes(key) ? ""
  : `<p class="note warn closable"><span>${html}</span><button type="button" class="close" data-dismiss="${esc(key)}" aria-label="Chiudi avviso">✕</button></p>`;

// Panoramica has two tabs: Generale (how the page is doing with money, fees
// and promos together) and Visibilità costante (the package: clients, videos,
// views). The tab is remembered while the CRM stays open.
let overview: "generale" | "visibilita" = "generale";
const overviewTabs = () => `<nav class="months" aria-label="Panoramica">${[["generale", "Generale"], ["visibilita", "Visibilità costante"]].map(([k, l]) =>
  `<button type="button" data-overview="${k}" class="${k === overview ? "on" : ""}">${l}</button>`).join("")}</nav>`;
async function dashboard() {
  const s = await api(`summary?month=${selected}`);
  return overview === "generale" ? generalView(s) : packageView(s);
}

// The estimate the owner works with: 27% of revenue goes in taxes.
const TAX_RATE = 0.27;
// A client's monthly fee counts in a month while its contract runs then; a
// paused one counts nowhere, a closed one only up to its end date.
const feesIn = (rows: Row[], m: string) => rows.filter((c) =>
  c.fee > 0 && (c.status === "attivo" || (c.status === "concluso" && c.end_date)) &&
  (!c.start_date || c.start_date.slice(0, 7) <= m) && (!c.end_date || c.end_date.slice(0, 7) >= m))
  .reduce((t, c) => t + perMonth(c), 0);

function generalView(s: Row) {
  const promoBy = new Map<string, Row>(s.promoTrend.map((p: Row) => [p.month, p]));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(selected, i - 11)).map((m) => {
    const p = promoBy.get(m) ?? { n: 0, price: 0, cost: 0 };
    const fees = feesIn(s.clients, m);
    const revenue = fees + p.price;
    const taxes = Math.round(revenue * TAX_RATE);
    return { m, fees, promos: p.price, n: p.n, cost: p.cost, revenue, taxes, net: revenue - p.cost - taxes };
  });
  const now = months[11];
  const dues = [...s.unpaid.map(chargeDue), ...s.unpaidPromos.map(promoDue)].filter(dueNow);
  const owed = dues.reduce((t, d) => t + d.amount, 0);
  const cash = s.collected.fees + s.collected.promos;
  const sum = (k: string) => months.reduce((t, r) => t + (r as Row)[k], 0);
  const top = Math.max(1, ...months.map((r) => r.revenue));
  const pct = (part: number) => (now.revenue ? `${Math.round((part / now.revenue) * 100)}%` : "—");

  view.innerHTML = `
    ${head("Panoramica", monthPicker(selected), `Come sta andando la pagina · ${esc(month(selected))}`)}
    ${overviewTabs()}
    <section class="kpis">
      ${kpi("Fatturato del mese", eur(now.revenue), `${eur(now.fees)} canoni + ${eur(now.promos)} promo`)}
      ${kpi("Costi promo", eur(now.cost), `${now.n} promo · pagati a chi le fa`)}
      ${kpi("Tasse stimate", eur(now.taxes), `${Math.round(TAX_RATE * 100)}% del fatturato`)}
      ${kpi("Netto del mese", eur(now.net), `fatturato − costi − tasse · ${pct(now.net)}`, now.net < 0 ? "alert" : "good")}
      ${kpi("Incassato nel mese", eur(cash), `${eur(s.collected.fees)} canoni · ${eur(s.collected.promos)} promo`)}
      ${kpi("Da incassare", eur(owed), dues.length ? `${dues.length} pagamenti aperti · <a href="#/pagamenti">vedi</a>` : "tutti in regola", owed ? "alert" : "")}
    </section>
    <section class="panel"><h2>Fatturato e netto, ultimi 12 mesi</h2>
      <div class="totals">
        <div><span>Fatturato 12 mesi</span><strong>${eur(sum("revenue"))}</strong></div>
        <div><span>di cui promo</span><strong>${eur(sum("promos"))}</strong></div>
        <div><span>Costi promo</span><strong>${eur(sum("cost"))}</strong></div>
        <div><span>Tasse ${Math.round(TAX_RATE * 100)}%</span><strong>${eur(sum("taxes"))}</strong></div>
        <div><span>Netto 12 mesi</span><strong class="${sum("net") < 0 ? "neg" : "pos"}">${eur(sum("net"))}</strong></div>
      </div>
      <div class="chart">${months.map((r) => `<button type="button" class="col${r.m === selected ? " on" : ""}" data-pick="${r.m}" title="${esc(`${month(r.m)}: fatturato ${eur(r.revenue)} (canoni ${eur(r.fees)}, promo ${eur(r.promos)}), netto ${eur(r.net)}`)}">
        <div class="bars"><div class="stack"><i class="promo" style="height:${(r.promos / top) * 100}%"></i><i class="in" style="height:${(r.fees / top) * 100}%"></i></div>
          <i class="net" style="height:${(Math.max(0, r.net) / top) * 100}%"></i></div>
        <span>${esc(shortMonth(r.m))}</span></button>`).join("")}</div>
      <p class="legend"><i class="in"></i> Canoni <i class="promo"></i> Promo <i class="net"></i> Netto dopo costi e tasse</p>
    </section>
    <section class="panel"><h2>Mese per mese</h2>
      ${table(["Mese", "Canoni", "Promo", "Fatturato", "Costi promo", `Tasse ${Math.round(TAX_RATE * 100)}%`, "Netto"], months.filter((r, i) => r.revenue || months.slice(0, i).some((x) => x.revenue) || r.m === selected).reverse().map((r) =>
        `<tr${r.m === selected ? ' class="on"' : ""}><td>${esc(month(r.m))}</td><td class="num">${eur(r.fees)}</td><td class="num">${r.promos ? `${eur(r.promos)} <small class="mute">${r.n}</small>` : "—"}</td>
         <td class="num"><strong>${eur(r.revenue)}</strong></td><td class="num">${r.cost ? eur(-r.cost) : "—"}</td><td class="num">${eur(-r.taxes)}</td>
         <td class="num ${r.net < 0 ? "neg" : "pos"}"><strong>${eur(r.net)}</strong></td></tr>`), "",
        `<tfoot><tr><td><strong>Totale</strong></td><td class="num">${eur(sum("fees"))}</td><td class="num">${eur(sum("promos"))}</td><td class="num"><strong>${eur(sum("revenue"))}</strong></td>
         <td class="num">${eur(-sum("cost"))}</td><td class="num">${eur(-sum("taxes"))}</td><td class="num ${sum("net") < 0 ? "neg" : "pos"}"><strong>${eur(sum("net"))}</strong></td></tr></tfoot>`)}
      <p class="explain">Canoni: il canone di ogni cliente diviso per i mesi del periodo, nei mesi in cui il contratto è attivo (i clienti in pausa non contano). Promo: nel mese di uscita. Tasse stimate al ${Math.round(TAX_RATE * 100)}% del fatturato.</p>
    </section>`;
}

function packageView(s: Row) {
  const active = s.clients.filter((c: Row) => c.status === "attivo");
  const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  const dues = [...s.unpaid.map(chargeDue), ...s.unpaidPromos.map(promoDue)].filter(dueNow).sort(byDue);
  const outstanding = sum(dues, "amount");
  const late = dues.filter((d) => d.due < s.today);
  const connected = Object.entries(s.connections).filter(([k, v]) => v && k !== "tiktokApp").length;
  const trend = new Map(s.trend.map((t: Row) => [t.month, t]));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth(), i - 11));
  const fees = active.reduce((t: number, c: Row) => t + perMonth(c), 0);

  const rows = s.clients.filter((c: Row) => c.status !== "concluso").map((c: Row) => `<tr>
    <td><a href="#/cliente/${c.id}"><strong>${esc(c.name)}</strong></a>${c.status === "pausa" ? ` ${badge("pausa", "In pausa")}` : ""}</td>
    <td>${quota(c.videos, c.videos_per_month)}</td><td class="num">${num(c.views)}</td><td class="num">${num(c.interactions)}</td>
    <td>${day(c.last_video)}</td><td${c.end_date && c.end_date < addDays(s.today, 30) ? ' class="warn"' : ""}>${day(c.end_date)}</td>
    <td>${c.fee ? (c.paid === null ? '<span class="mute">—</span>' : c.paid ? badge("pagato", "Pagato") : badge("da_pagare", "Da pagare")) : '<span class="mute">—</span>'}</td>
    <td>${c.people ? badge("yes", `${c.people} ${c.people === 1 ? "persona" : "persone"}`) : badge("no", "Nessuno")}</td></tr>`);

  view.innerHTML = `
    ${head("Panoramica", `${monthPicker(selected)}${add("videos", "+ Video")}`, `Visibilità costante · ${esc(month(selected))}`)}
    ${overviewTabs()}
    ${connected ? "" : notice("piattaforme", `Nessuna piattaforma collegata: le metriche vanno inserite a mano. <a href="#/collegamenti">Collega Instagram, Facebook e TikTok →</a>`)}
    ${s.reportsDue ? notice(`report:${addMonths(thisMonth(), -1)}`, `I report di ${esc(month(addMonths(thisMonth(), -1)))} non sono ancora partiti per ${s.reportsDue} ${s.reportsDue === 1 ? "cliente" : "clienti"}. <a href="#/report">Controllali e mandali →</a>`) : ""}
    ${s.requests.length ? `<section class="panel requests"><h2>Richieste d'accesso all'area clienti</h2><ul class="list">${s.requests.map((u: Row) => `<li>
      <div><strong>${esc(u.name || u.email)}</strong><small>${esc(u.email)} · per ${clientLink(u.client_id)} · ${day(u.requested_at)}</small></div>
      <div class="end">${userActions(u)}</div></li>`).join("")}</ul></section>` : ""}
    <section class="kpis">
      ${kpi("Clienti attivi", String(active.length), `${s.clients.length} in totale`)}
      ${kpi("Canoni al mese", eur(fees), "canoni divisi per i mesi del periodo")}
      ${kpi(`Video ${month(selected)}`, String(s.totals.videos), "pubblicati, ognuno contato una volta")}
      ${kpi("Visualizzazioni del mese", short(s.totals.views), `${num(s.totals.interactions)} interazioni`)}
      ${kpi("Da incassare", eur(outstanding), late.length ? `${late.length} in ritardo` : "nessun ritardo", late.length ? "alert" : "")}
    </section>
    <section class="panel"><h2>Clienti del pacchetto · ${esc(month(selected))}</h2>
      ${table(["Cliente", "Video del mese", "Visualizzazioni", "Interazioni", "Ultimo video", "Fine contratto", "Canone in corso", "Area clienti"], rows, "Nessun cliente ancora. Aggiungilo da Clienti.")}
    </section>
    <section class="panel"><h2>Visualizzazioni per mese <small class="mute">tutti i clienti</small></h2>
      ${bars(months.map((m) => ({ key: m, label: shortMonth(m), value: (trend.get(m) as Row)?.views ?? 0, title: `${month(m)}: ${num((trend.get(m) as Row)?.views ?? 0)} visualizzazioni, ${(trend.get(m) as Row)?.videos ?? 0} video` })), selected, "data-pick")}
    </section>
    <div class="grid2">
      <section class="panel"><h2>Pagamenti da ricevere</h2>
        ${dues.length ? `<ul class="list">${dues.slice(0, 10).map((d) => {
          const state = dueState(d);
          return `<li><div><span>${d.who}</span><small>${d.what} · ${esc(month(d.period))} · scade ${day(d.due)}</small></div>
            <div class="end"><strong>${eur(d.amount)}</strong>${badge(state, CHARGE[state])}${payButton(d, "Pagato")}</div></li>`;
        }).join("")}</ul>${dues.length > 10 ? `<a class="more" href="#/pagamenti">Tutti i ${dues.length} →</a>` : ""}` : '<p class="empty">Tutti in regola.</p>'}
      </section>
      <section class="panel"><h2>Ultimi video</h2>
        ${s.recent.length ? `<ul class="list">${s.recent.map((v: Row) => `<li><div><span>${clientLinks(v.client_ids)}</span><small>${platform(v.platform)} ${day(v.published_on)} · <a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title || "apri")}</a></small></div>
          <div class="end"><strong>${short(v.views)}</strong><small class="mute">views</small></div></li>`).join("")}</ul>` : '<p class="empty">Nessun video ancora.</p>'}
      </section>
    </div>`;
}

async function teamClientsView() {
  const rows = clients.filter(inCategory).map((c) => `<tr><td><a href="#/cliente/${c.id}"><strong>${esc(c.name)}</strong></a><div class="cats-row">${categoryTags(c)}</div></td>
    <td>${badge(c.status, STATUS[c.status])}</td><td>${quota(c.videos_month, c.videos_per_month)}</td><td>${day(c.end_date)}</td><td>${esc(c.contact ?? "")}</td></tr>`);
  view.innerHTML = `${head("Clienti")}${categoryFilter(clients)}
    <section class="panel">${table(["Cliente", "Stato", `Video di ${month(thisMonth())}`, "Fine contratto", "Referente"], rows, "Nessun cliente.")}</section>`;
}

async function clientsView() {
  if (isTeam()) return teamClientsView();
  const s = await api(`summary?month=${thisMonth()}`);
  const rows = s.clients.filter(inCategory).map((c: Row) => `<tr><td><a href="#/cliente/${c.id}"><strong>${esc(c.name)}</strong></a><div class="cats-row">${categoryTags(c)}</div></td>
    <td>${badge(c.status, STATUS[c.status])}</td><td class="num">${eur(c.fee)}<small class="block mute">${esc((EVERY[c.billing_every] ?? "").toLowerCase())}</small></td><td>${quota(c.videos, c.videos_per_month)}</td><td>${day(c.end_date)}</td>
    <td class="num ${c.outstanding ? "warn" : ""}">${eur(c.outstanding)}</td><td>${c.people ? badge("yes", String(c.people)) : badge("no", "—")}${c.pending ? ` ${badge("da_pagare", `${c.pending} in attesa`)}` : ""}</td></tr>`);
  view.innerHTML = `${head("Clienti", add("clients", "+ Nuovo cliente"))}${categoryFilter(s.clients)}
    <section class="panel">${table(["Cliente", "Stato", "Canone", `Video di ${month(thisMonth())}`, "Fine contratto", "Da incassare", "Area clienti"], rows, "Nessun cliente. Aggiungi il primo.")}</section>`;
}

// The team's client page: details and videos, nothing about money or access.
async function teamClientView(c: Row) {
  const videos = await api<Row[]>(`videos?client_id=${c.id}`);
  const now = videos.filter((v) => v.published_on.startsWith(thisMonth()));
  const views = (rows: Row[]) => rows.reduce((t, v) => t + (v.views ?? 0), 0);
  const info: [string, string][] = [
    ["Categorie", categoryTags(c) || "—"],
    ["Video al mese", String(c.videos_per_month)],
    ["Contratto", `dal ${day(c.start_date)}${c.end_date ? ` al ${day(c.end_date)}` : ""}`],
    ["Referente", esc(c.contact ?? "—")],
    ["Telefono", c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "—"],
    ["Instagram", esc(c.instagram ?? "—")],
    ["TikTok", esc(c.tiktok ?? "—")],
  ];
  view.innerHTML = `<p class="crumb"><a href="#/clienti">← Clienti</a></p>
    ${head(`${esc(c.name)} ${badge(c.status, STATUS[c.status])}`)}
    <section class="kpis">
      ${kpi(`Video di ${month(thisMonth())}`, `${now.length} / ${c.videos_per_month}`, `video fatti nel mese${c.end_date ? ` · contratto fino al ${day(c.end_date)}` : ""}`, c.videos_per_month && now.length >= c.videos_per_month ? "good" : "")}
      ${kpi(`Visualizzazioni ${month(thisMonth())}`, short(views(now)))}
      ${kpi(`Visualizzazioni ${month(addMonths(thisMonth(), -1))}`, short(views(videos.filter((v) => v.published_on.startsWith(addMonths(thisMonth(), -1))))), "mese precedente")}
      ${kpi("Visualizzazioni totali", short(views(videos)), `${videos.length} video`)}
    </section>
    <section class="panel"><h2>Scheda</h2><dl class="info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}</section>
    <section class="panel"><div class="panel-head"><h2>Video</h2><div class="actions"><button class="btn" data-refresh-client="${c.id}">Aggiorna metriche</button>${add("videos", "+ Video", c.id)}</div></div>
      ${table(videoHeads(false), videoRows(videos, false), "Nessun video ancora.")}</section>`;
}

async function clientView(id: number) {
  const c = clients.find((x) => x.id === id);
  if (!c) return void (view.innerHTML = head("Cliente non trovato") + '<p><a href="#/clienti">← Clienti</a></p>');
  if (isTeam()) return teamClientView(c);
  const [videos, charges, docs, people] = await Promise.all([
    api<Row[]>(`videos?client_id=${id}`), api<Row[]>(`charges?client_id=${id}`), api<Row[]>(`documents?client_id=${id}`),
    api<Row[]>(`users?client_id=${id}`),
  ]);
  const now = videos.filter((v) => v.published_on.startsWith(thisMonth()));
  const views = (rows: Row[]) => rows.reduce((t, v) => t + (v.views ?? 0), 0);
  const outstanding = charges.filter((x) => !x.paid_at).reduce((t, x) => t + x.amount, 0);
  const info: [string, string][] = [
    ["Categorie", categoryTags(c) || "—"],
    ["Pacchetto", `${c.videos_per_month} video al mese`],
    ["Canone", feeLine(c)],
    ["Contratto", `dal ${day(c.start_date)}${c.end_date ? ` al ${day(c.end_date)}` : ", fine non indicata"}`],
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
      ${kpi(`Video di ${month(thisMonth())}`, `${now.length} / ${c.videos_per_month}`, `video fatti nel mese${c.end_date ? ` · contratto fino al ${day(c.end_date)}` : ""}`, c.videos_per_month && now.length >= c.videos_per_month ? "good" : "")}
      ${kpi(`Visualizzazioni ${month(thisMonth())}`, short(views(now)))}
      ${kpi(`Visualizzazioni ${month(addMonths(thisMonth(), -1))}`, short(views(videos.filter((v) => v.published_on.startsWith(addMonths(thisMonth(), -1))))), "mese precedente")}
      ${kpi("Visualizzazioni totali", short(views(videos)), `${videos.length} video`)}
      ${kpi("Da incassare", eur(outstanding), "", outstanding ? "alert" : "")}
    </section>
    <div class="grid2">
      <section class="panel"><h2>Scheda</h2><dl class="info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}</section>
      <section class="panel"><div class="panel-head"><h2>Area clienti</h2><button class="btn" data-view="${c.id}">Vedi come cliente</button></div>
        ${c.invite_token
          ? `<p class="mute">Link d'invito privato: chi lo apre chiede l'accesso, tu approvi qui.</p>
             <p class="invite"><code>${esc(inviteUrl(c.invite_token))}</code></p>
             <div class="actions"><button class="btn primary" data-copy-invite="${c.id}">Copia invito per WhatsApp</button><button class="link" data-new-invite="${c.id}">Nuovo link</button></div>`
          : `<p class="mute">Crea il link d'invito e mandalo al locale: chi lo apre chiede l'accesso con nome ed email, tu approvi una volta e resta collegato.</p>
             <div class="actions"><button class="btn primary" data-new-invite="${c.id}">Crea link d'invito</button></div>`}
        <div class="panel-head gap"><h3>Persone</h3><button class="link" data-add-person="${c.id}">+ Aggiungi persona</button></div>
        ${people.length ? `<ul class="list">${people.map((u) => `<li><div><strong>${esc(u.name || u.email)}</strong><small>${esc(u.email)} · ${u.status === "approvato" ? `ultimo accesso ${u.last_seen ? ago(u.last_seen.replace(" ", "T") + "Z") : "mai"}` : `richiesta ${day(u.requested_at)}`}</small></div>
          <div class="end">${badge(u.status === "approvato" ? "yes" : u.status === "in_attesa" ? "da_pagare" : "no", USER[u.status])}${userActions(u)}</div></li>`).join("")}</ul>`
          : '<p class="empty">Ancora nessuno.</p>'}
      </section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Video</h2><div class="actions"><button class="btn" data-refresh-client="${id}">Aggiorna metriche</button>${add("videos", "+ Video", id)}</div></div>
      ${table(videoHeads(false), videoRows(videos, false), "Nessun video ancora.")}</section>
    <section class="panel"><div class="panel-head"><h2>Documenti <small class="mute">il cliente li vede in "I tuoi documenti"</small></h2>${add("documents", "+ Carica", id)}</div>
      ${table(["Documento", "Tipo", "Data", "Importo", ""], docs.map((d) => `<tr><td><a href="/api/crm/files/${d.id}" target="_blank" rel="noopener">${esc(d.name)}</a></td>
        <td>${esc(DOC[d.kind])}</td><td>${day(d.doc_date)}</td><td class="num">${d.amount ? eur(d.amount) : ""}</td><td class="row-actions">${rowActions("documents", d.id)}</td></tr>`),
        "Nessun documento. Carica il contratto e le fatture emesse.")}</section>
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
// Pagamenti: first a reminder of everyone who has not paid yet, from any
// month, fees and promos; under it the chosen month, paid or not.
async function paymentsView() {
  const [charges, promos] = await Promise.all([api<Row[]>("charges"), api<Row[]>("promos")]);
  const all = [...charges.map(chargeDue), ...promos.filter((p) => p.price > 0).map(promoDue)].sort(byDue);
  const open = all.filter(dueNow);
  const later = all.filter((d) => !d.paid_at && !dueNow(d));
  const late = open.filter((d) => d.due < today());
  const total = (rows: Due[]) => rows.reduce((t, d) => t + d.amount, 0);
  const inMonth = all.filter((d) => d.period === selected && (payState === "tutti" || dueState(d) === payState));
  const paid = inMonth.filter((d) => d.paid_at);
  view.innerHTML = `${head("Pagamenti", `<button class="btn" data-charge-month>Genera canoni del mese</button>${add("charges", "+ Addebito")}${add("promos", "+ Promo")}`,
      "Chi deve ancora pagare resta qui finché non lo segni pagato")}
    <section class="kpis">
      ${kpi("Da incassare", eur(total(open)), `${open.length} ${open.length === 1 ? "pagamento aperto" : "pagamenti aperti"}`, open.length ? "alert" : "")}
      ${kpi("Scaduti", eur(total(late)), late.length ? `${late.length} in ritardo` : "nessun ritardo", late.length ? "alert" : "")}
      ${kpi("Promo da incassare", eur(total(open.filter((d) => d.kind === "promo"))), `${open.filter((d) => d.kind === "promo").length} promo`)}
    </section>
    <section class="panel"><h2>Da pagare <small class="mute">canoni e promo fino a ${esc(month(thisMonth()))}, anche dei mesi passati</small></h2>
      ${open.length ? table(dueHeads, dueRows(open), "") : '<p class="empty">Tutti in regola: nessun pagamento aperto.</p>'}
      ${later.length ? `<p class="explain">Più avanti: ${later.length} ${later.length === 1 ? "rata" : "rate"} per ${eur(total(later))}, ${esc(month(later[0].period))} la prossima. Le trovi scegliendo il mese qui sotto.</p>` : ""}
    </section>
    <section class="panel"><div class="panel-head"><h2>${esc(month(selected))}</h2>
      <div class="filters">${monthPicker(selected)}
        <label>Stato <select data-pay-state>${[["tutti", "Tutti"], ...Object.entries(CHARGE)].map(([k, l]) => `<option value="${k}"${k === payState ? " selected" : ""}>${l}</option>`).join("")}</select></label></div></div>
      <div class="totals"><div><span>Totale</span><strong>${eur(total(inMonth))}</strong></div><div><span>Pagato</span><strong>${eur(total(paid))}</strong></div><div><span>Da pagare</span><strong class="${total(inMonth) - total(paid) ? "warn" : ""}">${eur(total(inMonth) - total(paid))}</strong></div></div>
      ${table(dueHeads, dueRows(inMonth), "Niente in questo mese con questi filtri.")}
    </section>`;
}

async function promosView() {
  const rows = await api<Row[]>(`promos?month=${selected}`);
  const sum = (k: string) => rows.reduce((t, p) => t + (p[k] ?? 0), 0);
  const [price, cost] = [sum("price"), sum("cost")];
  const open = rows.filter((p) => !p.paid_at).reduce((t, p) => t + p.price, 0);
  view.innerHTML = `${head("Promo", add("promos", "+ Promo"), "Promo vendute fuori dal pacchetto: il prezzo entra nel fatturato del mese, il costo è quanto paghi chi la fa")}
    <div class="filters">${monthPicker(selected)}</div>
    <section class="panel">
      <div class="totals"><div><span>Promo</span><strong>${rows.length}</strong></div><div><span>Fatturato</span><strong>${eur(price)}</strong></div>
        <div><span>Costi</span><strong>${eur(cost)}</strong></div><div><span>Margine</span><strong class="${price - cost < 0 ? "neg" : ""}">${eur(price - cost)}</strong></div>
        <div><span>Da incassare</span><strong class="${open ? "warn" : ""}">${eur(open)}</strong></div></div>
      ${table(["Data", "Locale", "Promo", "Prezzo", "Costo", "Margine", "Incasso", ""], rows.map((p) => `<tr>
        <td>${day(p.date)}</td><td><strong>${esc(p.venue)}</strong></td>
        <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title || "Apri post")}</a>` : esc(p.title ?? "")}${p.notes ? `<small class="block mute">${esc(p.notes)}</small>` : ""}</td>
        <td class="num">${eur(p.price)}</td><td class="num">${eur(p.cost)}${p.cost_to ? `<small class="block mute">${esc(p.cost_to)}</small>` : ""}</td>
        <td class="num${p.price - p.cost < 0 ? " neg" : ""}"><strong>${eur(p.price - p.cost)}</strong></td>
        <td>${p.paid_at ? `${badge("pagato", "Incassato")}<small class="block mute">${day(p.paid_at)}</small>` : badge("da_pagare", "Da incassare")}</td>
        <td class="row-actions"><button class="btn small${p.paid_at ? "" : " primary"}" data-promo-paid="${p.id}" data-paid="${p.paid_at ? 1 : 0}">${p.paid_at ? "Annulla" : "Incassata"}</button>${rowActions("promos", p.id)}</td></tr>`),
      `Nessuna promo in ${month(selected)}.`)}
    </section>`;
}

// ---- UGC applications --------------------------------------------------------

// Sent from the site's /ugc/ form; the CRM only adds a status, a 1–5 rating and notes.
const UGC_STATUS = {
  nuovo: "Nuovo", contattato: "Contattato", confermato: "Shooting confermato", completato: "Ha postato", scartato: "Scartato",
} as Record<string, string>;
// The form's follower bands, smallest first: their order is what "at least" compares.
const FOLLOWERS = ["Under 5k", "5k–20k", "20k–100k", "100k–500k", "Over 500k"];
const NICHES = ["Travel", "Food", "Lifestyle", "Couples", "Family", "Luxury", "Other"];
const RIGHTS = { "Reposts on RomeSoMuch channels": "Repost sui nostri canali", "Reposts and paid ads": "Repost e ads a pagamento", "To discuss": "Da discutere" } as Record<string, string>;
const INTEREST = { Experiences: "Esperienze", Restaurants: "Ristoranti", Both: "Entrambi" } as Record<string, string>;
const ugcFields = (): Field[] => [
  { name: "status", label: "Stato", type: "select", options: Object.entries(UGC_STATUS) },
  { name: "rating", label: "Voto", type: "select", options: [["", "—"], ["5", "5 · da prendere subito"], ["4", "4"], ["3", "3"], ["2", "2"], ["1", "1 · non fa per noi"]] },
  { name: "notes", label: "Note", type: "textarea", hint: "Visibili solo nel CRM" },
];

// The page's filters; kept while moving around the CRM.
const ugcFilter = { q: "", status: "aperti", followers: "", niche: "", interest: "", rights: "", when: "", tiktok: false, sort: "recenti" };
let ugcRows: Row[] = [];

const band = (u: Row) => FOLLOWERS.indexOf(u.followers);
// "15k", "15.000", "1,2M" → a number, for sorting by views; text it cannot read counts as 0.
const viewsOf = (u: Row) => {
  const m = String(u.views ?? "").toLowerCase().replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)(k|m)?/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/[.,](\d{3})$/, "$1").replace(",", "."));
  return n * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1);
};
// In Rome at some point between two days (inclusive).
const inRome = (u: Row, from: string, to: string) => !!u.arrival && u.arrival <= to && (u.departure || u.arrival) >= from;
const ugcWhen: Record<string, [string, (u: Row) => boolean]> = {
  ora: ["A Roma adesso", (u) => inRome(u, today(), today())],
  "30": ["A Roma nei prossimi 30 giorni", (u) => inRome(u, today(), addDays(today(), 30))],
  futuri: ["Arrivano più avanti", (u) => (u.arrival ?? "") > today()],
  passati: ["Già ripartiti", (u) => !!u.departure && u.departure < today()],
};
const matchesUgc = (u: Row) => {
  const f = ugcFilter;
  if (f.status === "aperti" ? ["scartato", "completato"].includes(u.status) : f.status && u.status !== f.status) return false;
  if (f.followers && band(u) < Number(f.followers)) return false;
  if (f.niche && u.niche !== f.niche) return false;
  // Someone who wants both fits either search.
  if (f.interest && u.interest !== f.interest && u.interest !== "Both") return false;
  if (f.rights && u.rights !== f.rights) return false;
  if (f.when && !ugcWhen[f.when][1](u)) return false;
  if (f.tiktok && !u.tiktok) return false;
  if (f.q) {
    const text = [u.name, u.email, u.country, u.instagram, u.tiktok, u.languages, u.message, u.notes, u.party].join(" ").toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((word) => text.includes(word))) return false;
  }
  return true;
};
const UGC_SORT: Record<string, [string, (a: Row, b: Row) => number]> = {
  recenti: ["Più recenti", (a, b) => b.created_at.localeCompare(a.created_at)],
  follower: ["Più follower", (a, b) => band(b) - band(a) || viewsOf(b) - viewsOf(a)],
  views: ["Più views", (a, b) => viewsOf(b) - viewsOf(a)],
  voto: ["Voto più alto", (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || band(b) - band(a)],
  arrivo: ["Arrivo più vicino", (a, b) => (a.arrival ?? "9999").localeCompare(b.arrival ?? "9999")],
};

// A handle or a pasted profile link, as a link to the profile. Only web addresses become links.
const profile = (value: string | null, base: string, label: string) => {
  if (!value) return "";
  const text = value.trim();
  const href = /^https?:\/\/\S+$/i.test(text) ? text : /^@?[\w.]+$/.test(text) ? `${base}${text.replace(/^@/, "")}` : "";
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span class="mute">${label}: ${esc(text)}</span>`;
};
// Free text where people paste links: the links become clickable, the rest stays text.
const linkify = (text: string | null) => esc(text ?? "").replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
const stay = (u: Row) => (u.arrival ? `${day(u.arrival)}${u.departure && u.departure !== u.arrival ? ` → ${day(u.departure)}` : ""}` : "—");

const ugcRow = (u: Row) => {
  const details: [string, string][] = ([
    ["Lavori migliori", linkify(u.portfolio)], ["Cosa consegnerebbe", esc(u.deliverables ?? "")], ["Chi viene", esc(u.party ?? "")],
    ["Lingue", esc(u.languages ?? "")], ["Messaggio", esc(u.message ?? "")], ["Note nostre", esc(u.notes ?? "")],
  ] as [string, string][]).filter(([, v]) => v);
  return `<tr>
    <td><strong>${esc(u.name)}</strong><small class="block mute">${esc(u.country ?? "")}${u.country ? " · " : ""}<a href="mailto:${esc(u.email)}">${esc(u.email)}</a></small>
      <small class="block">${[profile(u.instagram, "https://www.instagram.com/", "Instagram"), profile(u.tiktok, "https://www.tiktok.com/@", "TikTok")].filter(Boolean).join(" · ")}</small>
      ${details.length ? `<details class="ugc-more"><summary>Dettagli</summary><dl>${details.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></details>` : ""}</td>
    <td>${esc(u.followers ?? "—")}<small class="block mute">${u.views ? `${esc(u.views)} views` : ""}</small></td>
    <td>${esc(u.niche ?? "—")}<small class="block mute">${esc(INTEREST[u.interest] ?? u.interest ?? "")}</small></td>
    <td>${stay(u)}</td>
    <td><small>${esc(RIGHTS[u.rights] ?? u.rights ?? "—")}</small></td>
    <td>${badge(`ugc-${u.status}`, UGC_STATUS[u.status] ?? u.status)}${u.rating ? `<small class="block">${"★".repeat(u.rating)}<span class="mute">${"★".repeat(5 - u.rating)}</span></small>` : ""}
      <small class="block mute">ricevuta ${day(u.created_at)}</small></td>
    <td class="row-actions">${rowActions("ugc", u.id)}</td></tr>`;
};
function drawUgc() {
  const rows = ugcRows.filter(matchesUgc).sort(UGC_SORT[ugcFilter.sort][1]);
  document.getElementById("ugc-list")!.innerHTML = `<p class="sub">${rows.length} di ${ugcRows.length} candidature</p>` +
    table(["Creator", "Follower", "Nicchia", "A Roma", "Diritti", "Stato", ""], rows.map(ugcRow), "Nessuna candidatura con questi filtri.");
}

async function ugcView() {
  ugcRows = await api<Row[]>("ugc");
  const f = ugcFilter;
  const select = (key: string, label: string, options: [string, string][]) =>
    `<label>${label} <select data-ugc="${key}">${options.map(([k, l]) => `<option value="${esc(k)}"${String((f as Row)[key]) === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const soon = ugcRows.filter((u) => u.status !== "scartato" && ugcWhen["30"][1](u)).length;
  view.innerHTML = `${head("UGC", "", "Le candidature dal modulo romesomuch.com/ugc/: filtra per trovare i creator giusti")}
    <div class="kpis">
      ${kpi("Candidature", num(ugcRows.length))}
      ${kpi("Da guardare", num(ugcRows.filter((u) => u.status === "nuovo").length), "stato Nuovo", ugcRows.some((u) => u.status === "nuovo") ? "warn" : "")}
      ${kpi("A Roma nei prossimi 30 giorni", num(soon), "esclusi gli scartati")}
      ${kpi("Shooting confermati", num(ugcRows.filter((u) => u.status === "confermato").length))}
    </div>
    <section class="panel">
      <div class="filters">
        <label>Cerca <input type="search" data-ugc="q" value="${esc(f.q)}" placeholder="Nome, profilo, paese, lingua…" /></label>
        ${select("status", "Stato", [["aperti", "Da gestire (no scartati né conclusi)"], ["", "Tutti"], ...Object.entries(UGC_STATUS)])}
        ${select("followers", "Follower almeno", [["", "Qualsiasi"], ...FOLLOWERS.map((b, i) => [String(i), b] as [string, string]).slice(1)])}
        ${select("niche", "Nicchia", [["", "Tutte"], ...NICHES.map((n) => [n, n] as [string, string])])}
        ${select("interest", "Vuole provare", [["", "Qualsiasi"], ["Experiences", "Esperienze"], ["Restaurants", "Ristoranti"]])}
        ${select("rights", "Diritti sui contenuti", [["", "Qualsiasi"], ...Object.entries(RIGHTS)])}
        ${select("when", "Quando a Roma", [["", "Sempre"], ...Object.entries(ugcWhen).map(([k, [l]]) => [k, l] as [string, string])])}
        ${select("sort", "Ordina per", Object.entries(UGC_SORT).map(([k, [l]]) => [k, l] as [string, string]))}
        <label class="check"><input type="checkbox" data-ugc="tiktok"${f.tiktok ? " checked" : ""} /> Ha TikTok</label>
      </div>
      <div id="ugc-list"></div>
    </section>`;
  drawUgc();
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

// Monthly recap emails: a preview of each client's email, then nothing goes
// out until the agency presses Manda. One request per client keeps each send
// small and shows progress.
let reportMonth = addMonths(thisMonth(), -1);
let reports: Row[] = [];
async function reportsView() {
  // The reminder email links here with ?mese=YYYY-MM.
  const asked = new URLSearchParams(location.hash.split("?")[1] ?? "").get("mese");
  if (asked && /^\d{4}-\d{2}$/.test(asked)) {
    reportMonth = asked;
    history.replaceState(null, "", "#/report");
  }
  reports = await api<Row[]>(`reports?month=${reportMonth}`);
  const due = reports.filter((r) => !r.sent_at && r.people.length);
  const rows = reports.map((r) => {
    const change = r.before.views ? Math.round(((r.month.views - r.before.views) / r.before.views) * 100) : null;
    return `<tr><td><a href="#/cliente/${r.id}"><strong>${esc(r.name)}</strong></a></td>
      <td class="num">${r.month.videos}</td>
      <td class="num">${num(r.month.views)}${change === null ? "" : ` <small class="${change >= 0 ? "pos" : "neg"}">${change > 0 ? "+" : ""}${change}%</small>`}</td>
      <td class="num">~${num(Math.round(r.month.views / 5000))}</td>
      <td>${r.people.length ? r.people.map((p: Row) => esc(p.name || p.email)).join(", ") : '<span class="mute">nessuno con accesso</span>'}</td>
      <td>${r.sent_at ? badge("pagato", `Inviato ${day(r.sent_at.slice(0, 10))}`) : r.people.length ? badge("da_pagare", "Da inviare") : '<span class="mute">—</span>'}</td>
      <td class="row-actions"><button class="link" data-preview="${r.id}">Anteprima</button><button class="link" data-copy-report="${r.id}">Copia per WhatsApp</button>${r.people.length ? `<button class="btn small${r.sent_at ? "" : " primary"}" data-send="${r.id}">${r.sent_at ? "Rimanda" : "Manda"}</button>` : ""}</td></tr>`;
  });
  view.innerHTML = `${head("Report mensili", `<label class="inline">Mese <input type="month" data-report-month value="${reportMonth}" /></label>${due.length ? `<button class="btn primary" data-send-all>Manda a tutti (${due.length})</button>` : ""}`,
      "Un'email per ogni persona con accesso all'area clienti, con i numeri del mese. Non parte nulla finché non premi Manda.")}
    <section class="panel">${table(["Cliente", "Video", "Visualizzazioni", "Possibili clienti", "Destinatari", "Stato", ""], rows, "Nessun cliente attivo.")}</section>`;
}

function previewReport(id: number) {
  const r = reports.find((x) => x.id === id);
  if (!r) return;
  const dialog = document.getElementById("dialog") as HTMLDialogElement;
  dialog.innerHTML = `<div class="sheet"><header><h2>Anteprima</h2><button type="button" class="link" data-close aria-label="Chiudi">✕</button></header>
    <div class="fields"><p><small class="mute">A: ${r.people.map((p: Row) => esc(p.email)).join(", ") || "nessuno"}</small><br /><strong>${esc(r.subject)}</strong></p>
    <pre class="mail">${esc(r.preview)}</pre></div>
    <footer><button type="button" class="btn" data-copy-report="${r.id}">Copia per WhatsApp</button><button type="button" class="btn" data-close>Chiudi</button></footer></div>`;
  dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
  dialog.querySelector("[data-copy-report]")!.addEventListener("click", () => copyReport(r.id));
  dialog.showModal();
}

// The recap as a chat message, for a WhatsApp group or a client without area access.
async function copyReport(id: number) {
  const r = reports.find((x) => x.id === id);
  if (!r) return;
  try {
    await navigator.clipboard.writeText(r.whatsapp);
    say("Report copiato: incollalo su WhatsApp");
  } catch {
    prompt("Copia il report:", r.whatsapp);
  }
}

async function sendReports(ids: number[]) {
  let mails = 0;
  let expected = 0;
  for (const [i, id] of ids.entries()) {
    say(`Invio ${i + 1} di ${ids.length}…`);
    const result = await api(`reports`, { method: "POST", data: { client_id: id, month: reportMonth } });
    mails += result.sent;
    expected += result.of ?? 0;
  }
  if (mails < expected) throw new Error(`Inviate ${mails} email su ${expected}: le altre non sono partite, riprova.`);
  return `${mails} email inviate per ${month(reportMonth)}`;
}

// The owner's list of team members: they sign in by emailed link and see
// only Clienti and Video.
async function teamView() {
  const members = await api<Row[]>("team");
  view.innerHTML = `${head("Team", '<button class="btn primary" data-add-member>+ Aggiungi al team</button>',
      "Chi è nel team vede solo Clienti e Video: inserisce i video, niente canoni, pagamenti, documenti, report o accessi.")}
    <section class="panel">${members.length ? `<ul class="list">${members.map((m) => `<li><div><strong>${esc(m.name || m.email)}</strong>
      <small>${esc(m.email)} · ultimo accesso ${m.last_seen ? ago(m.last_seen.replace(" ", "T") + "Z") : "mai"}</small></div>
      <div class="end"><button class="link danger" data-remove-member="${m.id}">Rimuovi</button></div></li>`).join("")}</ul>`
      : '<p class="empty">Nessuno ancora. Aggiungi un membro: riceve un\'email con il link per entrare.</p>'}</section>
    <p class="explain">Per entrare: romesomuch.com/crm/ › "Fai parte del team?" › la sua email › il link che riceve. Resta collegato su quel dispositivo.</p>`;
}
const addMember = () =>
  form("Aggiungi al team", [
    { name: "name", label: "Nome" },
    { name: "email", label: "Email", type: "email", required: true, hint: "Riceve subito un'email con il link per entrare (vale 7 giorni)" },
  ], {}, (d) => api("team", { method: "POST", data: d }), render);

// ---- routing and events ------------------------------------------------------------

async function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => {
    const target = a.getAttribute("href")!.replace(/^#\/?/, "");
    a.classList.toggle("on", target === route || (route === "cliente" && target === "clienti"));
  });
  // The team lands on Video and never opens the owner's pages.
  if (isTeam() && !["clienti", "cliente", "video"].includes(route)) {
    location.hash = "#/video";
    return;
  }
  try {
    clients = await api<Row[]>("clients");
    if (route === "clienti") await clientsView();
    else if (route === "cliente") await clientView(Number(arg));
    else if (route === "video") await videosView();
    else if (route === "pagamenti") await paymentsView();
    else if (route === "promo") await promosView();
    else if (route === "ugc") await ugcView();
    else if (route === "collegamenti") await connectionsView();
    else if (route === "report") await reportsView();
    else if (route === "team") await teamView();
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
const refreshed = (updated: number) => (updated ? `${updated} video aggiornati` : "Niente da aggiornare (piattaforma non collegata o letto da poco)");
// The server reads a dozen videos per request; asking again until nothing is
// left covers them all (a video just read, or just failed, is skipped).
async function refreshEvery(scope: Row) {
  let total = 0;
  for (let round = 0; round < 40; round++) {
    if (round) say(`Aggiornamento in corso: ${total} video finora…`);
    const { updated } = await api<Row>("refresh", { method: "POST", data: scope });
    if (!updated) break;
    total += updated;
  }
  return refreshed(total);
}

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
  } else if (d.overview) {
    overview = d.overview as typeof overview;
    render();
  } else if (d.promoPaid) {
    act(() => api(`promos/${d.promoPaid}`, { method: "PATCH", data: { paid_at: d.paid === "1" ? null : today() } }), d.paid === "1" ? "Segnata da incassare" : "Segnata incassata");
  } else if (d.dismiss) {
    dismiss(d.dismiss);
    el.closest(".note")?.remove();
  } else if ("addMember" in d) {
    addMember();
  } else if (d.removeMember) {
    if (!confirm("Togliere questa persona dal team? Viene scollegata subito.")) return;
    act(() => api(`team/${d.removeMember}`, { method: "DELETE" }), "Rimosso dal team");
  } else if (d.copyReport) {
    copyReport(Number(d.copyReport));
  } else if (d.preview) {
    previewReport(Number(d.preview));
  } else if (d.send) {
    const r = reports.find((x) => x.id === Number(d.send));
    if (!r || !confirm(`Mandare il report di ${month(reportMonth)} a ${r.people.length} ${r.people.length === 1 ? "persona" : "persone"} di ${r.name}?`)) return;
    act(() => sendReports([r.id]), "");
  } else if ("sendAll" in d) {
    const due = reports.filter((r) => !r.sent_at && r.people.length);
    const people = due.reduce((t, r) => t + r.people.length, 0);
    if (!confirm(`Mandare il report di ${month(reportMonth)} a ${people} persone di ${due.length} clienti?`)) return;
    act(() => sendReports(due.map((r) => r.id)), "");
  } else if (d.approve) {
    act(() => api(`users/${d.approve}/approve`, { method: "POST", data: {} }), "Approvato: gli abbiamo mandato l'email per entrare");
  } else if (d.reject) {
    act(() => api(`users/${d.reject}/reject`, { method: "POST", data: {} }), "Richiesta rifiutata");
  } else if (d.removeUser) {
    if (!confirm("Togliere l'accesso a questa persona? Viene scollegata subito da tutti i dispositivi.")) return;
    act(() => api(`users/${d.removeUser}`, { method: "DELETE" }), "Accesso tolto");
  } else if (d.addPerson) {
    addPerson(Number(d.addPerson));
  } else if (d.copyInvite) {
    const c = clients.find((x) => x.id === Number(d.copyInvite));
    if (c) copyInvite(c);
  } else if (d.newInvite) {
    const c = clients.find((x) => x.id === Number(d.newInvite));
    if (!c || (c.invite_token && !confirm("Creare un nuovo link? Quello vecchio smette di funzionare (chi è già dentro resta dentro)."))) return;
    act(async () => {
      const { invite_token } = await api(`clients/${c.id}/invite`, { method: "POST", data: {} });
      await copyInvite(c, invite_token);
      return "Nuovo link creato e copiato";
    }, "");
  } else if (d.view) {
    // Opened before the request so the browser does not block the new tab.
    const tab = window.open("about:blank", "_blank");
    api(`clients/${d.view}/view`, { method: "POST", data: {} })
      .then(() => { if (tab) tab.location.href = "/area-clienti/"; else location.href = "/area-clienti/"; })
      .catch((error) => { tab?.close(); say(error.message, true); });
  } else if (d.refresh) {
    act(async () => refreshed(await api("refresh", { method: "POST", data: { id: Number(d.refresh) } })), "");
  } else if (d.refreshClient) {
    act(() => refreshEvery({ client_id: Number(d.refreshClient) }), "");
  } else if ("refreshAll" in d) {
    act(() => refreshEvery({}), "");
  } else if ("chargeMonth" in d) {
    act(async () => `${(await api("charge-month", { method: "POST", data: { period: selected } })).created} canoni creati per ${month(selected)}`, "");
  } else if ("category" in d) {
    category = d.category ?? "";
    render();
  } else if (d.pick) {
    selected = d.pick;
    render();
  }
});

// The UGC filters redraw only the list, so typing in the search box keeps its focus.
const ugcInput = (event: Event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const key = el.dataset.ugc;
  if (!key) return;
  (ugcFilter as Row)[key] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
  drawUgc();
};
view.addEventListener("input", ugcInput);

view.addEventListener("change", (event) => {
  if ((event.target as HTMLElement).dataset.ugc) return ugcInput(event);
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  if ("month" in el.dataset && el.value) { selected = el.value; render(); }
  else if ("reportMonth" in el.dataset && el.value) { reportMonth = el.value; render(); }
  else if ("videoClient" in el.dataset) { videoClient = el.value; render(); }
  else if ("payState" in el.dataset) { payState = el.value; render(); }
});

export async function start() {
  try {
    role = (await api<Row>("me")).role;
  } catch {
    return;
  }
  if (isTeam()) document.querySelectorAll("[data-owner]").forEach((a) => a.remove());
  addEventListener("hashchange", render);
  render();
}
