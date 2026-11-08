// Lost: professor and student portal for marking confusion during a lecture and getting unstuck.
// Plain Node http server, SQLite for persistence. See README.md for setup and configuration.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 20 || (maj === 20 && min < 12)) { console.error(`Lost needs Node.js 20.12 or newer (this is ${process.version}).`); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch {}

const { openDb, one, all, run, now, newId, parse, tx, joinCode } = await import("./lib/db.js");
const auth = await import("./lib/auth.js");
const { initAi, aiProvider, aiAvailable, MODEL, AiError } = await import("./lib/ai.js");
const mat = await import("./lib/materials.js");
const canvas = await import("./lib/canvas.js");
const jobs = await import("./lib/jobs.js");
const summary = await import("./lib/summary.js");
const help = await import("./lib/help.js");
const live = await import("./lib/live.js");
const { sessionTheme, courseArt, ART_IDS, ART } = await import("./lib/theme.js");
const { startEngine, engine } = await import("./engines.js");
const { seedDemo, DEMO_USERS, DEMO_PASSWORD } = await import("./lib/seed.js");
const QRCode = (await import("qrcode")).default;

const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.LOST_DATA || path.join(here, "data");
const DEMO = process.env.LOST_DEMO ? process.env.LOST_DEMO === "1" : process.env.NODE_ENV !== "production";
const PROF_SIGNUP_CODE = process.env.PROF_SIGNUP_CODE || "";
const helpBurst = () => Number(process.env.LOST_HELP_BURST) || 12; // AI requests a student can make in a burst

export async function boot({ dbFile = process.env.LOST_DB || path.join(DATA, "lost.db"), listen = true, port = PORT, seed = DEMO, engines = true, jobsAuto = true } = {}) {
  openDb(dbFile, path.join(here, "migrations"));
  auth.loadSecret(DATA);
  canvas.seedInstitutions();
  mat.initMaterials(here);
  initAi();
  if (engines) startEngine({ here, termsFile: path.join(DATA, "terms.txt"), onPartial: live.onEnginePartial, onLine: live.onEngineLine });
  if (seed) await seedDemo();
  live.recoverSessions();
  if (jobsAuto) jobs.startJobs(); else jobs.recoverJobs();
  const gapTimer = setInterval(() => live.checkGaps(), 2000); gapTimer.unref();
  const server = http.createServer(handle);
  if (listen) await new Promise((ok) => server.listen(port, "0.0.0.0", ok));
  return server;
}

// ---------- security ----------
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "permissions-policy": "geolocation=(), payment=(), usb=(), camera=()",
};
const buckets = new Map();
function allowed(key, perSecond = 15, burst = 40) {
  const t = Date.now(); const b = buckets.get(key) || { tokens: burst, at: t };
  b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * perSecond); b.at = t;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.at > 120000) buckets.delete(k); }, 60000).unref();
const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "");
const isHttps = (req) => req.headers["x-forwarded-proto"] === "https" || (process.env.PUBLIC_URL || "").startsWith("https://");

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

function readRaw(req, limit) {
  return new Promise((ok) => {
    const parts = []; let size = 0, over = false;
    req.on("data", (c) => { size += c.length; if (size > limit) { over = true; req.destroy(); } else parts.push(c); });
    req.on("end", () => ok(over ? null : Buffer.concat(parts)));
    req.on("close", () => ok(over ? null : Buffer.concat(parts)));
  });
}
async function readJson(req) {
  const buf = await readRaw(req, 64 * 1024);
  if (!buf) fail(413, "Too large.");
  try { const v = JSON.parse(buf.toString("utf8") || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { fail(400, "Bad JSON."); }
}
function send(res, status, data, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(data));
}

// ---------- access checks (every one runs on the server, per request) ----------
const needUser = (ctx, role) => {
  if (!ctx.session) fail(401, "Please sign in.");
  if (role && ctx.session.user.role !== role) fail(403, role === "professor" ? "Professors only." : "Students only.");
  return ctx.session.user;
};
const ownCourse = (user, id) => one("SELECT * FROM courses WHERE id = ? AND owner_id = ?", String(id), user.id) || fail(404, "Course not found.");
const ownSession = (user, id) => one("SELECT s.* FROM lecture_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = ? AND c.owner_id = ?", String(id), user.id) || fail(404, "Session not found.");
const ownMaterial = (user, id) => one("SELECT m.* FROM materials m JOIN courses c ON c.id = m.course_id WHERE m.id = ? AND c.owner_id = ?", String(id), user.id) || fail(404, "Material not found.");
const enrolledCourse = (user, id) => one("SELECT c.*, sec.id AS section_id, sec.name AS section_name FROM courses c JOIN sections sec ON sec.course_id = c.id JOIN enrollments e ON e.section_id = sec.id WHERE c.id = ? AND e.user_id = ? LIMIT 1", String(id), user.id) || fail(404, "You're not in this course.");
const enrolledSession = (user, id) => one("SELECT s.* FROM lecture_sessions s JOIN enrollments e ON e.section_id = s.section_id WHERE s.id = ? AND e.user_id = ?", String(id), user.id) || fail(404, "You're not in this class.");
const ownEvent = (user, id) => one("SELECT * FROM confusion_events WHERE id = ? AND student_id = ?", String(id), user.id) || fail(404, "Not found.");

// ---------- shapes ----------
function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  if (tunnelUrl) return tunnelUrl;
  const host = String(req.headers.host || `localhost:${PORT}`);
  if (/^localhost|^127\./.test(host)) { const ip = lanIps()[0]; if (ip) return `http://${ip}:${PORT}`; }
  return `${isHttps(req) ? "https" : "http"}://${host}`;
}
const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);

function syncInfo(courseId) {
  const s = canvas.lastSync(courseId);
  const counts = one(`SELECT SUM(status != 'removed') total, SUM(status = 'ok' AND visibility = 'students') student, SUM(status = 'ok' AND visibility = 'staff') staff,
    SUM(status IN ('no_text', 'unsupported', 'error')) problems FROM materials WHERE course_id = ?`, courseId);
  return { sync: s, counts: { total: counts.total || 0, students: counts.student || 0, staff: counts.staff || 0, problems: counts.problems || 0 } };
}
function sessionCard(s) {
  if (!s) return null;
  const taps = one("SELECT COUNT(*) n FROM confusion_events WHERE session_id = ?", s.id).n;
  const sum = one("SELECT status, published FROM session_summaries WHERE session_id = ?", s.id);
  const job = jobs.jobFor("summary", s.id);
  return { id: s.id, title: s.title, status: s.status, section_id: s.section_id, started_at: s.started_at, ended_at: s.ended_at, created_at: s.created_at, taps,
    summary: sum ? sum.status : null, summaryJob: job ? { status: job.status, attempts: job.attempts, error: job.last_error } : null };
}
function statusBlock(sessionId) {
  const transcriber = live.transcriberFor(sessionId);
  return {
    ai: { available: aiAvailable(), provider: aiProvider(), model: aiProvider() === "off" ? null : MODEL },
    transcription: transcriber === "server" ? { mode: "server", name: engine.label, status: engine.problem || engine.status, problem: !!engine.problem }
      : { mode: "browser", name: "Chrome speech recognition", status: engine.ready ? "The server's speech engine is busy with another class, so this class uses Chrome." : engine.why ? `Server speech engine off: ${engine.why}.` : "" },
  };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), fn, opts });

