// Lost: one professor laptop runs this server, students join from any device on the same Wi-Fi.
// No database: everything lives in memory for one class at a time.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
// process.loadEnvFile (for .env) needs Node 20.12 or newer; older versions would skip .env silently.
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 20 || (maj === 20 && min < 12)) { console.error(`Lost needs Node.js 20.12 or newer (this is ${process.version}). Install the LTS from nodejs.org.`); process.exit(1); }
// Secrets such as DEEPGRAM_API_KEY live in .env (never committed). Variables set in the terminal win.
try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), ".env")); } catch {}
import { startEngine, engine, newStream, feed, endStream, setTerms } from "./engines.js";
import { loadCourse, course, setDetails, addMaterial, addNotes, updateMaterial, deleteMaterial, vocabTerms, lectureMaterials } from "./course.js";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const LOOKBACK = 90;      // seconds before a tap that may hold the confusing part
const TAP_COOLDOWN = 20;  // one student counts once per 20 s, so spamming can't fake a spike
const CLUSTER_GAP = 45;   // taps closer than this belong to the same "lost moment"
const ALERT_SHARE = 0.1;  // professor alert once 10% of the class is lost

// After-class summaries use Claude Haiku 5.5. Two ways to reach it:
//  - ANTHROPIC_API_KEY in .env: the Anthropic API (paid per call, a fraction of a cent per class).
//  - Otherwise, if Claude Code is installed, its command line (`claude -p`), which runs on the
//    signed-in Claude subscription, so testing and demos cost nothing extra.
// LOST_AI=api|cli|off forces one.
const MODEL = "claude-haiku-5-5";
// Find the claude command on PATH (claude, claude.exe or claude.cmd on Windows).
function findClaude() {
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const n of names) { const f = path.join(dir, n); if (dir && fs.existsSync(f)) return f; }
  }
  return null;
}
const claudeCmd = findClaude();
const want = (process.env.LOST_AI || "").toLowerCase();
const api = process.env.ANTHROPIC_API_KEY && want !== "cli" && want !== "off" ? new Anthropic() : null;
const ai = want === "off" ? null : api ? "api" : claudeCmd && want !== "api" ? "cli" : null;

// ---------- security ----------
// The professor screen and every class-control action need this key. It is printed once in the
// terminal and never sent to students, so someone with the public student link can't control the class.
import crypto from "node:crypto";
import { spawn } from "node:child_process";
const PROF_KEY = process.env.PROF_KEY || crypto.randomBytes(16).toString("hex");
const isProf = (req, url) => {
  const given = req.headers["x-prof-key"] || url.searchParams.get("key") || "";
  return given.length === PROF_KEY.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PROF_KEY));
};
const MAX_BODY = 32 * 1024;       // reject huge request bodies
const MAX_STUDENTS = 300;
const MAX_STREAMS = 400;          // open live connections
const RATE = { perSecond: 15, burst: 40 }; // per visitor
const buckets = new Map();
function allowed(ip) {
  const t = Date.now(); const b = buckets.get(ip) || { tokens: RATE.burst, at: t };
  b.tokens = Math.min(RATE.burst, b.tokens + ((t - b.at) / 1000) * RATE.perSecond); b.at = t;
  buckets.set(ip, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}
setInterval(() => { const t = Date.now(); for (const [ip, b] of buckets) if (t - b.at > 60000) buckets.delete(ip); }, 60000);
// Behind the Cloudflare tunnel every request comes from 127.0.0.1, and Cloudflare sets the real visitor address here.
const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "");
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "permissions-policy": "geolocation=(), payment=(), usb=()",
};
const PROF_ONLY = new Set(["/api/start", "/api/line", "/api/end", "/api/send", "/api/reset", "/api/demo-taps", "/api/demo-students",
  "/api/course", "/api/notes", "/api/material-update", "/api/material-delete", "/api/line-edit"]);
const MAX_UPLOAD = 15 * 1024 * 1024;
const PUBLIC_FILES = new Set(["student.html", "prof.html", "style.css"]);

