// Course materials: text extraction, passages with source locations, and retrieval.
//
// A material is one Canvas file/page, one upload, or pasted notes. Its text is split into passages
// ("Slide 4", "Page 2", "Section: Two-dimensional parity") stored in SQLite with an FTS5 index.
// Student-facing retrieval only ever reads passages of materials marked visibility = 'students'
// and never speaker notes (staff_only), so professor-only content can't reach a student answer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { db, one, all, run, now, newId, tx } from "./db.js";

let ROOT = ".";
export function initMaterials(root) { ROOT = root; }

const KINDS = { pdf: "%PDF", pptx: "PK", docx: "PK", txt: null };
export const SUPPORTED = Object.keys(KINDS);
export const MAX_FILE = 15 * 1024 * 1024;

export function kindOf(name) { return String(name).split(".").pop().toLowerCase(); }

// Pull text out of a file. Returns { parts: [{loc, text, staff}], warning, status }.
export async function extractFile(name, buf) {
  const kind = kindOf(name);
  if (!(kind in KINDS)) return { parts: [], status: "unsupported", warning: `Lost reads PDF, PPTX, DOCX and TXT. This is .${kind}.` };
  const magic = KINDS[kind];
  if (magic && buf.subarray(0, magic.length).toString("latin1") !== magic) return { parts: [], status: "error", warning: `This doesn't look like a real .${kind} file.` };
  if (kind === "txt") {
    if (buf.includes(0)) return { parts: [], status: "error", warning: "This doesn't look like a text file." };
    return textResult(chunkText(buf.toString("utf8"), "Notes"));
  }
  const py = [path.join(ROOT, ".venv", "bin", "python"), path.join(ROOT, ".venv", "Scripts", "python.exe")].find((f) => fs.existsSync(f));
  if (!py) return { parts: [], status: "error", warning: "Reading PDF, PPTX and DOCX needs the Python setup in the README (python3 -m venv .venv, then pip install -r requirements.txt)." };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lost-x-"));
  const tmp = path.join(dir, `file.${kind}`);
  fs.writeFileSync(tmp, buf);
  try {
    const out = await new Promise((ok) => {
      const p = spawn(py, [path.join(ROOT, "extract.py"), tmp, kind]);
      let o = "";
      const timer = setTimeout(() => p.kill(), 60000);
      p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", () => {});
      p.on("error", () => ok(null));
      p.on("close", () => { clearTimeout(timer); try { ok(JSON.parse(o)); } catch { ok(null); } });
    });
    if (!out) return { parts: [], status: "error", warning: "Couldn't read this file." };
    const parts = (out.parts?.length ? out.parts : [{ loc: "", text: out.text, staff: false }]).flatMap((p) =>
      chunkText(p.text, p.loc || "Text").map((c) => ({ ...c, staff: !!p.staff })));
    const r = textResult(parts);
    if (out.scanned) return { ...r, status: r.parts.length ? "ok" : "no_text", warning: out.warning };
    return out.warning && !r.parts.length ? { ...r, warning: out.warning } : r;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function textResult(parts) {
  parts = parts.filter((p) => p.text.trim().length >= 3);
  return parts.length ? { parts, status: "ok", warning: "" } : { parts, status: "no_text", warning: "No readable text was found (a scanned PDF needs OCR, which Lost doesn't do)." };
}

// Split long text into passages of about 900 characters at paragraph or sentence breaks.
export function chunkText(text, label = "Part") {
  const clean = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const out = []; let buf = "";
  for (const para of clean.split(/\n\s*\n|\n(?=[A-Z0-9#•\-*])/)) {
    if ((buf + "\n" + para).length > 900 && buf) { out.push(buf); buf = ""; }
    if (para.length > 1400) {
      for (const s of para.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [para]) {
        if ((buf + s).length > 900 && buf) { out.push(buf); buf = ""; }
        buf += s;
      }
    } else buf = buf ? `${buf}\n${para}` : para;
  }
  if (buf) out.push(buf);
  return out.map((t, i) => ({ loc: out.length > 1 ? `${label}, part ${i + 1}` : label, text: t.trim() }));
}

// Canvas page bodies are HTML. Keep headings as separate lines, drop everything else that's markup.
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, "\n\n").trim();
}

export const hashParts = (parts) => crypto.createHash("sha256").update(JSON.stringify(parts.map((p) => [p.loc, p.text, p.staff]))).digest("hex");

// Insert or update one material by (course, source, external type, external id). Returns
// "added" | "updated" | "unchanged". Passages are only rewritten when the text changed.
export function upsertMaterial(m) {
  const existing = one("SELECT * FROM materials WHERE course_id = ? AND source = ? AND external_type = ? AND external_id = ?",
    m.course_id, m.source, m.external_type || "", m.external_id || "");
  const hash = m.parts ? hashParts(m.parts) : "";
  return tx(() => {
    let id = existing?.id, result;
    if (!existing) {
      id = newId(9); result = "added";
      run(`INSERT INTO materials (id, course_id, source, external_type, external_id, title, url, kind, module, visibility, visibility_reason,
           use_in_class, status, warning, content_hash, source_updated_at, synced_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, m.course_id, m.source, m.external_type || "", m.external_id || "", m.title, m.url || "", m.kind || "", m.module || "",
        m.visibility, m.visibility_reason || "", m.use_in_class ?? 1, m.status || "ok", m.warning || "", hash, m.source_updated_at || "", now(), now());
    } else {
      const same = existing.content_hash === hash && existing.status !== "removed" && existing.title === m.title && existing.visibility === m.visibility && existing.module === (m.module || "");
      result = same ? "unchanged" : "updated";
      run(`UPDATE materials SET title = ?, url = ?, kind = ?, module = ?, visibility = ?, visibility_reason = ?, status = ?, warning = ?,
           content_hash = ?, source_updated_at = ?, synced_at = ? WHERE id = ?`,
        m.title, m.url || "", m.kind || "", m.module || "", m.visibility, m.visibility_reason || "", m.status || "ok", m.warning || "",
        hash, m.source_updated_at || "", now(), id);
      if (same) return { id, result };
    }
    if (m.parts) {
      run("DELETE FROM passages WHERE material_id = ?", id);
      const ins = db.prepare("INSERT INTO passages (material_id, course_id, idx, location, staff_only, text) VALUES (?, ?, ?, ?, ?, ?)");
      m.parts.slice(0, 400).forEach((p, i) => ins.run(id, m.course_id, i, String(p.loc || "").slice(0, 80), p.staff ? 1 : 0, p.text.slice(0, 4000)));
    }
    return { id, result };
  });
}

export function removeMaterial(id) { run("DELETE FROM materials WHERE id = ?", id); }

// ---------- retrieval ----------
const STOP = new Set("a an and are as at be but by can do does for from has have how i if in into is it its just me my of on or so that the then there these this to was we what when where which who why will with you your about not".split(" "));

// FTS5 query from free text: quoted tokens joined with OR (quoting keeps user text from being FTS syntax).
export function ftsQuery(text) {
  const words = [...new Set(String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) || [])]
    .map((w) => w.replace(/'/g, "")).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 24);
  return words.length ? words.map((w) => `"${w}"`).join(" OR ") : null;
}

// Passages a student may see, best match first. audience: "student" | "staff".
export function retrieve(courseId, text, { limit = 3, audience = "student", materialIds = null } = {}) {
  const q = ftsQuery(text);
  if (!q) return [];
  const studentOnly = audience === "student";
  const rows = all(`
    SELECT p.id, p.location, p.text, p.material_id, m.title, m.url, m.source, m.visibility, bm25(passages_fts) AS score
    FROM passages_fts JOIN passages p ON p.id = passages_fts.rowid JOIN materials m ON m.id = p.material_id
    WHERE passages_fts MATCH ? AND p.course_id = ? AND m.status = 'ok' AND m.use_in_class = 1
      ${studentOnly ? "AND m.visibility = 'students' AND p.staff_only = 0" : ""}
    ORDER BY score LIMIT 40`, q, courseId);
  const preferred = materialIds?.length ? new Set(materialIds) : null;
  // materials picked for this lecture rank first; at most two passages from one material
  rows.sort((a, b) => (preferred ? (preferred.has(b.material_id) - preferred.has(a.material_id)) : 0) || a.score - b.score);
  const per = new Map(), out = [];
  for (const r of rows) {
    const n = per.get(r.material_id) || 0;
    if (n >= 2) continue;
    per.set(r.material_id, n + 1); out.push(r);
    if (out.length >= limit) break;
  }
  return out.map(({ score, ...r }) => r);
}

export function courseTerms(courseId) {
  const c = one("SELECT terms FROM courses WHERE id = ?", courseId);
  return String(c?.terms || "").split("\n").map((t) => t.split(/:\s/)[0].trim()).filter((t) => t && t.length <= 60).slice(0, 100);
}