// --- auth ---
route("GET", "/api/me", (ctx) => {
  if (!ctx.session) return { user: null, demo: DEMO, demoUsers: DEMO ? DEMO_USERS.map(({ key, name, role, note, email }) => ({ key, name, role, note, email })) : [], demoPassword: DEMO ? DEMO_PASSWORD : null, profSignup: !!PROF_SIGNUP_CODE };
  const u = ctx.session.user;
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role, demo: !!u.demo, onboarded: !!u.onboarded }, csrf: ctx.session.csrf,
    unread: one("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL", u.id).n };
}, { open: true });

function signIn(ctx, userId) {
  const s = auth.createSession(userId);
  ctx.setCookie = auth.cookieHeader(s.token, s.expires, isHttps(ctx.req));
  const u = one("SELECT role FROM users WHERE id = ?", userId);
  return { ok: true, home: u.role === "professor" ? "/prof" : "/student" };
}
route("POST", "/api/auth/login", (ctx, b) => {
  const email = String(b.email || "").trim().toLowerCase();
  // Per account and per address: a whole class signs in from one campus IP, so the IP limit is loose.
  if (!allowed(`login:${email}`, 0.1, 6) || !allowed(`login-ip:${clientIp(ctx.req)}`, 2, 60)) fail(429, "Too many sign-in attempts. Wait a minute.");
  const u = one("SELECT * FROM users WHERE email = ?", email);
  if (!auth.checkPassword(String(b.password || ""), u?.password_hash)) fail(401, "That email and password don't match.");
  return signIn(ctx, u.id);
}, { open: true });
// ---------- school-email sign-in ----------
// Students sign in with their email and their university; no password. Real use would hand identity
// and class lists to the university (SSO + Canvas). Until a university connects, every student is put
// in all classes of the professor named in LOST_OPEN_CLASSES (an email), so the demo has classes.
const OPEN_PROF = String(process.env.LOST_OPEN_CLASSES || "").trim().toLowerCase();
function autoEnroll(userId) {
  if (!OPEN_PROF) return;
  const p = one("SELECT id FROM users WHERE email = ? AND role = 'professor'", OPEN_PROF);
  if (!p) return;
  for (const s of all("SELECT s.id FROM sections s JOIN courses c ON c.id = s.course_id WHERE c.owner_id = ?", p.id))
    run("INSERT OR IGNORE INTO enrollments (user_id, section_id, source, created_at) VALUES (?, ?, 'code', ?)", userId, s.id, now());
}
const nameFromEmail = (email) => email.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 80) || "Student";
route("GET", "/api/auth/institutions", () => ({ institutions: all("SELECT id, name FROM institutions ORDER BY name") }), { open: true });
route("POST", "/api/auth/start", (ctx, b) => {
  const email = String(b.email || "").trim().toLowerCase();
  if (!allowed(`start:${email}`, 0.2, 10) || !allowed(`start-ip:${clientIp(ctx.req)}`, 2, 80)) fail(429, "Too many sign-in attempts. Wait a minute.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Enter your school email.");
  const inst = one("SELECT id FROM institutions WHERE id = ?", String(b.institution || "")) || fail(400, "Pick your university.");
  const u = one("SELECT * FROM users WHERE email = ?", email);
  if (u?.role === "professor") {
    if (!b.password) return { needPassword: true };
    if (!allowed(`login:${email}`, 0.1, 6)) fail(429, "Too many sign-in attempts. Wait a minute.");
    if (!auth.checkPassword(String(b.password), u.password_hash)) fail(401, "That password doesn't match.");
    run("UPDATE users SET institution_id = ? WHERE id = ?", inst.id, u.id);
    return signIn(ctx, u.id);
  }
  const id = u?.id || auth.createUser({ email, name: nameFromEmail(email), role: "student", password: null });
  run("UPDATE users SET institution_id = ?, onboarded = 1 WHERE id = ?", inst.id, id);
  autoEnroll(id);
  return signIn(ctx, id);
}, { open: true });
route("POST", "/api/auth/demo", (ctx, b) => {
  if (!DEMO) fail(404, "Demo accounts are off.");
  const d = DEMO_USERS.find((x) => x.key === b.who) || fail(400, "Unknown demo account.");
  const u = one("SELECT id FROM users WHERE email = ? AND demo = 1", d.email) || fail(404, "Demo account missing.");
  return signIn(ctx, u.id);
}, { open: true });
route("POST", "/api/auth/signup", (ctx, b) => {
  if (!allowed(`signup:${clientIp(ctx.req)}`, 0.5, 30)) fail(429, "Too many sign-ups from here. Try later.");
  const email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim().slice(0, 80), pw = String(b.password || "");
  const role = b.role === "professor" ? "professor" : "student";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Enter a valid email.");
  if (!name) fail(400, "Enter your name.");
  if (pw.length < 10) fail(400, "Use a password of at least 10 characters.");
  // A professor account can only ever see its own courses, but creating one still needs the invite code.
  if (role === "professor" && (!PROF_SIGNUP_CODE || String(b.profCode || "") !== PROF_SIGNUP_CODE)) fail(403, "Professor sign-up needs the invite code from whoever runs this Lost server.");
  if (one("SELECT 1 FROM users WHERE email = ?", email)) fail(409, "An account with that email exists. Sign in instead.");
  const id = auth.createUser({ email, name, role, password: pw });
  return signIn(ctx, id);
}, { open: true });
route("POST", "/api/auth/logout", (ctx) => { if (ctx.session) auth.endSession(ctx.session.tokenHash); ctx.setCookie = auth.clearCookie(isHttps(ctx.req)); return { ok: true }; });