// ---------- state ----------
let S;
// CLASS_CODE lets a restart keep the code students already have (used once, for the first class).
let codeFromEnv = /^[A-Z0-9]{4}$/.test(process.env.CLASS_CODE || "") ? process.env.CLASS_CODE : null;
const firstCode = () => { const c = codeFromEnv; codeFromEnv = null; return c; };
function reset() {
  S = {
    code: firstCode() || Math.random().toString(36).slice(2, 6).toUpperCase(),
    phase: "waiting",          // waiting | live | ended
    startedAt: null,
    lines: [],                 // { t, text }
    students: new Map(),       // id -> { fake }
    taps: [],                  // { id, t: moment in class, at: when tapped, line }
    lineMarks: new Map(),      // line index -> Set(student id) who pointed at that exact line
    lastTap: new Map(),        // id -> t
    report: null,              // { moments, ai, sent }
    interim: "",               // words of the line the professor is still saying
    stillConfused: new Map(),  // momentIndex -> Set(id)
    unhelpful: new Map(),
  };
}
reset();

const now = () => (S.startedAt ? (Date.now() - S.startedAt) / 1000 : 0);
const realStudents = () => S.students.size;

function lostNow() {
  const t = now();
  return new Set(S.taps.filter((x) => t - (x.at ?? x.t) <= LOOKBACK).map((x) => x.id));
}

// ---------- check-ins ----------
const clients = { student: new Map() }; // student id -> last check-in time

function profView() {
  const lost = lostNow();
  const joined = realStudents();
  const share = joined ? lost.size / joined : 0;
  return {
    code: S.code, phase: S.phase, elapsed: now(), joined,
    lostCount: lost.size, share, alert: lost.size > 0 && share >= ALERT_SHARE,
    lines: linesFrom(S.lines.length - 40),
    // "server" means a speech engine on the server writes the transcript; "browser" means Chrome does
    transcriber: engine.ready ? "server" : "browser",
    transcriberName: engine.ready ? engine.label : "Chrome speech recognition",
    engineStatus: engine.ready ? engine.status : "",
    engineProblem: engine.problem,
    interim: S.interim || "",
    course: { ...course, termsInUse: vocabTerms().length },
    taps: S.taps.map((x) => x.t),
    report: S.report && {
      ...S.report,
      moments: S.report.moments.map(({ ids, ...m }, i) => ({ // never send student ids to the professor
        ...m,
        stillConfused: S.stillConfused.get(i)?.size || 0,
        unhelpful: S.unhelpful.get(i)?.size || 0,
      })),
    },
  };
}

// Transcript lines with their index (so a student can point at one) and how many students marked each.
function linesFrom(start, id) {
  start = Math.max(0, start);
  return S.lines.slice(start).map((l, k) => {
    const marks = S.lineMarks.get(start + k);
    // students get only the words; the professor also sees edits and unsure words
    return id ? { t: l.t, text: l.text, i: start + k, mine: !!marks?.has(id) } : { ...l, i: start + k, marks: marks?.size || 0 };
  });
}

function studentView(id, wantLines) {
  const mine = S.report?.sent
    ? S.report.moments.map((m, i) => ({ ...m, index: i })).filter((m) => m.ids.includes(id))
    : null;
  return {
    phase: S.phase, code: S.code,
    joined: S.students.has(id),
    catchup: mine && mine.map(({ ids, missed, reteach, ...m }) => m), // the professor's notes stay with the professor
    summary: S.report?.sent ? S.report.summary : null,
    // without Claude there is no written summary, so students get the transcript instead
    transcript: S.report?.sent && !S.report.summary ? S.lines.map((l) => ({ t: l.t, text: l.text })) : null,
    sent: !!S.report?.sent,
    // live transcript, only while the student has it open
    lines: wantLines && S.phase === "live" ? linesFrom(S.lines.length - 60, id) : null,
    audio: relay.header ? { id: relay.id, seq: relay.seq } : null,
  };
}

// ---------- professor's sound ----------
// The professor's page uploads its mic in 1-second WebM pieces and students who tap Listen fetch
// them. Going through the server works across any two networks. Piece 0 holds the file header
// every player needs first.
const relay = { id: 0, seq: -1, header: null, pieces: new Map() };
function readRaw(req, limit) {
  return new Promise((ok) => {
    const parts = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { ok(null); req.destroy(); } else parts.push(c); });
    req.on("end", () => ok(Buffer.concat(parts)));
  });
}

// ---------- transcript ----------
// The speech engines live in engines.js, course materials in course.js.
loadCourse(here);
startEngine({
  here, termsFile: path.join(here, "data", "terms.txt"),
  onPartial: (text) => { if (S.phase === "live") S.interim = text.slice(0, 500); },
  onLine: ({ text, wallStart, unsure }) => {
    if (S.phase !== "live" || !text.trim()) return;
    const t = Math.max(0, (wallStart - S.startedAt) / 1000);
    S.lines.push({ t, text: text.trim().slice(0, 1000), ...(unsure?.length ? { unsure: unsure.slice(0, 20) } : {}) });
    S.interim = "";
  },
});
setTerms(vocabTerms());

