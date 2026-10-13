// Client documents: the file in KV (CRM_FILES), its details in D1.
import { Invalid, json, values } from "./common.js";

const MAX_BYTES = 25 * 1024 * 1024;
const COLUMNS = { client_id: "i", name: "t", kind: "t", doc_date: "d", amount: "i" };

export async function upload(env, request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Invalid("Manca il file.");
  if (file.size > MAX_BYTES) throw new Invalid("File oltre 25 MB.");
  const row = values(COLUMNS, Object.fromEntries([...form].filter(([k]) => k !== "file")));
  if (!row.client_id) throw new Invalid("Manca il cliente.");
  const key = `doc/${crypto.randomUUID()}`;
  await env.CRM_FILES.put(key, file.stream());
  try {
    const created = await env.CRM_DB.prepare(
      `INSERT INTO documents (client_id, name, kind, doc_date, amount, file_key, file_name, mime, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(row.client_id, row.name || file.name, row.kind ?? "contratto", row.doc_date ?? null, row.amount ?? null,
      key, file.name, file.type || "application/octet-stream", file.size).first();
    return json(created, 201);
  } catch (error) {
    await env.CRM_FILES.delete(key);
    throw error;
  }
}

// `clientId` limits the download to that client's own documents.
export async function download(env, id, clientId) {
  const doc = await env.CRM_DB.prepare("SELECT * FROM documents WHERE id = ?").bind(id).first();
  if (!doc || (clientId && doc.client_id !== clientId)) return json({ error: "Non trovato." }, 404);
  const body = await env.CRM_FILES.get(doc.file_key, "stream");
  if (!body) return json({ error: "File non trovato." }, 404);
  const name = doc.file_name || doc.name;
  return new Response(body, {
    headers: {
      "Content-Type": doc.mime || "application/octet-stream",
      // Shown in the browser (PDFs, images), never run as a page of this site.
      "Content-Disposition": `inline; filename="${name.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

// Files go before rows: once the rows are gone nothing points at them.
export async function removeFiles(env, column, id) {
  const { results } = await env.CRM_DB.prepare(`SELECT file_key FROM documents WHERE ${column} = ?`).bind(id).all();
  await Promise.all(results.map((r) => env.CRM_FILES.delete(r.file_key)));
}