// --- notifications ---
route("GET", "/api/notifications", (ctx) => {
  const u = needUser(ctx);
  return { items: all("SELECT id, kind, title, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", u.id) };
});
route("POST", "/api/notifications/read", (ctx, b) => {
  const u = needUser(ctx);
  if (b.id) run("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL", now(), String(b.id), u.id);
  else run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), u.id);
  return { ok: true };
});

// --- Canvas (both roles) ---
route("GET", "/api/canvas/status", (ctx) => {
  const u = needUser(ctx);
  const c = canvas.connectionFor(u.id);
  const instId = u.institution_id || "usm";
  const cfg = canvas.oauthConfig(instId);
  return {
    institutions: all("SELECT id, name, canvas_host, verified_note FROM institutions"),
    institutionId: u.institution_id,
    connection: c ? { mode: c.mode, institution: c.institution_name, host: c.canvas_host, canvasUser: c.canvas_user_name, status: c.status, error: c.last_error, since: c.created_at } : null,
    oauth: { ready: cfg.ready, missing: cfg.missing, redirectUri: cfg.redirectUri },
    devToken: canvas.devTokenAvailable(), demo: DEMO,
  };
});
route("POST", "/api/canvas/institution", (ctx, b) => {
  const u = needUser(ctx);
  one("SELECT 1 FROM institutions WHERE id = ?", String(b.institutionId)) || fail(400, "Unknown institution.");
  run("UPDATE users SET institution_id = ? WHERE id = ?", String(b.institutionId), u.id);
  return { ok: true };
});
route("POST", "/api/canvas/connect", async (ctx, b) => {
  const u = needUser(ctx);
  const inst = u.institution_id || fail(400, "Pick your institution first.");
  if (b.mode === "oauth") {
    const url = canvas.authorizeUrl(u.id, inst) || fail(400, "Canvas sign-in isn't configured on this server yet.");
    return { redirect: url };
  }
  if (b.mode === "demo") {
    if (!DEMO) fail(404, "Demo data is off.");
    canvas.connectDemo(u);
  } else if (b.mode === "devtoken") {
    const r = await canvas.connectDevToken(u, inst);
    if (!r.ok) fail(400, r.error);
  } else fail(400, "Unknown mode.");
  if (u.role === "student") return { ok: true, ...(await canvas.linkStudent(u)) };
  return { ok: true };
});
route("GET", "/api/canvas/callback", async (ctx) => {
  const u = ctx.session?.user;
  const home = u?.role === "student" ? "/student#/" : "/prof#/onboarding";
  if (!u) return { redirect: "/login" };
  const r = await canvas.handleCallback(u.id, Object.fromEntries(ctx.url.searchParams));
  if (r.ok && u.role === "student") await canvas.linkStudent(u).catch(() => {});
  return { redirect: `${home}${home.includes("?") ? "&" : "?"}canvas=${r.ok ? "ok" : encodeURIComponent(r.error)}` };
}, { open: true, redirect: true });
route("POST", "/api/canvas/disconnect", async (ctx, b) => {
  const u = needUser(ctx);
  await canvas.disconnect(u.id, !!b.removeMaterials && u.role === "professor");
  return { ok: true };
});

// --- professor: onboarding and courses ---
route("GET", "/api/prof/canvas/courses", async (ctx) => {
  const u = needUser(ctx, "professor");
  const ad = canvas.adapterFor(u) || fail(400, "Connect Canvas first.");
  const list = await ad.teacherCourses();
  const linked = all("SELECT canvas_course_id, id FROM courses WHERE owner_id = ? AND source = ?", u.id, ad.source);
  const linkedSecs = new Set(all("SELECT s.canvas_section_id FROM sections s JOIN courses c ON c.id = s.course_id WHERE c.owner_id = ?", u.id).map((r) => r.canvas_section_id));
  return { source: ad.source, label: ad.label, courses: list.map((c) => ({ ...c, linked: linked.some((l) => l.canvas_course_id === c.id), sections: c.sections.map((s) => ({ ...s, linked: linkedSecs.has(s.id) })) })) };
});
route("POST", "/api/prof/canvas/import", async (ctx, b) => {
  const u = needUser(ctx, "professor");
  const sel = Array.isArray(b.selections) ? b.selections.slice(0, 30) : [];
  const r = await canvas.importCourses(u, sel);
  if (!r.ok) fail(400, r.error);
  const results = [];
  for (const id of r.courseIds) results.push({ id, ...(await canvas.syncCourse(u, id)) });
  return { ok: true, results };
});
route("POST", "/api/prof/onboarding/done", (ctx) => { const u = needUser(ctx, "professor"); run("UPDATE users SET onboarded = 1 WHERE id = ?", u.id); return { ok: true }; });
route("POST", "/api/prof/courses", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const name = String(b.name || "").trim().slice(0, 120) || fail(400, "Name the course.");
  const id = newId(9);
  tx(() => {
    run("INSERT INTO courses (id, owner_id, institution_id, name, code, term, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)", id, u.id, u.institution_id, name, String(b.code || "").slice(0, 30), String(b.term || "").slice(0, 40), now());
    run("INSERT INTO sections (id, course_id, name, join_code, created_at) VALUES (?, ?, ?, ?, ?)", newId(9), id, String(b.section || "Section 1").slice(0, 80), joinCode(), now());
    run("UPDATE users SET onboarded = 1 WHERE id = ?", u.id);
  });
  return { ok: true, id };
});

