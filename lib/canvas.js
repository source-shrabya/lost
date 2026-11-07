// Canvas connector.
//
// Three separate things, kept separate in the code and the UI:
//   1. Signing into Lost (lib/auth.js). Lost never sees a Canvas password.
//   2. Authorizing Lost to read Canvas: OAuth 2 against the institution's Canvas, using a developer
//      key (client id + secret) that only the institution's Canvas admin can issue.
//      Docs: https://canvas.instructure.com/doc/api/file.oauth.html
//   3. Linking a Canvas course and its sections to Lost (importCourses / syncCourse).
//
// Adapters share one interface, so the rest of Lost doesn't care where data comes from:
//   RealAdapter  Canvas REST API with the user's OAuth token (or the developer's own token from
//                CANVAS_DEV_TOKEN, for testing the connector only).
//   DemoAdapter  sample data from demo-canvas.js, labelled as such everywhere.
import crypto from "node:crypto";
import { one, all, run, now, newId, tx, joinCode, parse } from "./db.js";
import { encrypt, decrypt, sha } from "./auth.js";
import { DEMO_CANVAS, demoStudentSections } from "./demo-canvas.js";
import { extractFile, htmlToText, chunkText, upsertMaterial, SUPPORTED, MAX_FILE, kindOf } from "./materials.js";

// Verified 2026-11-06: https://usm.instructure.com/ answers as Canvas (redirects to /login/saml).
// canvas.usm.edu is a USM landing page that links there; usm.canvas.com does not resolve.
export const INSTITUTIONS = [
  { id: "usm", name: "The University of Southern Mississippi", canvas_host: "usm.instructure.com",
    verified_note: "Checked 2026-11-06: usm.instructure.com is USM's Canvas (Instructure-hosted, sign-in through USM's SAML single sign-on)." },
];
export function seedInstitutions() {
  for (const i of INSTITUTIONS) run("INSERT OR REPLACE INTO institutions (id, name, canvas_host, verified_note) VALUES (?, ?, ?, ?)", i.id, i.name, i.canvas_host, i.verified_note);
}

const PUBLIC_URL = () => (process.env.PUBLIC_URL || "").replace(/\/$/, "");
export function oauthConfig(institutionId) {
  // One institution today, so one set of variables. CANVAS_<ID>_CLIENT_ID wins if both are set.
  const up = institutionId.toUpperCase();
  const id = process.env[`CANVAS_${up}_CLIENT_ID`] || process.env.CANVAS_CLIENT_ID;
  const secret = process.env[`CANVAS_${up}_CLIENT_SECRET`] || process.env.CANVAS_CLIENT_SECRET;
  const missing = [!id && "CANVAS_CLIENT_ID", !secret && "CANVAS_CLIENT_SECRET", !PUBLIC_URL() && "PUBLIC_URL"].filter(Boolean);
  return { ready: !missing.length, missing, clientId: id, secret, redirectUri: `${PUBLIC_URL() || "<PUBLIC_URL>"}/api/canvas/callback` };
}
export const devTokenAvailable = () => !!process.env.CANVAS_DEV_TOKEN;

// ---------- OAuth ----------
export function authorizeUrl(userId, institutionId) {
  const inst = one("SELECT * FROM institutions WHERE id = ?", institutionId);
  const cfg = oauthConfig(institutionId);
  if (!inst || !cfg.ready) return null;
  const state = crypto.randomBytes(24).toString("base64url");
  run("DELETE FROM oauth_states WHERE expires_at < ?", now());
  run("INSERT INTO oauth_states (state_hash, user_id, institution_id, expires_at) VALUES (?, ?, ?, ?)", sha(state), userId, institutionId, new Date(Date.now() + 600e3).toISOString());
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: "code", redirect_uri: cfg.redirectUri, state });
  return `https://${inst.canvas_host}/login/oauth2/auth?${q}`;
}