// Pages check in every second (GET /api/poll). Streams were dropped because the Cloudflare
// tunnel holds back streaming responses.
setInterval(() => { const t = Date.now(); for (const [id, seen] of clients.student) if (t - seen > 60000) clients.student.delete(id); }, 30000);

// ---------- report ----------
function fmt(t) { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

function buildMoments() {
  const taps = [...S.taps].sort((a, b) => a.t - b.t);
  const groups = [];
  for (const tap of taps) {
    const g = groups.at(-1);
    if (g && tap.t - g.end <= CLUSTER_GAP) { g.end = tap.t; g.taps.push(tap); }
    else groups.push({ start: tap.t, end: tap.t, taps: [tap] });
  }
  const joined = Math.max(1, realStudents());
  return groups.map((g) => {
    const ids = [...new Set(g.taps.map((x) => x.id))];
    const from = Math.max(0, g.start - LOOKBACK);
    const said = S.lines.filter((l) => l.t >= from && l.t <= g.end + 5).map((l) => l.text).join(" ");
    // exact sentences students pointed at inside this moment
    const pointed = S.lines.map((l, i) => ({ text: l.text, t: l.t, count: S.lineMarks.get(i)?.size || 0 }))
      .filter((l) => l.count && l.t >= from && l.t <= g.end + 5).map(({ text, count }) => ({ text, count }));
    // plain taps (no line picked): the sentence being said at the tap
    const nearIds = new Map(); // line index -> Set(student id)
    for (const tap of g.taps) {
      if (tap.line != null) continue;
      let i = S.lines.findLastIndex((l) => l.t <= tap.t);
      if (i < 0) i = S.lines.length ? 0 : -1;
      if (i < 0) continue;
      if (!nearIds.has(i)) nearIds.set(i, new Set());
      nearIds.get(i).add(tap.id);
    }
    const near = [...nearIds].sort((a, b) => a[0] - b[0]).map(([i, s]) => ({ text: S.lines[i].text, count: s.size }));
    return {
      at: fmt(g.start), from: fmt(from), ids, pointed, near,
      count: ids.length, share: Math.min(1, ids.length / joined),
      said: said || "(nothing was transcribed in this window)",
    };
  });
}

// One Claude call after class. It reads the whole transcript (plus the course files ticked for this
// lecture) and writes three things: a class summary every student gets, a short "where the class got
// lost" overview for the professor, and for each lost moment what the explanation left out, how to
// re-teach it, and a catch-up for the students who tapped.
async function analyze(moments) {
  if (!ai || S.lines.length === 0) return null;
  const transcript = S.lines.map((l) => `[${fmt(l.t)}] ${l.text}`).join("\n");
  const mats = lectureMaterials();
  const matBlock = mats.files.length
    ? `Course materials the professor uploaded for this lecture${mats.cut ? " (cut short, they were very long)" : ""}:\n` +
      mats.files.map((f) => `<file name="${f.name}">\n${f.text}\n</file>`).join("\n")
    : "No course materials were uploaded.";
  const momentBlock = moments.length
    ? moments.map((m, i) => {
        const marks = [...m.pointed.map((l) => `"${l.text}" (${l.count} pointed at this exact line)`),
                       ...m.near.map((l) => `"${l.text}" (${l.count} tapped while this was being said)`)];
        return `Moment ${i}: around ${m.at}, ${m.count} of ${Math.max(1, realStudents())} students tapped.\n` +
          (marks.length ? `Lines linked to the taps:\n${marks.join("\n")}` : "No specific line was marked.");
      }).join("\n\n")
    : "Nobody tapped \"I'm lost\" in this class.";

  const prompt =
`You help a professor and their students after a lecture. During class, students tapped "I'm lost" in an app.
${course.name ? `Course: ${course.name}. ` : ""}${course.lecture ? `Today's lecture: ${course.lecture}.` : ""}

Lecture transcript (speech-to-text, so some words may be wrong; [m:ss] is time since class started):
<transcript>
${transcript}
</transcript>

${matBlock}

Moments when students got lost:
${momentBlock}

Write for two readers.

For every student: a summary of the whole class in plain words, so someone who drifted off can catch up. Follow the order the professor taught. Stick to what was said; you may use the course materials to fix speech-to-text mistakes in terms, but don't add topics the professor didn't cover.

For the professor, for each lost moment: work out what the explanation was missing right before the students tapped. Look for things like a term used before it was defined, a step skipped, an example missing, two ideas mixed together, or something said too fast. Quote the professor's own words where you can. Be specific and fair: if the transcript is too thin to tell, say so instead of guessing. If the course materials explain the idea in a way the lecture didn't, point to it.

Reply with only JSON, no other text, in this shape:
{"summary":{"overview":"2-3 sentences on what the class covered","points":[{"title":"short heading","text":"2-4 plain sentences"}]},
"profOverview":"2-3 sentences for the professor on where and why the class got lost, or empty string if nobody tapped",
"moments":[{"topic":"2-5 words","missed":"1-3 sentences: what the explanation left out or made hard, quoting the professor","reteach":"one or two sentences the professor could say next class, plainer than the original","explanation":"3-5 short sentences for a confused student, simple words, one concrete example","question":"one short practice question","answer":"its answer in one sentence"}]}
Use 3-8 summary points. Keep "moments" in the same order and count as the moments above (an empty list if there are none).`;
  return JSON.parse(cleanJson(await askClaude(prompt)));
}
const cleanJson = (text) => text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);

async function askClaude(prompt) {
  if (ai === "api") {
    const res = await api.messages.create({
      model: MODEL, max_tokens: 16000, output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined");
    if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
    return res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  // Claude Code in print mode, no tools, run from an empty folder so it reads nothing on this laptop.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lost-ai-"));
  try {
    const out = await new Promise((ok, fail) => {
      // a .cmd file on Windows has to go through the shell, where an empty argument must be quoted
      const viaShell = claudeCmd.endsWith(".cmd");
      const p = spawn(viaShell ? `"${claudeCmd}"` : claudeCmd, ["-p", "--model", MODEL, "--output-format", "json", "--tools", viaShell ? '""' : ""], { cwd, shell: viaShell });
      let o = "", e = "";
      const timer = setTimeout(() => { p.kill(); fail(new Error("claude -p took over 3 minutes")); }, 180000);
      p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d));
      p.on("error", (err) => { clearTimeout(timer); fail(err); });
      p.on("close", (code) => { clearTimeout(timer); code === 0 ? ok(o) : fail(new Error(`claude -p exited ${code}: ${e.slice(0, 300)}`)); });
      p.stdin.end(prompt);
    });
    const r = JSON.parse(out);
    if (r.is_error) throw new Error(`claude -p: ${String(r.result).slice(0, 300)} (if this is about signing in, run \`claude\` once in a terminal and log in)`);
    return r.result;
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

// ---------- http ----------
function body(req) {
  return new Promise((ok) => {
    let d = ""; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { ok(null); req.destroy(); } else d += c; });
    req.on("end", () => { try { const v = JSON.parse(d || "{}"); ok(v && typeof v === "object" ? v : {}); } catch { ok({}); } });
  });
}
function json(res, data, code = 200) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS }); res.end(JSON.stringify(data));
}
const validId = (id) => typeof id === "string" && /^[a-z0-9-]{8,64}$/i.test(id);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