route("GET", "/api/prof/courses", (ctx) => {
  const u = needUser(ctx, "professor");
  return { courses: all("SELECT * FROM courses WHERE owner_id = ? ORDER BY code, name", u.id).map((c) => {
    const sections = all("SELECT id, name, join_code FROM sections WHERE course_id = ? ORDER BY name", c.id).map((s) => ({ ...s, students: one("SELECT COUNT(*) n FROM enrollments WHERE section_id = ?", s.id).n }));
    const active = one("SELECT * FROM lecture_sessions WHERE course_id = ? AND status IN ('ready', 'live', 'ending') ORDER BY created_at DESC LIMIT 1", c.id);
    const recent = one("SELECT * FROM lecture_sessions WHERE course_id = ? AND status = 'ended' ORDER BY ended_at DESC LIMIT 1", c.id);
    return { id: c.id, name: c.name, code: c.code, term: c.term, source: c.source, art: courseArt(c), sections, ...syncInfo(c.id), active: sessionCard(active), recent: sessionCard(recent) };
  }) };
});
route("GET", "/api/prof/courses/:id", (ctx) => {
  const u = needUser(ctx, "professor");
  const c = ownCourse(u, ctx.params.id);
  return {
    course: { id: c.id, name: c.name, code: c.code, term: c.term, source: c.source, canvas_url: c.canvas_url, office_hours_url: c.office_hours_url, tutoring_url: c.tutoring_url, terms: c.terms, art: courseArt(c), artChosen: c.art || "" }, artChoices: ART_IDS.map((id) => ({ id, label: ART[id].label, icons: ART[id].icons })),
    sections: all("SELECT id, name, join_code FROM sections WHERE course_id = ? ORDER BY name", c.id).map((s) => ({ ...s, students: one("SELECT COUNT(*) n FROM enrollments WHERE section_id = ?", s.id).n })),
    materials: all(`SELECT id, source, external_type, title, url, kind, module, visibility, visibility_reason, use_in_class, status, warning, source_updated_at, synced_at,
      (SELECT COUNT(*) FROM passages p WHERE p.material_id = m.id) passages FROM materials m WHERE course_id = ? ORDER BY status = 'removed', module, title`, c.id),
    sessions: all("SELECT * FROM lecture_sessions WHERE course_id = ? ORDER BY created_at DESC LIMIT 40", c.id).map(sessionCard),
    ...syncInfo(c.id),
    canvasConnected: !!canvas.connectionFor(u.id),
  };
});
route("POST", "/api/prof/courses/:id/sync", async (ctx) => {
  const u = needUser(ctx, "professor");
  const c = ownCourse(u, ctx.params.id);
  return await canvas.syncCourse(u, c.id);
});
route("POST", "/api/prof/courses/:id/settings", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const c = ownCourse(u, ctx.params.id);
  const url = (v) => { v = String(v || "").trim(); if (!v) return ""; if (!/^https:\/\/[^\s<>"]+$/.test(v)) fail(400, "Links must start with https://"); return v.slice(0, 300); };
  const art = b.art === undefined ? c.art : ART_IDS.includes(b.art) ? b.art : "";
  run("UPDATE courses SET office_hours_url = ?, tutoring_url = ?, terms = ?, art = ? WHERE id = ?", url(b.office_hours_url ?? c.office_hours_url), url(b.tutoring_url ?? c.tutoring_url), String(b.terms ?? c.terms).slice(0, 8000), art, c.id);
  return { ok: true };
});
route("POST", "/api/prof/courses/:id/notes", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const c = ownCourse(u, ctx.params.id);
  const text = String(b.text || "").slice(0, 200000).trim() || fail(400, "Paste some text.");
  const title = String(b.title || "Pasted notes").slice(0, 120);
  const r = mat.upsertMaterial({ course_id: c.id, source: "notes", external_type: "notes", external_id: newId(6), title, kind: "notes",
    visibility: b.visibility === "staff" ? "staff" : "students", visibility_reason: b.visibility === "staff" ? "Set by you: professor only" : "Set by you: students can see",
    parts: mat.chunkText(text, title.slice(0, 50)) });
  return { ok: true, id: r.id };
});
route("POST", "/api/prof/materials/:id", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const m = ownMaterial(u, ctx.params.id);
  if (typeof b.use_in_class === "boolean") run("UPDATE materials SET use_in_class = ? WHERE id = ?", b.use_in_class ? 1 : 0, m.id);
  // Canvas decides who can see Canvas items. A professor may only make them stricter here.
  if (b.visibility === "staff") run("UPDATE materials SET visibility = 'staff', visibility_reason = 'Set by you: professor only' WHERE id = ?", m.id);
  if (b.visibility === "students" && (m.source === "upload" || m.source === "notes")) run("UPDATE materials SET visibility = 'students', visibility_reason = 'Set by you: students can see' WHERE id = ?", m.id);
  return { ok: true };
});
route("POST", "/api/prof/materials/:id/delete", (ctx) => { const u = needUser(ctx, "professor"); mat.removeMaterial(ownMaterial(u, ctx.params.id).id); return { ok: true }; });

