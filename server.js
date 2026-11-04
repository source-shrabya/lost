// Lost: one professor laptop runs this server, students join from any device on the same Wi-Fi.
// No database: everything lives in memory for one class at a time.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const LOOKBACK = 90;      // seconds before a tap that may hold the confusing part
const TAP_COOLDOWN = 20;  // one student counts once per 20 s, so spamming can't fake a spike
const CLUSTER_GAP = 45;   // taps closer than this belong to the same "lost moment"
const ALERT_SHARE = 0.1;  // professor alert once 10% of the class is lost

const ai = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// ---------- state ----------
let S;
function reset() {
  S = {
    code: Math.random().toString(36).slice(2, 6).toUpperCase(),
    phase: "waiting",          // waiting | live | ended
    startedAt: null,
    lines: [],                 // { t, text }
    students: new Map(),       // id -> { fake }
    taps: [],                  // { id, t }
    lastTap: new Map(),        // id -> t
    report: null,              // { moments, ai, sent }
    stillConfused: new Map(),  // momentIndex -> Set(id)
    unhelpful: new Map(),
  };
}
reset();

const now = () => (S.startedAt ? (Date.now() - S.startedAt) / 1000 : 0);
const realStudents = () => S.students.size;

function lostNow() {
  const t = now();
  return new Set(S.taps.filter((x) => t - x.t <= LOOKBACK).map((x) => x.id));
}

// ---------- server-sent events ----------
const clients = { prof: new Set(), student: new Map() }; // student: res -> id

function profView() {
  const lost = lostNow();
  const joined = realStudents();
  const share = joined ? lost.size / joined : 0;
  return {
    code: S.code, phase: S.phase, elapsed: now(), joined,
    lostCount: lost.size, share, alert: lost.size > 0 && share >= ALERT_SHARE,
    lines: S.lines.slice(-40),
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

function studentView(id) {
  const mine = S.report?.sent
    ? S.report.moments.map((m, i) => ({ ...m, index: i })).filter((m) => m.ids.includes(id))
    : null;
  return {
    phase: S.phase, code: S.code,
    joined: S.students.has(id),
    catchup: mine && mine.map(({ ids, ...m }) => m),
    sent: !!S.report?.sent,
  };
}

function send(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }
function broadcast() {
  const p = profView();
  for (const res of clients.prof) send(res, p);
  for (const [res, id] of clients.student) send(res, studentView(id));
}
setInterval(broadcast, 1000); // keeps "lost now" decaying and elapsed time ticking

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
    return {
      at: fmt(g.start), from: fmt(from), ids,
      count: ids.length, share: Math.min(1, ids.length / joined),
      said: said || "(nothing was transcribed in this window)",
    };
  });
}

async function explain(moments) {
  if (!ai || moments.length === 0) return null;
  const prompt =
`You help a professor and their students after a lecture. Students tapped "I'm lost" at these moments.
For each moment you get the lecture transcript from about 90 seconds before the taps (speech-to-text, may have errors).

${moments.map((m, i) => `Moment ${i} (around ${m.at}, ${m.count} student(s)):\n"""${m.said}"""`).join("\n\n")}

Reply with only JSON, no other text, in this shape:
{"moments":[{"topic":"2-5 words","reteach":"one or two sentences the professor could say next class to re-explain it, plainer than the original","explanation":"3-5 short sentences for a confused student, simple words, one concrete example","question":"one short practice question","answer":"its answer in one sentence"}]}
Keep the same order and count as the moments above.`;
  const base = { model: "claude-opus-5-5", max_tokens: 8000, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] };
  let res;
  try {
    // Server-side fallback: if Opus 5.5 declines, the API retries on another model inside the same call.
    res = await ai.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e?.status !== 400) throw e;
    res = await ai.messages.create(base);
  }
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return json.moments;
}

// ---------- http ----------
function body(req) {
  return new Promise((ok) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } });
  });
}
function json(res, data, code = 200) {
  res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data));
}
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

const routes = {
  "POST /api/start": async () => { if (S.phase === "waiting") { S.phase = "live"; S.startedAt = Date.now(); } return {}; },
  "POST /api/line": async (b) => {
    const text = String(b.text || "").trim().slice(0, 1000);
    if (S.phase === "live" && text) S.lines.push({ t: now(), text });
    return {};
  },
  "POST /api/join": async (b) => {
    if (!b.id || b.code?.toUpperCase() !== S.code) return { ok: false, error: "That code doesn't match this class." };
    S.students.set(b.id, { fake: false });
    return { ok: true };
  },
  "POST /api/tap": async (b) => {
    if (S.phase !== "live") return { counted: false, reason: "Class isn't live." };
    if (!S.students.has(b.id)) return { counted: false, reason: "Join the class first." };
    const t = now(); const last = S.lastTap.get(b.id);
    const counted = last === undefined || t - last >= TAP_COOLDOWN;
    if (counted) { S.taps.push({ id: b.id, t }); S.lastTap.set(b.id, t); }
    const lost = lostNow(); lost.delete(b.id);
    return { counted, others: lost.size };
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
    S.report = { moments, ai: !!ai, aiStatus: ai ? "working" : "off", sent: false };
    broadcast();
    try {
      const extra = await explain(moments);
      if (extra) moments.forEach((m, i) => Object.assign(m, extra[i] || {}));
      S.report.aiStatus = ai ? (extra ? "done" : "failed") : "off";
    } catch (e) {
      console.error("Claude call failed:", e?.message || e);
      S.report.aiStatus = "failed";
    }
    return {};
  },
  "POST /api/send": async () => { if (S.report) S.report.sent = true; return {}; },
  "POST /api/feedback": async (b) => {
    const map = b.kind === "unhelpful" ? S.unhelpful : S.stillConfused;
    if (!map.has(b.index)) map.set(b.index, new Set());
    map.get(b.index).add(b.id);
    return {};
  },
  "POST /api/reset": async () => { reset(); return {}; },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const role = url.searchParams.get("role");
    if (role === "prof") { clients.prof.add(res); send(res, profView()); req.on("close", () => clients.prof.delete(res)); }
    else { const id = url.searchParams.get("id") || ""; clients.student.set(res, id); send(res, studentView(id)); req.on("close", () => clients.student.delete(res)); }
    return;
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) { const out = await handler(await body(req)); json(res, out); broadcast(); return; }

  const page = { "/": "student.html", "/prof": "prof.html" }[url.pathname] || url.pathname.slice(1);
  const file = path.join(here, "public", path.normalize(page).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "text/plain" }); res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  console.log(`\nLost is running.\n`);
  console.log(`  Professor (this laptop, use Chrome):  http://localhost:${PORT}/prof`);
  for (const ip of ips) console.log(`  Students (same Wi-Fi):               http://${ip}:${PORT}`);
  console.log(`\n  Claude explanations: ${ai ? "ON" : "OFF (set ANTHROPIC_API_KEY to turn on)"}\n`);
});