const routes = {
  "POST /api/start": async () => { if (S.phase === "waiting") { S.phase = "live"; S.startedAt = Date.now(); } return {}; },
  "POST /api/line": async (b) => {
    const text = String(b.text || "").trim().slice(0, 1000);
    if (S.phase === "live" && text) S.lines.push({ t: now(), text });
    return {};
  },
  "POST /api/join": async (b) => {
    if (!validId(b.id) || String(b.code || "").toUpperCase() !== S.code) return { ok: false, error: "That code doesn't match this class." };
    if (!S.students.has(b.id) && S.students.size >= MAX_STUDENTS) return { ok: false, error: "This class is full." };
    S.students.set(b.id, { fake: false });
    return { ok: true };
  },
  "POST /api/tap": async (b) => {
    if (S.phase !== "live") return { counted: false, reason: "Class isn't live." };
    if (!S.students.has(b.id)) return { counted: false, reason: "Join the class first." };
    const t = now(); const last = S.lastTap.get(b.id);
    // A student may point at one transcript line; then the moment is when that line was said.
    const line = Number.isInteger(b.line) && S.lines[b.line] ? b.line : null;
    const at = line === null ? t : S.lines[line].t;
    if (line !== null) { if (!S.lineMarks.has(line)) S.lineMarks.set(line, new Set()); S.lineMarks.get(line).add(b.id); }
    const counted = last === undefined || t - last >= TAP_COOLDOWN;
    if (counted) { S.taps.push({ id: b.id, t: at, at: t, line }); S.lastTap.set(b.id, t); }
    const lost = lostNow(); lost.delete(b.id);
    // what was said in the 15 seconds up to that moment, shown to the student right away
    let recent = S.lines.filter((l) => l.t >= at - 15 && l.t <= at + 0.5);
    if (!recent.length) recent = S.lines.filter((l) => l.t <= at + 0.5).slice(-2);
    return { counted: counted || line !== null, others: lost.size, recent };
  },
  "POST /api/demo-taps": async (b) => { // demo mode: fake students, clearly labelled on screen
    const n = Math.min(30, Number(b.n) || 5);
    for (let i = 0; i < n; i++) {
      const id = `demo-${S.students.size}-${i}`;
      S.students.set(id, { fake: true });
      if (S.phase === "live") S.taps.push({ id, t: Math.max(0, now() - Math.random() * 20) });
    }
    return {};
  },
  "POST /api/demo-students": async (b) => {
    const n = Math.min(60, Number(b.n) || 10);
    for (let i = 0; i < n; i++) S.students.set(`demo-s${S.students.size}`, { fake: true });
    return {};
  },
  "POST /api/end": async () => {
    if (S.phase !== "live") return {};
    S.phase = "ended";
    const moments = buildMoments();
    S.report = { moments, ai: !!ai, aiStatus: ai ? "working" : "off", sent: false, summary: null, profOverview: "" };
    try {
      const out = await analyze(moments);
      if (out) {
        if (Array.isArray(out.moments)) moments.forEach((m, i) => Object.assign(m, out.moments[i] || {}));
        if (out.summary && Array.isArray(out.summary.points)) S.report.summary = out.summary;
        S.report.profOverview = typeof out.profOverview === "string" ? out.profOverview : "";
      }
      S.report.aiStatus = ai ? (out ? "done" : S.lines.length ? "failed" : "empty") : "off";
    } catch (e) {
      console.error("Claude call failed:", e?.message || e);
      S.report.aiStatus = "failed";
    }
    return {};
  },
  "POST /api/send": async () => { if (S.report) S.report.sent = true; return {}; },
  "POST /api/feedback": async (b) => {
    if (!S.students.has(b.id) || !Number.isInteger(b.index) || !S.report?.moments[b.index]) return {};
    const map = b.kind === "unhelpful" ? S.unhelpful : S.stillConfused;
    if (!map.has(b.index)) map.set(b.index, new Set());
    map.get(b.index).add(b.id);
    return {};
  },
  "POST /api/reset": async () => { reset(); return {}; },

  // ---- course materials and vocabulary (professor only) ----
  "POST /api/course": async (b) => { setDetails(b); setTerms(vocabTerms()); return {}; },
  "POST /api/notes": async (b) => { const r = await addNotes(b.text); setTerms(vocabTerms()); return r; },
  "POST /api/material-update": async (b) => {
    updateMaterial(String(b.id), { use: typeof b.use === "boolean" ? b.use : undefined, terms: typeof b.terms === "string" ? b.terms : undefined });
    setTerms(vocabTerms()); return {};
  },
  "POST /api/material-delete": async (b) => { deleteMaterial(String(b.id)); setTerms(vocabTerms()); return {}; },
  // Professor fixes a transcript line. The original words are kept next to the fix.
  "POST /api/line-edit": async (b) => {
    const l = S.lines[b.i]; const text = String(b.text || "").trim().slice(0, 1000);
    if (!l || !Number.isInteger(b.i) || !text) return {};
    if (l.original === undefined) l.original = l.text;
    l.text = text; l.edited = new Date().toISOString(); delete l.unsure;
    return {};
  },
};

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://x"); } catch { res.writeHead(400); res.end(); return; }
  const prof = isProf(req, url);
  if (!prof && !allowed(clientIp(req))) { res.writeHead(429, SECURITY_HEADERS); res.end("Slow down"); return; }

  if (url.pathname === "/api/audio") {
    if (req.method === "POST") { // professor uploads one piece
      if (!prof) { json(res, { error: "Professor only" }, 403); return; }
      const buf = await readRaw(req, 512 * 1024);
      if (!buf) { if (!res.headersSent) json(res, { error: "Too large" }, 413); return; }
      if (url.searchParams.get("first") === "1") { relay.id++; relay.header = buf; relay.pieces.clear(); relay.seq = 0; newStream(buf); }
      else if (relay.header) { relay.seq++; relay.pieces.set(relay.seq, buf); relay.pieces.delete(relay.seq - 30); feed(buf); }
      json(res, { seq: relay.seq }); return;
    }
    if (req.method === "DELETE") { if (prof) { relay.header = null; relay.pieces.clear(); relay.seq = -1; endStream(); } json(res, {}); return; }
    // students fetch a piece; only joined students
    const sid = url.searchParams.get("id");
    if (!S.students.has(sid) || !relay.header) { res.writeHead(404, SECURITY_HEADERS); res.end(); return; }
    const n = Number(url.searchParams.get("seq"));
    const piece = n === 0 ? relay.header : relay.pieces.get(n);
    if (!piece) { res.writeHead(404, SECURITY_HEADERS); res.end(); return; }
    res.writeHead(200, { "content-type": "audio/webm", "cache-control": "no-store", ...SECURITY_HEADERS }); res.end(piece); return;
  }

  // Professor uploads a course file: raw bytes, file name in the x-filename header.
  if (url.pathname === "/api/material" && req.method === "POST") {
    if (!prof) { json(res, { error: "Professor only" }, 403); return; }
    const buf = await readRaw(req, MAX_UPLOAD);
    if (!buf) { if (!res.headersSent) json(res, { error: "Files can be up to 15 MB." }, 413); return; }
    let name = ""; try { name = decodeURIComponent(String(req.headers["x-filename"] || "")); } catch {}
    const r = await addMaterial(name, buf); setTerms(vocabTerms());
    json(res, r); return;
  }

  if (url.pathname === "/api/poll" && req.method === "GET") {
    const role = url.searchParams.get("role");
    if (role === "prof") {
      if (!prof) { json(res, { error: "Professor only" }, 403); return; }
      json(res, { state: profView() }); return;
    }
    const id = url.searchParams.get("id");
    if (!validId(id)) { json(res, { error: "Bad id" }, 400); return; }
    if (!clients.student.has(id) && clients.student.size >= MAX_STREAMS) { json(res, { error: "Busy" }, 503); return; }
    clients.student.set(id, Date.now());
    json(res, { state: studentView(id, url.searchParams.get("lines") === "1") }); return;
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    if (PROF_ONLY.has(url.pathname) && !prof) { json(res, { error: "Professor only" }, 403); return; }
    const b = await body(req);
    if (b === null) { if (!res.headersSent) json(res, { error: "Too large" }, 413); return; }
    const out = await handler(b, prof); json(res, out);
    return;
  }
  if (req.method !== "GET") { res.writeHead(405, SECURITY_HEADERS); res.end(); return; }

  // Only these three files are served. The professor page itself is public HTML, but it can't do
  // anything without the key.
  const page = { "/": "student.html", "/prof": "prof.html" }[url.pathname] || url.pathname.slice(1);
  if (!PUBLIC_FILES.has(page)) { res.writeHead(404, SECURITY_HEADERS); res.end("Not found"); return; }
  fs.readFile(path.join(here, "public", page), (err, data) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(page)] || "text/plain", ...SECURITY_HEADERS }); res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  console.log(`\nLost is running.\n`);
  console.log(`  Professor (this laptop, use Chrome, keep this link private):`);
  console.log(`    http://localhost:${PORT}/prof?key=${PROF_KEY}`);
  for (const ip of ips) console.log(`  Students (same Wi-Fi):               http://${ip}:${PORT}`);
  console.log(`\n  Claude summaries: ${ai === "api" ? `ON (${MODEL}, Anthropic API)` : ai === "cli" ? `ON (${MODEL} through Claude Code, free)` : "OFF (install Claude Code and sign in for free summaries, or set ANTHROPIC_API_KEY)"}`);
  console.log(`  Transcript: ${engine.name === "deepgram" ? "Deepgram Nova-3 (audio goes to Deepgram)" : engine.name !== "off" ? `${engine.name}, loading the model (the first start downloads it)…` : `Chrome speech recognition, because ${engine.why}`}`);
  console.log(`  Course terms in use: ${vocabTerms().length}\n`);
});