// --- professor: sessions ---
route("POST", "/api/prof/courses/:id/sessions", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const c = ownCourse(u, ctx.params.id);
  const sec = one("SELECT * FROM sections WHERE id = ? AND course_id = ?", String(b.sectionId), c.id) || fail(400, "Pick a section.");
  // Resume instead of duplicating: one open session per section (also enforced by a unique index).
  const open = one("SELECT * FROM lecture_sessions WHERE section_id = ? AND status IN ('ready', 'live', 'ending')", sec.id);
  if (open) return { id: open.id, resumed: true };
  const ids = (Array.isArray(b.materialIds) ? b.materialIds : []).map(String).filter((id) => one("SELECT 1 FROM materials WHERE id = ? AND course_id = ?", id, c.id));
  const id = newId(9);
  try { run("INSERT INTO lecture_sessions (id, course_id, section_id, title, status, material_ids, created_at) VALUES (?, ?, ?, ?, 'ready', ?, ?)", id, c.id, sec.id, String(b.title || "").slice(0, 120), JSON.stringify(ids), now()); }
  catch { const again = one("SELECT id FROM lecture_sessions WHERE section_id = ? AND status IN ('ready', 'live', 'ending')", sec.id); if (again) return { id: again.id, resumed: true }; throw new Error("Couldn't create the session."); }
  return { id, resumed: false };
});
route("GET", "/api/prof/sessions/:id", async (ctx) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  const c = one("SELECT * FROM courses WHERE id = ?", s.course_id), sec = one("SELECT * FROM sections WHERE id = ?", s.section_id);
  const joinUrl = `${publicBase(ctx.req)}/join/${sec.join_code}`;
  const qr = await QRCode.toString(joinUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#18202e", light: "#ffffff" } });
  return {
    session: { ...sessionCard(s), material_ids: parse(s.material_ids, []) },
    course: { id: c.id, name: c.name, code: c.code }, section: { id: sec.id, name: sec.name, join_code: sec.join_code, students: one("SELECT COUNT(*) n FROM enrollments WHERE section_id = ?", sec.id).n },
    joinUrl, qr, site: publicBase(ctx.req), demo: DEMO, ...statusBlock(s.id),
    materials: all("SELECT id, title, visibility, status FROM materials WHERE course_id = ? AND status = 'ok' ORDER BY title", c.id),
  };
});
route("POST", "/api/prof/sessions/:id/materials", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  const ids = (Array.isArray(b.materialIds) ? b.materialIds : []).map(String).filter((id) => one("SELECT 1 FROM materials WHERE id = ? AND course_id = ?", id, s.course_id));
  run("UPDATE lecture_sessions SET material_ids = ?, title = COALESCE(?, title) WHERE id = ?", JSON.stringify(ids), typeof b.title === "string" ? b.title.slice(0, 120) : null, s.id);
  return { ok: true };
});
route("GET", "/api/prof/sessions/:id/live", (ctx) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  const r = live.runtime(s.id);
  const since = Math.max(0, Number(ctx.url.searchParams.get("since")) || 0), rev = Number(ctx.url.searchParams.get("rev")) || 0;
  const from = rev !== r.editRev ? 0 : since;
  const marks = new Map(all("SELECT COALESCE(anchor_line, line_idx) i, COUNT(*) n FROM confusion_events WHERE session_id = ? AND COALESCE(anchor_line, line_idx) IS NOT NULL GROUP BY i", s.id).map((x) => [x.i, x.n]));
  const lines = all("SELECT idx, t, text, original, edited_at, unsure, origin FROM transcript_lines WHERE session_id = ? AND idx >= ? ORDER BY idx", s.id, from)
    .map((l) => ({ ...l, unsure: parse(l.unsure, []) }));
  const clock = live.sessionClock(s);
  const recent = all("SELECT DISTINCT student_id FROM confusion_events WHERE session_id = ? AND t >= ?", s.id, clock - 90).length;
  return {
    status: s.status, clock, rev: r.editRev, full: from === 0, lines, interim: r.interim,
    // only the most recent 200 lines' marks travel with each poll
    marks: Object.fromEntries([...marks].filter(([i]) => i >= Math.max(0, since - 200))),
    taps: all("SELECT t FROM confusion_events WHERE session_id = ? ORDER BY t", s.id).map((x) => x.t),
    present: live.presentCount(s.id), lostNow: recent,
    gaps: all("SELECT from_t, to_t, reason FROM transcript_gaps WHERE session_id = ? ORDER BY from_t", s.id),
    ...statusBlock(s.id),
  };
});
route("POST", "/api/prof/sessions/:id/start", (ctx) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  if (s.status === "ended") fail(409, "This class has ended. Start a new session.");
  live.startSession(s.id);
  return { ok: true, status: one("SELECT status FROM lecture_sessions WHERE id = ?", s.id).status };
});
route("POST", "/api/prof/sessions/:id/end", async (ctx) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  if (s.status === "ready") { run("DELETE FROM lecture_sessions WHERE id = ? AND status = 'ready'", s.id); return { ok: true, discarded: true }; }
  live.endSession(s.id); // finishes in the background
  return { ok: true };
});
route("POST", "/api/prof/sessions/:id/line", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  if (s.status !== "live") fail(409, "Class isn't live.");
  const origin = b.origin === "sample" ? (DEMO ? "sample" : fail(400, "Sample lines are off.")) : b.origin === "speech" ? "speech" : "typed";
  return { idx: live.addLine(s.id, b.text, { origin }) };
});
route("POST", "/api/prof/sessions/:id/line-edit", (ctx, b) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  return { ok: live.editLine(s.id, Number(b.idx), b.text) };
});
route("GET", "/api/prof/sessions/:id/report", (ctx) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  const sum = one("SELECT * FROM session_summaries WHERE session_id = ?", s.id);
  const job = jobs.jobFor("summary", s.id);
  const c = one("SELECT id, name, code FROM courses WHERE id = ?", s.course_id), sec = one("SELECT name FROM sections WHERE id = ?", s.section_id);
  return {
    session: sessionCard(s), course: c, section: sec,
    summary: sum ? { status: sum.status, published: !!sum.published, error: sum.error, payload: parse(sum.payload) } : null,
    job: job ? { status: job.status, attempts: job.attempts, error: job.last_error, max: jobs.MAX_ATTEMPTS } : null,
    analytics: summary.profAnalytics(s.id), ai: aiAvailable(),
  };
});
route("POST", "/api/prof/sessions/:id/retry-summary", (ctx) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  if (s.status !== "ended") fail(409, "End the class first.");
  run("UPDATE session_summaries SET status = 'pending', error = NULL WHERE session_id = ? AND status = 'failed'", s.id);
  jobs.enqueue("summary", s.id, { restart: true });
  return { ok: true };
});
route("POST", "/api/prof/sessions/:id/moments/:idx", async (ctx, b) => {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  const idx = Number(ctx.params.idx);
  const m = summary.moments(s.id)[idx] || fail(404, "No such moment.");
  if (b.kind === "material") {
    const lines = all("SELECT text FROM transcript_lines WHERE session_id = ? AND t BETWEEN ? AND ?", s.id, m.start - 90, m.end + 15).map((l) => l.text).join(" ");
    return { passages: mat.retrieve(s.course_id, lines, { limit: 4, audience: "staff" }).map((p) => ({ title: p.title, location: p.location, url: p.url, visibility: p.visibility, text: p.text.slice(0, 600) })) };
  }
  if (b.kind === "revisit") {
    const id = newId(9);
    run("INSERT INTO prof_notes (id, session_id, moment_idx, kind, text, created_at) VALUES (?, ?, ?, 'revisit', ?, ?)", id, s.id, idx, String(b.text || "Revisit this topic next class").slice(0, 500), now());
    return { ok: true, id };
  }
  if (b.kind === "clarification" || b.kind === "suggestion") {
    if (!aiAvailable()) fail(503, "The AI is off on this server.");
    try { return await summary.draftForMoment(s.id, idx, b.kind); }
    catch (e) { fail(503, e instanceof AiError ? help.friendly(e.code) : "Couldn't draft that."); }
  }
  fail(400, "Unknown action.");
});

// --- professor: audio ---
async function profAudio(ctx) {
  const u = needUser(ctx, "professor");
  const s = ownSession(u, ctx.params.id);
  if (ctx.req.method === "DELETE") { live.audioStopped(s.id); return { ok: true }; }
  if (s.status !== "live") fail(409, "Class isn't live.");
  const buf = await readRaw(ctx.req, 512 * 1024);
  if (!buf) fail(413, "Too large.");
  const seq = live.audioPiece(s.id, buf, ctx.url.searchParams.get("first") === "1");
  if (seq === null) fail(409, "Microphone is off.");
  return { seq };
}
route("POST", "/api/prof/sessions/:id/audio", profAudio, { raw: true });
route("DELETE", "/api/prof/sessions/:id/audio", profAudio, { raw: true });