export async function handleCallback(sessionUserId, { code, state, error }) {
  const row = state && one("SELECT * FROM oauth_states WHERE state_hash = ?", sha(state));
  if (row) run("DELETE FROM oauth_states WHERE state_hash = ?", row.state_hash);
  if (!row || row.expires_at < now() || row.user_id !== sessionUserId) return { ok: false, error: "That Canvas sign-in link expired or belongs to another session. Try connecting again." };
  if (error) return { ok: false, error: error === "access_denied" ? "Canvas access was not granted." : `Canvas said: ${error}` };
  const inst = one("SELECT * FROM institutions WHERE id = ?", row.institution_id);
  const cfg = oauthConfig(inst.id);
  const res = await fetch(`https://${inst.canvas_host}/login/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.secret, redirect_uri: cfg.redirectUri, code }),
  });
  if (!res.ok) return { ok: false, error: `Canvas refused the sign-in (HTTP ${res.status}).` };
  const tok = await res.json();
  saveConnection(sessionUserId, inst.id, "oauth", tok.access_token, tok.refresh_token, tok.expires_in, tok.user);
  return { ok: true };
}

function saveConnection(userId, institutionId, mode, access, refresh, expiresIn, canvasUser) {
  const expires = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  run(`INSERT INTO canvas_connections (id, user_id, institution_id, mode, access_token_enc, refresh_token_enc, expires_at, canvas_user_id, canvas_user_name, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)
       ON CONFLICT (user_id, institution_id) DO UPDATE SET mode = excluded.mode, access_token_enc = excluded.access_token_enc,
         refresh_token_enc = COALESCE(excluded.refresh_token_enc, canvas_connections.refresh_token_enc), expires_at = excluded.expires_at,
         canvas_user_id = excluded.canvas_user_id, canvas_user_name = excluded.canvas_user_name, status = 'ok', last_error = NULL`,
    newId(9), userId, institutionId, mode, encrypt(access), encrypt(refresh), expires, canvasUser?.id != null ? String(canvasUser.id) : null, canvasUser?.name || null, now());
  run("UPDATE users SET institution_id = ? WHERE id = ?", institutionId, userId);
}

export function connectDemo(user) {
  const inst = user.institution_id || "usm";
  const demo = DEMO_CANVAS[user.email];
  saveConnection(user.id, inst, "demo", null, null, null, demo ? demo.user : { id: `demo-${user.id}`, name: user.name });
}
export async function connectDevToken(user, institutionId) {
  if (!devTokenAvailable()) return { ok: false, error: "CANVAS_DEV_TOKEN is not set." };
  const inst = one("SELECT * FROM institutions WHERE id = ?", institutionId);
  const self = await canvasGet(inst.canvas_host, process.env.CANVAS_DEV_TOKEN, "/api/v1/users/self");
  saveConnection(user.id, institutionId, "devtoken", null, null, null, self);
  return { ok: true };
}

export function connectionFor(userId) {
  return one("SELECT c.*, i.canvas_host, i.name AS institution_name FROM canvas_connections c JOIN institutions i ON i.id = c.institution_id WHERE c.user_id = ?", userId);
}

export async function disconnect(userId, removeMaterials) {
  const c = connectionFor(userId);
  if (c?.mode === "oauth") {
    try { await fetch(`https://${c.canvas_host}/login/oauth2/token`, { method: "DELETE", headers: { authorization: `Bearer ${decrypt(c.access_token_enc)}` } }); } catch {}
  }
  tx(() => {
    run("DELETE FROM canvas_connections WHERE user_id = ?", userId);
    if (removeMaterials) run("DELETE FROM materials WHERE source IN ('canvas', 'demo') AND course_id IN (SELECT id FROM courses WHERE owner_id = ?)", userId);
  });
}

// ---------- REST helpers ----------
async function canvasGet(host, token, pathOrUrl, { raw = false } = {}) {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `https://${host}${pathOrUrl}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (res.status === 401) throw Object.assign(new Error("Canvas access expired or was revoked. Reconnect Canvas."), { code: "reauth" });
  if (res.status === 403) throw Object.assign(new Error("Canvas says you don't have permission for this."), { code: "forbidden" });
  if (!res.ok) throw new Error(`Canvas returned HTTP ${res.status} for ${new URL(url).pathname}`);
  return raw ? res : res.json();
}
async function canvasList(host, token, p) {
  const out = [];
  let next = `https://${host}${p}${p.includes("?") ? "&" : "?"}per_page=100`;
  for (let pages = 0; next && pages < 30; pages++) {
    const res = await canvasGet(host, token, next, { raw: true });
    out.push(...(await res.json()));
    next = (res.headers.get("link") || "").split(",").map((s) => s.match(/<([^>]+)>;\s*rel="next"/)?.[1]).find(Boolean) || null;
    if (next && !next.startsWith(`https://${host}/`)) next = null; // only follow links on the same Canvas
  }
  return out;
}

