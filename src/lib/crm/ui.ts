// Pieces shared by the CRM (app.ts) and the client area (portal.ts):
// formatting, the API call, small HTML builders and the form dialog.

export type Row = Record<string, any>;
export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "url" | "money" | "date" | "month" | "number" | "select" | "textarea" | "password" | "checks" | "file" | "links";
  options?: [string, string][];
  required?: boolean;
  hint?: string;
  list?: string[];
  min?: number;
  max?: number;
};

const money = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const count = new Intl.NumberFormat("it-IT");
const compact = new Intl.NumberFormat("it-IT", { notation: "compact", maximumFractionDigits: 1 });
// `|| 0` also turns -0 into 0.
export const eur = (cents: number | null | undefined) => money.format((cents || 0) / 100);
export const num = (n: number | null | undefined) => (n == null ? "—" : count.format(n));
export const short = (n: number | null | undefined) => (n == null ? "—" : compact.format(n));
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
export const thisMonth = () => today().slice(0, 7);
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (period: string, n: number) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonthFmt = new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" });
export const day = (iso?: string | null) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—");
export const month = (period: string) => monthFmt.format(new Date(`${period}-01T00:00:00Z`));
export const shortMonth = (period: string) => shortMonthFmt.format(new Date(`${period}-01T00:00:00Z`));
export const ago = (iso?: string | null) => {
  if (!iso) return "mai";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min fa`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h fa`;
  return day(iso);
};
export const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// "1.500,50" and "1500.50" both mean €1,500.50.
export const cents = (text: string) => {
  const plain = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Math.round(parseFloat(plain) * 100);
  if (!Number.isFinite(value)) throw new Error(`Importo non valido: ${text}`);
  return value;
};

export const PLATFORM = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" } as Record<string, string>;
export const platform = (p: string) => `<span class="pf pf-${esc(p)}">${esc(PLATFORM[p] ?? p)}</span>`;
export const badge = (key: string, label: string) => `<span class="badge b-${esc(key)}">${esc(label)}</span>`;
export const interactions = (v: Row) => (v.likes ?? 0) + (v.comments ?? 0) + (v.shares ?? 0) + (v.saves ?? 0);

// ---- server --------------------------------------------------------------------