route("POST", "/api/prof/courses/:id/materials", async (ctx) => {
  const u = needUser(ctx, "professor");
  const c = ownCourse(u, ctx.params.id);
  const buf = await readRaw(ctx.req, mat.MAX_FILE);
  if (!buf) fail(413, "Files can be up to 15 MB.");
  let name = ""; try { name = decodeURIComponent(String(ctx.req.headers["x-filename"] || "")); } catch {}
  name = path.basename(name || "file.txt").replace(/[^\w .()-]/g, "_").slice(0, 120);
  const got = await mat.extractFile(name, buf);
  if (got.status === "unsupported" || got.status === "error") fail(400, got.warning);
  const staff = ctx.url.searchParams.get("visibility") === "staff";
  const r = mat.upsertMaterial({ course_id: c.id, source: "upload", external_type: "upload", external_id: newId(6), title: name, kind: mat.kindOf(name),
    visibility: staff ? "staff" : "students", visibility_reason: staff ? "Set by you: professor only" : "Set by you: students can see",
    parts: got.parts, status: got.status, warning: got.warning });
  return { ok: true, id: r.id, status: got.status, warning: got.warning, passages: got.parts.length };
}, { raw: true });

// --- student ---
function studentCourses(u) {
  return all(`SELECT c.id, c.name, c.code, c.term, c.source, c.art, c.terms, s.id section_id, s.name section_name, e.source enrolled_by
    FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = s.course_id WHERE e.user_id = ? ORDER BY c.code`, u.id).map((c) => {
    const active = one("SELECT id, title, status, started_at FROM lecture_sessions WHERE section_id = ? AND status IN ('live', 'ending') LIMIT 1", c.section_id);
    const last = one(`SELECT s.id, s.title, s.ended_at, ss.status summary FROM lecture_sessions s LEFT JOIN session_summaries ss ON ss.session_id = s.id
      WHERE s.section_id = ? AND s.status = 'ended' ORDER BY s.ended_at DESC LIMIT 1`, c.section_id);
    return { ...c, art: courseArt(c), terms: undefined, active, last, stats: summary.studentStats(u.id, c.id) };
  });
}
route("GET", "/api/student/courses", (ctx) => {
  const u = needUser(ctx, "student");
  autoEnroll(u.id); // new classes from the open professor show up without signing in again
  const conn = canvas.connectionFor(u.id);
  return { courses: studentCourses(u), canvas: conn ? { mode: conn.mode, host: conn.canvas_host } : null };
});
route("POST", "/api/student/join", (ctx, b) => {
  const u = needUser(ctx, "student");
  if (!allowed(`join:${u.id}`, 0.2, 6)) fail(429, "Too many tries. Wait a minute.");
  const code = String(b.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const sec = one("SELECT * FROM sections WHERE join_code = ?", code) || fail(404, "No class has that code. Check it with your professor.");
  // A student belongs to one section per course; joining another section of the same course needs the professor.
  const other = one("SELECT s.name FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE e.user_id = ? AND s.course_id = ? AND s.id != ?", u.id, sec.course_id, sec.id);
  if (other) fail(409, `You're already in ${other.name} of this course. Ask your professor if you need to switch sections.`);
  run("INSERT OR IGNORE INTO enrollments (user_id, section_id, source, created_at) VALUES (?, ?, 'code', ?)", u.id, sec.id, now());
  const c = one("SELECT id, name, code FROM courses WHERE id = ?", sec.course_id);
  const active = one("SELECT id FROM lecture_sessions WHERE section_id = ? AND status = 'live'", sec.id);
  return { ok: true, course: c, section: { id: sec.id, name: sec.name }, activeSession: active?.id || null };
});
route("GET", "/api/student/courses/:id", (ctx) => {
  const u = needUser(ctx, "student");
  const c = enrolledCourse(u, ctx.params.id);
  const sessions = all(`SELECT s.id, s.title, s.status, s.started_at, s.ended_at, ss.status summary, ss.published,
      (SELECT COUNT(*) FROM confusion_events e WHERE e.session_id = s.id AND e.student_id = ?) my_taps
    FROM lecture_sessions s LEFT JOIN session_summaries ss ON ss.session_id = s.id WHERE s.section_id = ? AND s.status != 'ready' ORDER BY s.created_at DESC LIMIT 40`, u.id, c.section_id);
  const history = all(`SELECT e.id, e.session_id, e.t, e.topic, e.category, e.self_status, s.started_at FROM confusion_events e JOIN lecture_sessions s ON s.id = e.session_id
    WHERE e.student_id = ? AND s.course_id = ? ORDER BY e.created_at DESC LIMIT 50`, u.id, c.id);
  return { course: { id: c.id, name: c.name, code: c.code, term: c.term, section: c.section_name, office_hours_url: c.office_hours_url, tutoring_url: c.tutoring_url },
    active: sessions.find((s) => s.status === "live" || s.status === "ending") || null, sessions, history, stats: summary.studentStats(u.id, c.id) };
});
route("GET", "/api/student/sessions/:id/live", (ctx) => {
  const u = needUser(ctx, "student");
  const s = enrolledSession(u, ctx.params.id);
  if (s.status === "live") live.markPresent(s.id, u.id);
  const r = live.runtime(s.id);
  const wantLines = ctx.url.searchParams.get("lines") === "1";
  const since = Math.max(0, Number(ctx.url.searchParams.get("since")) || 0), rev = Number(ctx.url.searchParams.get("rev")) || 0;
  const from = rev !== r.editRev ? 0 : since;
  const c = one("SELECT name, code FROM courses WHERE id = ?", s.course_id);
  return {
    status: s.status, title: s.title, course: c, clock: live.sessionClock(s), rev: r.editRev, full: from === 0,
    now: wantLines && s.status === "live" ? r.interim.slice(-300) : "",
    lines: wantLines ? all("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND idx >= ? ORDER BY idx", s.id, Math.max(from, (one("SELECT MAX(idx) m FROM transcript_lines WHERE session_id = ?", s.id).m ?? 0) - 150)) : null,
    lastIdx: one("SELECT MAX(idx) m FROM transcript_lines WHERE session_id = ?", s.id).m,
    gaps: all("SELECT from_t, to_t FROM transcript_gaps WHERE session_id = ? ORDER BY from_t", s.id),
    audio: r.relay.header ? { id: r.relay.id, seq: r.relay.seq } : null,
    ai: aiAvailable(),
    theme: sessionTheme(s.id),
    mine: all("SELECT id, t, self_status, topic FROM confusion_events WHERE session_id = ? AND student_id = ? ORDER BY t", s.id, u.id),
  };
});
route("GET", "/api/student/sessions/:id/audio", async (ctx) => {
  const u = needUser(ctx, "student");
  const s = enrolledSession(u, ctx.params.id);
  const relay = live.runtime(s.id).relay;
  const n = Number(ctx.url.searchParams.get("seq"));
  const piece = n === 0 ? relay.header : relay.pieces.get(n);
  if (!piece) fail(404, "Not available.");
  return { binary: piece, type: "audio/webm" };
});
route("POST", "/api/student/sessions/:id/lost", (ctx) => {
  const u = needUser(ctx, "student");
  const s = enrolledSession(u, ctx.params.id);
  if (s.status !== "live") fail(409, "Class isn't live right now.");
  const t = live.sessionClock(s);
  // A second tap within 8 seconds returns the same event (double taps, flaky Wi-Fi retries).
  let ev = one("SELECT * FROM confusion_events WHERE session_id = ? AND student_id = ? AND t > ? ORDER BY t DESC LIMIT 1", s.id, u.id, t - 8);
  if (!ev) {
    if (one("SELECT COUNT(*) n FROM confusion_events WHERE session_id = ? AND student_id = ?", s.id, u.id).n >= help.LIMITS.perStudentSession) fail(429, "That's the limit of taps for one class.");
    const last = one("SELECT idx FROM transcript_lines WHERE session_id = ? AND t <= ? ORDER BY idx DESC LIMIT 1", s.id, t + 0.5);
    const first = one("SELECT MIN(idx) i FROM transcript_lines WHERE session_id = ? AND t >= ?", s.id, t - 60);
    const id = newId(9);
    const said = live.runtime(s.id).interim.trim().slice(0, 500) || null; // the sentence still being spoken
    run("INSERT INTO confusion_events (id, session_id, student_id, t, line_idx, context_from, context_to, interim_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, s.id, u.id, t, last?.idx ?? null, first?.i ?? null, last?.idx ?? null, said, now());
    ev = one("SELECT * FROM confusion_events WHERE id = ?", id);
  }
  const phrases = all("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND t <= ? ORDER BY idx DESC LIMIT 5", s.id, ev.t + 0.5).reverse();
  const gaps = help.gapsBetween(s.id, ev.t - 60, ev.t + 1);
  return { event: { id: ev.id, t: ev.t, line_idx: ev.line_idx }, phrases, now: ev.interim_text, gaps, ai: aiAvailable(),
    others: all("SELECT DISTINCT student_id FROM confusion_events WHERE session_id = ? AND t >= ? AND student_id != ?", s.id, ev.t - 90, u.id).length };
});
route("POST", "/api/student/events/:id/help", async (ctx, b) => {
  const u = needUser(ctx, "student");
  let ev = ownEvent(u, ctx.params.id);
  if (!allowed(`help:${u.id}`, 1, helpBurst())) fail(429, "Slow down a little: one help request at a time.");
  const kind = [...help.CARD_KINDS, "catchup"].includes(b.kind) ? b.kind : fail(400, "Unknown help kind.");
  if (kind === "explain") {
    // The student's choice of focus is saved once, on the first explanation.
    if (!one("SELECT 1 FROM help_responses WHERE event_id = ? AND kind = 'explain' AND status IN ('ok', 'no_ai')", ev.id)) {
      const anchor = ["current", "phrase", "earlier", "question"].includes(b.anchor) ? b.anchor : "current";
      let line = Number.isInteger(b.line) ? one("SELECT idx FROM transcript_lines WHERE session_id = ? AND idx = ? AND t <= ?", ev.session_id, b.line, ev.t + 1)?.idx ?? null : null;
      if (anchor === "current") line = null; // keep following the tap time as late lines arrive
      if (anchor === "earlier") line = null;
      const category = ["term", "reasoning", "connection", "missed"].includes(b.category) ? b.category : null;
      const question = typeof b.question === "string" ? b.question.trim().slice(0, 300) || null : null;
      run("UPDATE confusion_events SET anchor = ?, anchor_line = ?, category = ?, question = ? WHERE id = ?", anchor, line, category, question, ev.id);
      ev = ownEvent(u, ev.id);
    }
  }
  const max = kind === "explain" ? 1 : kind === "catchup" ? help.LIMITS.catchup : help.LIMITS.retry;
  const attempt = kind === "explain" ? 1 : Math.max(1, Math.min(max, Number(b.attempt) || 1));
  if (Number(b.attempt) > max) fail(429, kind === "catchup" ? "That's the most catch-ups for one moment." : "That's the most re-explanations for one moment. Your professor will see this spot stayed unclear.");
  return await help.requestHelp(ev, kind, attempt);
});
route("POST", "/api/student/events/:id/status", (ctx, b) => {
  const u = needUser(ctx, "student");
  const ev = ownEvent(u, ctx.params.id);
  // resolved = the student said they understand; still = asked for more; open = undo. Closing the
  // help panel never calls this, so dismissing help never counts as understanding.
  const st = ["resolved", "still", "open"].includes(b.status) ? b.status : fail(400, "Unknown status.");
  run("UPDATE confusion_events SET self_status = ?, resolved_at = ? WHERE id = ?", st, st === "resolved" ? now() : null, ev.id);
  return { ok: true, previous: ev.self_status, status: st };
});
// One moment with the help it got, for reopening it during class ("My moments").
route("GET", "/api/student/events/:id", (ctx) => {
  const u = needUser(ctx, "student");
  const ev = ownEvent(u, ctx.params.id);
  const anchor = ev.anchor_line ?? ev.line_idx;
  return {
    event: { id: ev.id, t: ev.t, line_idx: ev.line_idx, status: ev.self_status, topic: ev.topic || "" },
    line: anchor != null ? one("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND idx = ?", ev.session_id, anchor) : null,
    cards: all("SELECT id, kind, attempt, status, payload FROM help_responses WHERE event_id = ? AND kind != 'catchup' AND status IN ('ok', 'no_ai', 'failed') ORDER BY created_at", ev.id)
      .map((r) => ({ id: r.id, kind: r.kind, attempt: r.attempt, status: r.status, payload: parse(r.payload) })),
  };
});
route("POST", "/api/student/events/:id/check", async (ctx) => {
  const u = needUser(ctx, "student");
  const ev = ownEvent(u, ctx.params.id);
  if (!allowed(`help:${u.id}`, 1, helpBurst())) fail(429, "Slow down a little.");
  if (one("SELECT COUNT(*) n FROM checks WHERE event_id = ? AND kind = 'comprehension'", ev.id).n >= 3) fail(429, "That's three checks for this moment.");
  try { return await help.makeCheck(ev); }
  catch (e) { fail(503, e instanceof AiError ? help.friendly(e.code) : "Couldn't make a check right now."); }
});
route("POST", "/api/student/checks/:id/answer", (ctx, b) => {
  const u = needUser(ctx, "student");
  const c = one("SELECT k.* FROM checks k JOIN confusion_events e ON e.id = k.event_id WHERE k.id = ? AND e.student_id = ?", String(ctx.params.id), u.id) || fail(404, "Not found.");
  const r = help.answerCheck(c, Number(b.chosen), !!b.skip);
  if (r.error) fail(400, r.error);
  return r;
});
route("POST", "/api/student/events/:id/office-hours", (ctx, b) => {
  const u = needUser(ctx, "student");
  const ev = ownEvent(u, ctx.params.id);
  const text = String(b.text || "").trim().slice(0, 1500) || fail(400, "Write the question first.");
  run("INSERT INTO office_hours_questions (event_id, student_id, text, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at", ev.id, u.id, text, now());
  return { ok: true };
});
route("GET", "/api/student/sessions/:id", (ctx) => {
  const u = needUser(ctx, "student");
  const s = enrolledSession(u, ctx.params.id);
  return { ...summary.studentSessionView(s.id, u.id), theme: sessionTheme(s.id) };
});

// ---------- static pages ----------
const PAGES = { "/": null, "/login": "login.html", "/prof": "prof.html", "/student": "student.html" };
const STATIC = new Set(["style.css", "common.js", "visuals.js", "theme.js", "keys.js", "login.js", "prof.js", "student.js", "favicon.svg"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

async function handle(req, res) {
  let url;
  try { url = new URL(req.url, "http://x"); } catch { res.writeHead(400); res.end(); return; }
  const session = (() => { try { return auth.sessionFrom(req); } catch { return null; } })();
  if (!allowed(session ? `u:${session.user.id}` : `ip:${clientIp(req)}`, session ? 25 : 15, session ? 60 : 40)) { res.writeHead(429, SECURITY_HEADERS); res.end("Slow down"); return; }

  if (url.pathname.startsWith("/api/")) {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) { send(res, 404, { error: "Not found." }); return; }
    const ctx = { req, url, session, params: url.pathname.match(r.re).groups || {} };
    try {
      if (req.method !== "GET" && !r.opts.open) {
        if (!session) fail(401, "Please sign in.");
        if (!auth.csrfOk(req, session)) fail(403, "This page is out of date. Reload and try again.");
      }
      if (req.method !== "GET" && r.opts.open && req.headers["x-lost-csrf"] === undefined && !String(req.headers["content-type"] || "").startsWith("application/json")) fail(403, "Bad request.");
      const body = req.method === "POST" && !r.opts.raw ? await readJson(req) : {};
      const out = await r.fn(ctx, body);
      const headers = ctx.setCookie ? { "set-cookie": ctx.setCookie } : {};
      if (r.opts.redirect) { res.writeHead(302, { location: out.redirect, ...SECURITY_HEADERS, ...headers }); res.end(); return; }
      if (out?.binary) { res.writeHead(200, { "content-type": out.type, "cache-control": "no-store", ...SECURITY_HEADERS }); res.end(out.binary); return; }
      send(res, 200, out ?? {}, headers);
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else { console.error("[api]", req.method, url.pathname, e); send(res, 500, { error: "Something went wrong on the server." }); }
    }
    return;
  }
  if (req.method !== "GET") { res.writeHead(405, SECURITY_HEADERS); res.end(); return; }

  // Join links and QR codes land here: sign in first if needed, then join.
  const join = url.pathname.match(/^\/join\/([A-Za-z0-9]{4,10})$/);
  if (join) {
    const target = `/student#/join/${join[1].toUpperCase()}`;
    res.writeHead(302, { location: session ? (session.user.role === "student" ? target : "/prof") : `/login?next=${encodeURIComponent(target)}`, ...SECURITY_HEADERS }); res.end(); return;
  }
  if (url.pathname in PAGES) {
    const home = session ? (session.user.role === "professor" ? "/prof" : "/student") : "/login";
    const page = PAGES[url.pathname];
    const go = (to) => { res.writeHead(302, { location: to, ...SECURITY_HEADERS }); res.end(); };
    if (!page) return go(home);
    if (page === "login.html") return session ? go(home) : serveFile(res, page);
    if (!session) return go(`/login?next=${encodeURIComponent(url.pathname)}`);
    // A student opening /prof (or the other way round) goes to their own portal.
    if ((page === "prof.html") !== (session.user.role === "professor")) return go(home);
    return serveFile(res, page);
  }
  const name = url.pathname.slice(1);
  if (STATIC.has(name)) return serveFile(res, name);
  res.writeHead(404, SECURITY_HEADERS); res.end("Not found");
}
function serveFile(res, name) {
  fs.readFile(path.join(here, "public", name), (err, data) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(name)] || "text/plain", "cache-control": "no-cache", ...SECURITY_HEADERS }); res.end(data);
  });
}