async function tokenFor(c) {
  if (c.mode === "devtoken") return process.env.CANVAS_DEV_TOKEN;
  if (c.expires_at && c.expires_at < new Date(Date.now() + 60e3).toISOString() && c.refresh_token_enc) {
    const cfg = oauthConfig(c.institution_id);
    const res = await fetch(`https://${c.canvas_host}/login/oauth2/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.secret, refresh_token: decrypt(c.refresh_token_enc) }),
    });
    if (!res.ok) { run("UPDATE canvas_connections SET status = 'reauth', last_error = ? WHERE id = ?", `Refresh failed (HTTP ${res.status})`, c.id); throw Object.assign(new Error("Canvas access expired. Reconnect Canvas."), { code: "reauth" }); }
    const tok = await res.json(); // Canvas keeps the same refresh token
    run("UPDATE canvas_connections SET access_token_enc = ?, expires_at = ? WHERE id = ?", encrypt(tok.access_token), new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(), c.id);
    return tok.access_token;
  }
  return decrypt(c.access_token_enc);
}

// ---------- adapters ----------
// Item visibility: "students" only when students can open it in Canvas right now.
function fileVisibility(f, folder) {
  const reasons = [];
  if (f.locked) reasons.push("unpublished in Canvas");
  if (f.hidden) reasons.push("hidden from students in Canvas");
  if (f.unlock_at && f.unlock_at > now()) reasons.push(`opens ${f.unlock_at.slice(0, 10)}`);
  if (f.lock_at && f.lock_at < now()) reasons.push("locked since " + f.lock_at.slice(0, 10));
  if (folder && (folder.locked || folder.hidden)) reasons.push(`folder "${folder.name}" is not visible to students`);
  return reasons.length ? { visibility: "staff", visibility_reason: reasons.join(", ") } : { visibility: "students", visibility_reason: "Published in Canvas" };
}

export class RealAdapter {
  constructor(conn) { this.c = conn; this.label = conn.mode === "devtoken" ? "Canvas (developer token, testing only)" : "Canvas"; this.source = "canvas"; }
  async get(p) { return canvasGet(this.c.canvas_host, await tokenFor(this.c), p); }
  async list(p) { return canvasList(this.c.canvas_host, await tokenFor(this.c), p); }
  async teacherCourses() {
    const cs = await this.list("/api/v1/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&include[]=sections&include[]=term");
    return cs.map((c) => ({ id: String(c.id), name: c.name, code: c.course_code || "", term: c.term?.name || "", url: `https://${this.c.canvas_host}/courses/${c.id}`,
      sections: (c.sections || []).map((s) => ({ id: String(s.id), name: s.name })) }));
  }
  async sections(courseId) { return (await this.list(`/api/v1/courses/${courseId}/sections`)).map((s) => ({ id: String(s.id), name: s.name })); }
  async roster(sectionId) {
    const es = await this.list(`/api/v1/sections/${sectionId}/enrollments?type[]=StudentEnrollment&state[]=active`);
    return es.map((e) => ({ canvas_user_id: String(e.user_id), login_id: e.user?.login_id || null }));
  }
  async myEnrollments() {
    const es = await this.list("/api/v1/users/self/enrollments?type[]=StudentEnrollment&state[]=active");
    return es.map((e) => String(e.course_section_id));
  }
  // Every item: metadata now, text only through fetchParts() (so unchanged items aren't downloaded).
  async items(courseId) {
    const out = [], skipped = [];
    const modules = await this.list(`/api/v1/courses/${courseId}/modules?include[]=items`).catch(() => []);
    const moduleOf = new Map();
    for (const m of modules) for (const it of m.items || []) {
      const key = it.type === "File" ? `file:${it.content_id}` : it.type === "Page" ? `page:${it.page_url}` : null;
      if (key && !moduleOf.has(key)) moduleOf.set(key, m.name);
      if (it.type === "ExternalUrl") out.push({ external_type: "link", external_id: String(it.id), title: it.title, url: it.external_url, kind: "link", module: m.name,
        ...(m.published === false || it.published === false ? { visibility: "staff", visibility_reason: "unpublished module item" } : { visibility: "students", visibility_reason: "Published module link" }),
        source_updated_at: "", fetchParts: async () => [] });
    }
    const folders = new Map((await this.list(`/api/v1/courses/${courseId}/folders`).catch(() => [])).map((f) => [f.id, f]));
    for (const f of await this.list(`/api/v1/courses/${courseId}/files`)) {
      const kind = kindOf(f.display_name || f.filename);
      if (!SUPPORTED.includes(kind)) { skipped.push(f.display_name); continue; }
      out.push({ external_type: "file", external_id: String(f.id), title: f.display_name, url: `https://${this.c.canvas_host}/courses/${courseId}/files/${f.id}`, kind,
        module: moduleOf.get(`file:${f.id}`) || "", ...fileVisibility(f, folders.get(f.folder_id)), source_updated_at: f.updated_at || f.modified_at || "",
        tooLarge: f.size > MAX_FILE,
        fetchParts: async () => {
          const res = await canvasGet(this.c.canvas_host, await tokenFor(this.c), f.url, { raw: true });
          return extractFile(f.display_name, Buffer.from(await res.arrayBuffer()));
        } });
    }
    for (const p of await this.list(`/api/v1/courses/${courseId}/pages`)) {
      const vis = p.published === false ? { visibility: "staff", visibility_reason: "unpublished in Canvas" }
        : p.hide_from_students ? { visibility: "staff", visibility_reason: "hidden from students in Canvas" }
        : { visibility: "students", visibility_reason: "Published in Canvas" };
      out.push({ external_type: "page", external_id: String(p.page_id ?? p.url), title: p.title, url: p.html_url, kind: "page",
        module: moduleOf.get(`page:${p.url}`) || "", ...vis, source_updated_at: p.updated_at || "",
        fetchParts: async () => {
          const full = await this.get(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(p.url)}`);
          const text = htmlToText(full.body);
          return text ? { parts: chunkText(text, p.title.slice(0, 60)), status: "ok", warning: "" } : { parts: [], status: "no_text", warning: "This page has no text." };
        } });
    }
    return { items: out, skipped };
  }
}

export class DemoAdapter {
  constructor(email) { this.data = DEMO_CANVAS[email] || { user: null, courses: [] }; this.label = "Demo Canvas (sample data)"; this.source = "demo"; }
  async teacherCourses() {
    return this.data.courses.map((c) => ({ id: c.id, name: c.name, code: c.course_code, term: c.term, url: "", sections: c.sections.map(({ id, name }) => ({ id, name })) }));
  }
  async sections(courseId) { return (this.data.courses.find((c) => c.id === courseId)?.sections || []).map(({ id, name }) => ({ id, name })); }
  async roster(sectionId) {
    for (const c of this.data.courses) for (const s of c.sections) if (s.id === sectionId) return s.roster.map((email) => ({ canvas_user_id: `demo:${email}`, login_id: email }));
    return [];
  }
  async items(courseId) {
    const c = this.data.courses.find((x) => x.id === courseId);
    if (!c) throw new Error("This demo course no longer exists.");
    return { skipped: [], items: c.items.map((it) => ({
      external_type: it.type, external_id: it.id, title: it.title, url: "", kind: it.kind || "page", module: it.module,
      ...(it.published === false ? { visibility: "staff", visibility_reason: "unpublished (sample data)" } : it.hidden ? { visibility: "staff", visibility_reason: "hidden from students (sample data)" } : { visibility: "students", visibility_reason: "published (sample data)" }),
      source_updated_at: it.updated_at,
      fetchParts: async () => ({ parts: it.parts || chunkText(htmlToText(it.html), it.title), status: "ok", warning: "" }),
    })) };
  }
}

// Tests can swap the adapter factory.
let factory = (conn, user) => (conn.mode === "demo" ? new DemoAdapter(user.email) : new RealAdapter(conn));
export function setAdapterFactory(f) { factory = f; }
export function adapterFor(user) {
  const conn = connectionFor(user.id);
  if (!conn) return null;
  return factory(conn, user);
}

// ---------- import and sync ----------
// selections: [{ canvasCourseId, sectionIds: [...] }]. Courses already linked are reused, never duplicated.
export async function importCourses(user, selections) {
  const ad = adapterFor(user);
  if (!ad) return { ok: false, error: "Connect Canvas first." };
  const available = await ad.teacherCourses();
  const created = [];
  for (const sel of selections) {
    const c = available.find((x) => x.id === String(sel.canvasCourseId));
    if (!c) continue; // only courses this professor teaches in Canvas
    const wanted = c.sections.filter((s) => (sel.sectionIds || []).map(String).includes(s.id));
    if (!wanted.length) continue;
    const courseId = tx(() => {
      let row = one("SELECT id FROM courses WHERE owner_id = ? AND source = ? AND canvas_course_id = ?", user.id, ad.source, c.id);
      if (!row) {
        row = { id: newId(9) };
        run("INSERT INTO courses (id, owner_id, institution_id, name, code, term, source, canvas_course_id, canvas_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          row.id, user.id, user.institution_id || "usm", c.name, c.code, c.term, ad.source, c.id, c.url, now());
      }
      for (const s of wanted) {
        if (!one("SELECT 1 FROM sections WHERE course_id = ? AND canvas_section_id = ?", row.id, s.id))
          run("INSERT INTO sections (id, course_id, name, canvas_section_id, join_code, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId(9), row.id, s.name, s.id, joinCode(), now());
      }
      return row.id;
    });
    created.push(courseId);
  }
  run("UPDATE users SET onboarded = 1 WHERE id = ?", user.id);
  for (const id of created) { await syncRoster(user, id).catch(() => {}); }
  return { ok: true, courseIds: created };
}

// Canvas roster -> Lost enrollments for students who already have Lost accounts (matched by Canvas login id).
export async function syncRoster(user, courseId) {
  const ad = adapterFor(user); if (!ad) return;
  for (const s of all("SELECT * FROM sections WHERE course_id = ? AND canvas_section_id IS NOT NULL", courseId)) {
    const roster = await ad.roster(s.canvas_section_id);
    tx(() => {
      for (const r of roster) {
        run("INSERT OR IGNORE INTO canvas_roster (section_id, canvas_user_id, login_id) VALUES (?, ?, ?)", s.id, r.canvas_user_id, r.login_id);
        const u = r.login_id && one("SELECT id FROM users WHERE email = ? AND role = 'student'", r.login_id.toLowerCase());
        if (u) run("INSERT OR IGNORE INTO enrollments (user_id, section_id, source, created_at) VALUES (?, ?, 'canvas', ?)", u.id, s.id, now());
      }
    });
  }
}

// A student linked Canvas: enroll them in Lost sections that match their Canvas sections.
export async function linkStudent(user) {
  const conn = connectionFor(user.id);
  if (!conn) return { ok: false, error: "Connect Canvas first." };
  const sectionIds = conn.mode === "demo" ? demoStudentSections(user.email) : await new RealAdapter(conn).myEnrollments();
  let added = 0;
  for (const sid of sectionIds) {
    for (const s of all("SELECT id FROM sections WHERE canvas_section_id = ?", sid)) {
      added += run("INSERT OR IGNORE INTO enrollments (user_id, section_id, source, created_at) VALUES (?, ?, 'canvas', ?)", user.id, s.id, now()).changes;
    }
  }
  return { ok: true, added, matched: sectionIds.length };
}

const syncing = new Map(); // course id -> running promise, so double clicks don't run two syncs
export function syncCourse(user, courseId) {
  if (!syncing.has(courseId)) {
    const p = doSync(user, courseId).finally(() => syncing.delete(courseId));
    syncing.set(courseId, p);
  }
  return syncing.get(courseId);
}

async function doSync(user, courseId) {
  const course = one("SELECT * FROM courses WHERE id = ? AND owner_id = ?", courseId, user.id);
  if (!course || course.source === "manual") return { ok: false, error: "This course isn't linked to Canvas." };
  const runId = newId(9);
  run("INSERT INTO sync_runs (id, course_id, status, started_at) VALUES (?, ?, 'running', ?)", runId, courseId, now());
  const stats = { added: 0, updated: 0, unchanged: 0, removed: 0 }, errors = [];
  let status = "ok";
  try {
    const ad = adapterFor(user);
    if (!ad) throw new Error("Canvas is not connected.");
    if (ad.source !== course.source) throw new Error("This course was imported from a different Canvas connection.");
    const { items, skipped } = await ad.items(course.canvas_course_id);
    if (skipped.length) errors.push({ title: `${skipped.length} file(s) of other types`, error: "Skipped: Lost reads PDF, PPTX, DOCX, TXT and pages." });
    const seen = new Set();
    for (const it of items) {
      seen.add(`${it.external_type}:${it.external_id}`);
      const existing = one("SELECT * FROM materials WHERE course_id = ? AND source = ? AND external_type = ? AND external_id = ?", courseId, ad.source, it.external_type, it.external_id);
      const base = { course_id: courseId, source: ad.source, ...it };
      try {
        if (existing && existing.status !== "removed" && existing.source_updated_at === it.source_updated_at && existing.status === "ok") {
          // Text unchanged in Canvas: refresh metadata only (visibility can change without an edit).
          run("UPDATE materials SET title = ?, url = ?, module = ?, visibility = ?, visibility_reason = ?, synced_at = ? WHERE id = ?",
            it.title, it.url, it.module, it.visibility, it.visibility_reason, now(), existing.id);
          stats[existing.visibility === it.visibility ? "unchanged" : "updated"]++;
          continue;
        }
        if (it.tooLarge) { const r = upsertMaterial({ ...base, parts: [], status: "unsupported", warning: "Larger than 15 MB, not imported." }); stats[r.result]++; continue; }
        const got = await it.fetchParts();
        const r = upsertMaterial({ ...base, parts: got.parts || [], status: got.status || "ok", warning: got.warning || "" });
        stats[r.result]++;
      } catch (e) {
        errors.push({ title: it.title, error: e.message });
        if (e.code === "reauth") throw e;
      }
    }
    // Items gone from Canvas: drop their text so it can't be cited, keep a "removed" row for the record.
    for (const m of all("SELECT id, external_type, external_id FROM materials WHERE course_id = ? AND source = ? AND status != 'removed'", courseId, ad.source)) {
      if (!seen.has(`${m.external_type}:${m.external_id}`)) {
        tx(() => { run("DELETE FROM passages WHERE material_id = ?", m.id); run("UPDATE materials SET status = 'removed', synced_at = ? WHERE id = ?", now(), m.id); });
        stats.removed++;
      }
    }
    if (errors.some((e) => !e.title.endsWith("of other types"))) status = "partial";
    await syncRoster(user, courseId).catch((e) => errors.push({ title: "Roster", error: e.message }));
  } catch (e) {
    status = "failed"; errors.push({ title: "Sync", error: e.message });
    if (e.code === "reauth") run("UPDATE canvas_connections SET status = 'reauth', last_error = ? WHERE user_id = ?", e.message, user.id);
  }
  run("UPDATE sync_runs SET status = ?, added = ?, updated = ?, unchanged = ?, removed = ?, errors = ?, finished_at = ? WHERE id = ?",
    status, stats.added, stats.updated, stats.unchanged, stats.removed, JSON.stringify(errors.slice(0, 50)), now(), runId);
  return { ok: status !== "failed", status, ...stats, errors };
}

export function lastSync(courseId) {
  const last = one("SELECT * FROM sync_runs WHERE course_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1", courseId);
  const lastOk = one("SELECT finished_at FROM sync_runs WHERE course_id = ? AND status IN ('ok', 'partial') ORDER BY started_at DESC, rowid DESC LIMIT 1", courseId);
  return last ? { status: last.status, startedAt: last.started_at, finishedAt: last.finished_at, lastSuccess: lastOk?.finished_at || null,
    added: last.added, updated: last.updated, unchanged: last.unchanged, removed: last.removed, errors: parse(last.errors, []) } : null;
}