export function apiFor(base: string, login: string) {
  return async function api<T = any>(path: string, init: RequestInit & { data?: unknown } = {}): Promise<T> {
    const { data, ...rest } = init;
    const response = await fetch(`${base}/${path}`, {
      ...rest,
      headers: data !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: data !== undefined ? JSON.stringify(data) : rest.body,
    });
    if (response.status === 401) {
      location.href = login;
      throw new Error("Sessione scaduta.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Errore ${response.status}`);
    return body as T;
  };
}

export function say(message: string, bad = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = bad ? "show bad" : "show";
  clearTimeout((toast as any).timer);
  (toast as any).timer = setTimeout(() => (toast.className = ""), 2600);
}

// ---- HTML builders --------------------------------------------------------------

export const head = (title: string, actions = "", sub = "") =>
  `<div class="head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
export const kpi = (label: string, value: string, note = "", tone = "") =>
  `<div class="kpi ${tone}"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</div>`;
export const table = (heads: string[], rows: string[], empty: string, foot = "") =>
  rows.length
    ? `<div class="scroll"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>${foot}</table></div>`
    : `<p class="empty">${esc(empty)}</p>`;
export const quota = (done: number, promised: number) => {
  if (!promised) return `<small>${done} video</small>`;
  const ratio = Math.min(1, done / promised);
  return `<div class="quota${done >= promised ? " done" : ""}"><div class="track"><div class="fill" style="width:${ratio * 100}%"></div></div><small>${done} / ${promised}</small></div>`;
};
// Bars per month; `on` marks the selected month, `attr` makes columns clickable.
export function bars(items: { key: string; label: string; value: number; title: string }[], on?: string, attr?: string) {
  const top = Math.max(1, ...items.map((i) => i.value));
  const tag = attr ? "button" : "div";
  return `<div class="chart${attr ? "" : " static"}">${items.map((i) => `<${tag} class="col${i.key === on ? " on" : ""}"${attr ? ` type="button" ${attr}="${esc(i.key)}"` : ""} title="${esc(i.title)}">
      <div class="bars"><i class="in" style="height:${(i.value / top) * 100}%"></i></div><span>${esc(i.label)}</span></${tag}>`).join("")}</div>`;
}

// ---- form dialog -------------------------------------------------------------------

function input(f: Field, value: any) {
  const id = `f-${f.name}`;
  const req = f.required ? " required" : "";
  const v = value ?? "";
  let control: string;
  if (f.type === "links") {
    // Several platforms at once, each with its own link: ticking a platform
    // shows its link field (CSS, .link-row:has(:checked)).
    return `<fieldset class="field"><legend>${esc(f.label)}${f.required ? " *" : ""}</legend><div class="link-rows">${f.options!.map(([k, l]) =>
      `<div class="link-row"><label class="check"><input type="checkbox" name="${f.name}" value="${esc(k)}" /> ${esc(l)}</label>
        <input type="url" name="${f.name}_${esc(k)}" placeholder="Link ${esc(l)}" aria-label="Link ${esc(l)}" /></div>`).join("")}</div>${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</fieldset>`;
  }
  if (f.type === "checks") {
    // Several choices at once: `value` is the array of chosen keys.
    const chosen = new Set([].concat(v || []).map(String));
    return `<fieldset class="field"><legend>${esc(f.label)}${f.required ? " *" : ""}</legend><div class="checks">${f.options!.map(([k, l]) =>
      `<label><input type="checkbox" name="${f.name}" value="${esc(k)}"${chosen.has(k) ? " checked" : ""} /> ${esc(l)}</label>`).join("")}</div>${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</fieldset>`;
  }
  if (f.type === "select") {
    control = `<select id="${id}" name="${f.name}"${req}>${f.options!.map(([k, l]) =>
      `<option value="${esc(k)}"${String(v) === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea id="${id}" name="${f.name}" rows="3">${esc(v)}</textarea>`;
  } else if (f.type === "money") {
    control = `<input id="${id}" name="${f.name}" inputmode="decimal" value="${v === "" ? "" : (v / 100).toFixed(2).replace(".", ",")}"${req} />`;
  } else {
    const list = f.list ? ` list="${id}-list"` : "";
    const range = `${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""}`;
    const auto = f.type === "password" ? ' autocomplete="new-password"' : "";
    control = `<input id="${id}" type="${f.type ?? "text"}" name="${f.name}" value="${esc(v)}"${req}${list}${range}${auto} />` +
      (f.list ? `<datalist id="${id}-list">${f.list.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "");
  }
  return `<label for="${id}">${esc(f.label)}${f.required ? " *" : ""}${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`;
}

// Opens a form in the dialog and calls `save` with the typed values; `done`
// runs after a successful save.
export function form(title: string, fields: Field[], values: Row, save: (data: Row, raw: FormData) => Promise<unknown>, done: () => void) {
  const dialog = document.getElementById("dialog") as HTMLDialogElement;
  dialog.innerHTML = `<form method="dialog" class="sheet">
    <header><h2>${esc(title)}</h2><button type="button" class="link" data-close aria-label="Chiudi">✕</button></header>
    <div class="fields">${fields.map((f) => input(f, values[f.name])).join("")}</div>
    <p class="form-error" role="alert"></p>
    <footer><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></footer>
  </form>`;
  const el = dialog.querySelector("form")!;
  dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
  el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = new FormData(el);
    const button = el.querySelector<HTMLButtonElement>("button.primary")!;
    button.disabled = true;
    try {
      const data: Row = {};
      for (const f of fields) {
        if (f.type === "file") continue;
        if (f.type === "links") {
          const labels = new Map(f.options);
          data[f.name] = raw.getAll(f.name).map((k) => ({ platform: String(k), url: String(raw.get(`${f.name}_${k}`) ?? "").trim() }));
          if (f.required && !data[f.name].length) throw new Error(`${f.label}: scegli almeno una piattaforma.`);
          const missing = data[f.name].find((x: Row) => !/^https?:\/\//i.test(x.url));
          if (missing) throw new Error(`Manca il link ${labels.get(missing.platform)} (deve iniziare con https://).`);
          continue;
        }
        if (f.type === "checks") {
          // Ids (clients) are numbers, keys (categories) stay text.
          data[f.name] = raw.getAll(f.name).map((v) => (/^\d+$/.test(String(v)) ? Number(v) : String(v)));
          if (f.required && !data[f.name].length) throw new Error(`${f.label}: scegline almeno uno.`);
          continue;
        }
        const v = raw.get(f.name);
        data[f.name] = f.type === "money" ? (v ? cents(String(v)) : null) : v === null ? null : String(v);
      }
      await save(data, raw);
      dialog.close();
      say("Salvato");
      done();
    } catch (error) {
      el.querySelector(".form-error")!.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  });
  dialog.showModal();
}