// ---------- public link (npm run share) ----------
let tunnelUrl = "", tunnel = null;
function startTunnel() {
  const names = process.platform === "win32" ? ["cloudflared.exe"] : ["cloudflared"];
  const dirs = [...(process.env.PATH || "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"];
  const bin = dirs.flatMap((d) => names.map((n) => path.join(d, n))).find((f) => fs.existsSync(f));
  if (!bin) { console.log("  Public link: cloudflared is not installed (Mac: brew install cloudflared)."); return; }
  tunnel = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`]);
  let shown = false;
  const look = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !shown) { shown = true; tunnelUrl = m[0]; console.log(`\n  Public link (any network): ${tunnelUrl}\n`); }
  };
  tunnel.stdout.on("data", look); tunnel.stderr.on("data", look);
  tunnel.on("exit", (code) => { tunnelUrl = ""; tunnel = null; console.log(`  Public link stopped (cloudflared exited ${code}).`); });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { tunnel?.kill(); process.exit(0); });
  process.on("exit", () => tunnel?.kill());
  await boot();
  console.log(`\nLost is running on http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`  Same Wi-Fi: http://${ip}:${PORT}`);
  console.log(`  AI: ${aiProvider() === "api" ? `${MODEL} through the Anthropic API` : aiProvider() === "cli" ? `${MODEL} through Claude Code (claude -p)` : "off (set ANTHROPIC_API_KEY or install Claude Code)"}`);
  console.log(`  Transcript: ${engine.name === "deepgram" ? "Deepgram Nova-3" : engine.name !== "off" ? `${engine.name} (loading)` : `Chrome speech recognition (${engine.why || "no server engine"})`}`);
  console.log(`  Canvas OAuth: ${canvas.oauthConfig("usm").ready ? "configured" : `not configured (missing ${canvas.oauthConfig("usm").missing.join(", ")})`}`);
  console.log(`  Demo accounts: ${DEMO ? `on (password ${DEMO_PASSWORD}; one-click buttons on the sign-in page)` : "off"}\n`);
  if (process.argv.includes("--share") || process.env.SHARE === "1") startTunnel();
}
