// Lost: course materials and the professor's vocabulary.
// Professors upload PDF, PPTX, DOCX or TXT files (or paste notes). Lost pulls the readable text out
// with extract.py, suggests likely terms, and the professor edits the final vocabulary. Only the
// vocabulary is sent to the speech engine, as recognition hints.
//
// Everything is saved in data/ on this computer: course.json (names, vocabulary, file list) and
// data/materials/<id>.txt (extracted text). Uploaded files themselves are not kept.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

let dir, file, matDir, here;
export let course = { name: "", lecture: "", vocab: [], materials: [] };

export function loadCourse(root) {
  here = root;
  dir = path.join(root, "data"); file = path.join(dir, "course.json"); matDir = path.join(dir, "materials");
  fs.mkdirSync(matDir, { recursive: true });
  try { course = { ...course, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch {}
}
function save() { fs.writeFileSync(file, JSON.stringify(course, null, 2)); }

// Terms sent to the speech engine: the professor's own list plus the (edited) terms of every file
// ticked "Use for this lecture". Lines can be "term: meaning"; only the term part is sent.
export function vocabTerms() {
  const lines = [...course.vocab, ...course.materials.filter((m) => m.use).flatMap((m) => m.terms)];
  const seen = new Set();
  return lines.map((l) => l.split(/\s+[-–]\s+|:\s/)[0].trim())
    .filter((t) => t && t.length <= 60 && !t.includes(",") && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 100);
}
const cleanList = (text, max) => {
  const seen = new Set();
  return String(text).split("\n").map((l) => l.trim().slice(0, 200)).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())).slice(0, max);
};

export function setDetails({ name, lecture, vocab }) {
  if (typeof name === "string") course.name = name.trim().slice(0, 120);
  if (typeof lecture === "string") course.lecture = lecture.trim().slice(0, 120);
  if (typeof vocab === "string") course.vocab = cleanList(vocab, 300);
  save();
}

const KINDS = { pdf: "%PDF", pptx: "PK", docx: "PK", txt: null };

// Check the file really is what its name says, then extract text with the Python helper.
export async function addMaterial(name, buf) {
  name = path.basename(String(name || "notes.txt")).replace(/[^\w .()-]/g, "_").slice(0, 120) || "notes.txt";
  const kind = name.split(".").pop().toLowerCase();
  if (!(kind in KINDS)) return { error: "Use a PDF, PPTX, DOCX or TXT file." };
  const magic = KINDS[kind];
  if (magic && buf.subarray(0, magic.length).toString("latin1") !== magic) return { error: `That file doesn't look like a real .${kind} file.` };
  if (kind === "txt" && buf.includes(0)) return { error: "That doesn't look like a text file." };

  const id = crypto.randomBytes(6).toString("hex");
  const tmp = path.join(matDir, `${id}.upload.${kind}`);
  fs.writeFileSync(tmp, buf);
  let info;
  try { info = await extract(tmp, kind); }
  finally { fs.rmSync(tmp, { force: true }); }
  const m = {
    id, name, kind, addedAt: new Date().toISOString(), use: true,
    chars: info.text.length, pages: info.pages, slideTitles: info.titles.length, speakerNotes: info.notes.length,
    scanned: info.scanned, warning: info.warning, terms: info.terms,
  };
  fs.writeFileSync(path.join(matDir, `${id}.txt`), info.text);
  course.materials.push(m); save();
  return { material: m };
}

export function addNotes(text) {
  return addMaterial("pasted notes.txt", Buffer.from(String(text || "").slice(0, 200000), "utf8"));
}

export function updateMaterial(id, { use, terms }) {
  const m = course.materials.find((x) => x.id === id); if (!m) return;
  if (typeof use === "boolean") m.use = use;
  if (typeof terms === "string") m.terms = cleanList(terms, 100);
  save();
}

export function deleteMaterial(id) {
  if (!/^[0-9a-f]{12}$/.test(id)) return;
  course.materials = course.materials.filter((x) => x.id !== id);
  fs.rmSync(path.join(matDir, `${id}.txt`), { force: true });
  save();
}

function extract(filePath, kind) {
  const fail = (warning) => ({ text: "", titles: [], notes: [], pages: 0, scanned: false, warning, terms: [] });
  const py = [path.join(here, ".venv", "bin", "python"), path.join(here, ".venv", "Scripts", "python.exe")].find((f) => fs.existsSync(f));
  if (!py) {
    if (kind !== "txt") return Promise.resolve(fail("Reading PDF, PPTX and DOCX needs the Python setup in the README. Paste the terms instead."));
    return new Promise((ok) => { const text = fs.readFileSync(filePath, "utf8"); ok({ ...fail(""), text }); });
  }
  return new Promise((ok) => {
    const p = spawn(py, [path.join(here, "extract.py"), filePath, kind]);
    let out = "";
    const timer = setTimeout(() => p.kill(), 60000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", () => {}); // pypdf font warnings
    p.on("error", () => ok(fail("Couldn't start the text reader. Transcription still works without this file.")));
    p.on("close", () => {
      clearTimeout(timer);
      try { ok(JSON.parse(out)); } catch { ok(fail("Couldn't read this file. Transcription still works without it.")); }
    });
  });
}
