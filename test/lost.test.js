// End-to-end tests against a real server on a random port, an in-memory database, demo Canvas
// fixtures and a deterministic fake AI. No network, no real Canvas, no real model.
// Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lost-test-"));
Object.assign(process.env, { LOST_AI: "off", TRANSCRIBER: "off", LOST_DATA: tmp, LOST_DEMO: "1", LOST_END_SETTLE_MS: "50", PROF_SIGNUP_CODE: "invite-123", LOST_HELP_BURST: "1000" });
// (the per-student help limit is tested on its own below; the other tests fire requests faster than a person would)
delete process.env.ANTHROPIC_API_KEY; delete process.env.DEEPGRAM_API_KEY; delete process.env.CANVAS_CLIENT_ID; delete process.env.PUBLIC_URL;

const { boot } = await import("../server.js");
const ai = await import("../lib/ai.js");
const db = await import("../lib/db.js");
const jobs = await import("../lib/jobs.js");
const live = await import("../lib/live.js");
const canvas = await import("../lib/canvas.js");
const mat = await import("../lib/materials.js");

let server, base;
const prompts = [];
let aiMode = "ok", aiDelay = 0, aiCalls = 0;

// Deterministic fake model: answers from the ids it finds in the prompt, plus deliberately bad
// ids so the tests can see Lost drop them.
function fakeAi({ prompt, label }) {
  aiCalls++; prompts.push({ label, prompt });
  const wait = aiDelay ? new Promise((r) => setTimeout(r, aiDelay)) : Promise.resolve();
  return wait.then(() => {
    if (aiMode === "rate") return new ai.AiError("rate_limited", "429");
    if (aiMode === "timeout") return new ai.AiError("timeout", "slow");
    const lines = [...prompt.matchAll(/\bL(\d+) \[/g)].map((m) => Number(m[1]));
    const pas = [...prompt.matchAll(/id="P(\d+)"/g)].map((m) => `P${m[1]}`);
    const marked = Number(prompt.match(/L(\d+) [^\n]*<<< student is lost here/)?.[1] ?? lines.at(-1) ?? 0);
    if (label.startsWith("help:")) {
      return {
        enough_evidence: aiMode !== "thin", clarify_question: aiMode === "thin" ? "Which word was unclear?" : "", topic: "Two-dimensional parity",
        explanation: { text: "Rows and columns each get a parity bit.", terms: [{ term: "parity bit", definition: "an extra bit that makes the count of 1s even" }],
          example: { text: "Grid 1010 / 1100", origin: "lecture", ref: `L${marked}` } },
        context: { text: "It builds on single parity.", refs: [`L${marked}`, ...pas.slice(0, 1), "P99999", "L9999"] },
        flow: { previous: lines.length > 1 ? { label: "Single parity", ref: `L${lines[0]}` } : null, current: { label: "2D parity", ref: `L${marked}` },
          next: { label: "Guessed future topic", ref: `L${lines[0]}` } },
        diagnostic: label === "help:explain" ? { question: "What does one parity bit catch?", choices: ["one flipped bit", "two flipped bits", "nothing"], correct_index: 0, prerequisite: "single parity" } : null,
      };
    }
    if (label === "check") return { question: "Row 0110 has which even parity bit?", choices: ["0", "1"], correct_index: 0, why: "Two 1s is already even." };
    if (label === "catchup") return { happened: "The professor moved on.", current_topic: "Checksums", connection: "Both detect errors.", refs: lines.slice(-1).map((l) => `L${l}`) };
    if (label === "summary") {
      const moments = [...prompt.matchAll(/Moment (\d+):/g)];
      return {
        main_topics: [{ title: "2D parity", text: "Grids of parity bits.", refs: [`L${lines[0]}`] }],
        concepts: [{ term: "Parity", definition: "even count of ones", refs: [] }],
        examples: [{ text: "Invented example", origin: "lecture", refs: ["L9999"] }],
        flow: { title: "Build-up", steps: [{ label: "Parity", ref: `L${lines[0]}` }, { label: "2D parity", ref: `L${lines.at(-1)}` }] },
        deadlines: [{ text: "Homework due Friday", refs: ["P99999"] }],
        moments: moments.map(() => ({ topic: "2D parity", evidence: [`L${lines[0]}`], review: { question: "Which check fails?", choices: ["row", "none", "all"], correct_index: 0, why: "A flipped bit breaks its row." } })),
      };
    }
    if (label.startsWith("prof:")) return { text: "Draft text." };
    throw new Error(`unexpected label ${label}`);
  });
}

class Client {
  constructor() { this.cookie = ""; this.csrf = ""; }
  async req(method, p, body, { raw } = {}) {
    const headers = { cookie: this.cookie };
    if (method !== "GET" && this.csrf) headers["x-lost-csrf"] = this.csrf;
    if (body !== undefined && !raw) headers["content-type"] = "application/json";
    const res = await fetch(base + p, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: "manual" });
    const set = res.headers.get("set-cookie"); if (set) this.cookie = set.split(";")[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, res };
  }
  get(p) { return this.req("GET", p); }
  post(p, b = {}) { return this.req("POST", p, b); }
  async demo(who) {
    const r = await this.req("POST", "/api/auth/demo", { who });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    this.csrf = (await this.get("/api/me")).data.csrf;
    return this;
  }
}
const as = (who) => new Client().demo(who);

before(async () => {
  server = await boot({ dbFile: ":memory:", port: 0, engines: false, jobsAuto: false });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); jobs.stopJobs(); fs.rmSync(tmp, { recursive: true, force: true }); });

const courseByCode = async (prof, code) => (await prof.get("/api/prof/courses")).data.courses.find((c) => c.code === code);
async function liveSession(prof, code = "CSC 311", sectionIdx = 0) {
  const c = await courseByCode(prof, code);
  const d = (await prof.get(`/api/prof/courses/${c.id}`)).data;
  const sec = d.sections[sectionIdx];
  // a class that was just ended takes a moment to finish; wait so the new one isn't a resume
  for (let i = 0; i < 100 && db.one("SELECT 1 FROM lecture_sessions WHERE section_id = ? AND status = 'ending'", sec.id); i++) await new Promise((r) => setTimeout(r, 20));
  const s = (await prof.post(`/api/prof/courses/${c.id}/sessions`, { sectionId: sec.id, title: "Error detection" })).data;
  await prof.post(`/api/prof/sessions/${s.id}/start`);
  return { course: c, section: sec, sid: s.id };
}
const say = (prof, sid, text) => prof.post(`/api/prof/sessions/${sid}/line`, { text, origin: "typed" });
async function endAndSummarise(prof, sid) {
  await prof.post(`/api/prof/sessions/${sid}/end`);
  for (let i = 0; i < 50 && db.one("SELECT status FROM lecture_sessions WHERE id = ?", sid).status !== "ended"; i++) await new Promise((r) => setTimeout(r, 20));
  await drain();
}
const drain = async () => { for (let i = 0; i < 20 && (await jobs.tick()); i++); };

// ---------------------------------------------------------------------------------------------
test("a professor with three courses sees three separate cards; another professor sees none of them", async () => {
  const rivera = await as("prof"), okafor = await as("prof2");
  const mine = (await rivera.get("/api/prof/courses")).data.courses;
  assert.deepEqual(mine.map((c) => c.code).sort(), ["CSC 202", "CSC 311", "CSC 415"]);
  assert.ok(mine.every((c) => c.sync?.status === "ok" && c.source === "demo"));
  assert.equal((await okafor.get("/api/prof/courses")).data.courses.length, 0);
  // Okafor cannot open, sync or start a session in Rivera's course
  const id = mine[0].id;
  assert.equal((await okafor.get(`/api/prof/courses/${id}`)).status, 404);
  assert.equal((await okafor.post(`/api/prof/courses/${id}/sync`)).status, 404);
  const sec = (await rivera.get(`/api/prof/courses/${id}`)).data.sections[0].id;
  assert.equal((await okafor.post(`/api/prof/courses/${id}/sessions`, { sectionId: sec })).status, 404);
});

test("onboarding: demo Canvas import lists only the professor's own Canvas courses and never duplicates", async () => {
  const okafor = await as("prof2");
  const st = (await okafor.get("/api/canvas/status")).data;
  assert.equal(st.institutions[0].canvas_host, "usm.instructure.com");
  assert.equal(st.oauth.ready, false);
  assert.ok(st.oauth.missing.includes("CANVAS_CLIENT_ID"));
  assert.equal((await okafor.post("/api/canvas/connect", { mode: "oauth" })).status, 400); // pick institution first
  await okafor.post("/api/canvas/institution", { institutionId: "usm" });
  assert.equal((await okafor.post("/api/canvas/connect", { mode: "oauth" })).status, 400); // not configured: no fake redirect
  await okafor.post("/api/canvas/connect", { mode: "demo" });
  const list = (await okafor.get("/api/prof/canvas/courses")).data;
  assert.deepEqual(list.courses.map((c) => c.code), ["STA 301"]);
  const sel = [{ canvasCourseId: list.courses[0].id, sectionIds: [list.courses[0].sections[0].id] }];
  await okafor.post("/api/prof/canvas/import", { selections: sel });
  await okafor.post("/api/prof/canvas/import", { selections: sel });
  // Importing a course that belongs to another professor's Canvas does nothing
  await okafor.post("/api/prof/canvas/import", { selections: [{ canvasCourseId: "demo-c-311", sectionIds: ["demo-s-311-001"] }] });
  const courses = (await okafor.get("/api/prof/courses")).data.courses;
  assert.equal(courses.length, 1);
  assert.equal(courses[0].sections.length, 1);
});

test("students join the right section; a code for another section of the same course is refused", async () => {
  const rivera = await as("prof"), sam = await as("sam"), jordan = await as("jordan"), riley = await as("riley");
  const c = await courseByCode(rivera, "CSC 311");
  const secs = (await rivera.get(`/api/prof/courses/${c.id}`)).data.sections;
  // Jordan and Riley were matched from the Canvas roster
  const jc = (await jordan.get("/api/student/courses")).data.courses.find((x) => x.code === "CSC 311");
  const rc = (await riley.get("/api/student/courses")).data.courses.find((x) => x.code === "CSC 311");
  assert.equal(jc.section_id, secs[0].id);
  assert.equal(rc.section_id, secs[1].id);
  const bad = await sam.post("/api/student/join", { code: "ZZZZZZ" });
  assert.equal(bad.status, 404);
  const ok = await sam.post("/api/student/join", { code: secs[1].join_code.toLowerCase() });
  assert.equal(ok.data.section.id, secs[1].id);
  const twice = await sam.post("/api/student/join", { code: secs[0].join_code });
  assert.equal(twice.status, 409);
  const samCourses = (await sam.get("/api/student/courses")).data.courses;
  assert.equal(samCourses.filter((x) => x.code === "CSC 311").length, 1);
});

test("access rules: other sections, other students' events, wrong role, no CSRF, signed out", async () => {
  const rivera = await as("prof"), jordan = await as("jordan"), riley = await as("riley");
  const { sid } = await liveSession(rivera); // section 001: Jordan's, not Riley's
  await say(rivera, sid, "Single parity adds one bit.");
  assert.equal((await riley.get(`/api/student/sessions/${sid}/live`)).status, 404);
  assert.equal((await riley.post(`/api/student/sessions/${sid}/lost`)).status, 404);
  const ev = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data.event;
  assert.equal((await riley.post(`/api/student/events/${ev.id}/status`, { status: "resolved" })).status, 404);
  assert.equal((await riley.post(`/api/student/events/${ev.id}/help`, { kind: "explain" })).status, 404);
  assert.equal((await jordan.get("/api/prof/courses")).status, 403);
  assert.equal((await rivera.get("/api/student/courses")).status, 403);
  const noCsrf = new Client(); noCsrf.cookie = jordan.cookie;
  assert.equal((await noCsrf.post(`/api/student/events/${ev.id}/status`, { status: "resolved" })).status, 403);
  assert.equal((await new Client().get("/api/prof/courses")).status, 401);
  // a student can't sign up as a professor without the invite code
  const s = await new Client().post("/api/auth/signup", { name: "Eve", email: "eve@example.edu", password: "longenough1", role: "professor" });
  assert.equal(s.status, 403);
  const s2 = await new Client().post("/api/auth/signup", { name: "Prof New", email: "new@example.edu", password: "longenough1", role: "professor", profCode: "invite-123" });
  assert.equal(s2.status, 200);
  await rivera.post(`/api/prof/sessions/${sid}/end`);
});

test("professor-only Canvas content never reaches student retrieval or the AI prompt", async () => {
  const rivera = await as("prof");
  const c = await courseByCode(rivera, "CSC 311");
  const mats = (await rivera.get(`/api/prof/courses/${c.id}`)).data.materials;
  const vis = Object.fromEntries(mats.map((m) => [m.title, m.visibility]));
  assert.equal(vis["Exam 2 answer key.docx"], "staff");
  assert.equal(vis["Instructor notes: common mistakes"], "staff");
  assert.equal(vis["Quiz 3 draft.pdf"], "staff");
  assert.equal(vis["07-error-detection.pptx"], "students");
  const student = mat.retrieve(c.id, "answer key corrected codeword two-bit errors students mix up detecting correcting draft quiz ethernet", { limit: 10, audience: "student" });
  for (const p of student) {
    assert.notEqual(p.visibility, "staff");
    assert.ok(!/answer key|Private:|mix up detecting|Draft quiz/i.test(p.text), p.text);
  }
  const staff = mat.retrieve(c.id, "answer key corrected codeword", { limit: 10, audience: "staff" });
  assert.ok(staff.some((p) => /answer key/i.test(p.text)));

  ai.setFakeProvider(fakeAi); aiMode = "ok"; prompts.length = 0;
  const jordan = await as("jordan");
  const { sid } = await liveSession(rivera);
  await say(rivera, sid, "What's on the answer key for question 4 and the corrected codeword? Students mix up detecting and correcting.");
  const ev = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data.event;
  await jordan.post(`/api/student/events/${ev.id}/help`, { kind: "explain" });
  const p = prompts.find((x) => x.label === "help:explain").prompt;
  const materialText = [...p.matchAll(/<material[\s\S]*?<\/material>/g)].map((m) => m[0]).join("\n");
  assert.ok(!/1011 0110|Private:|Spend extra time|Draft quiz/.test(materialText), "staff text leaked into the prompt");
  await rivera.post(`/api/prof/sessions/${sid}/end`);
  ai.setFakeProvider(null);
});

test("syncs: repeating changes nothing, failures are recorded, removed items lose their text", async () => {
  const rivera = await as("prof");
  const c = await courseByCode(rivera, "CSC 202");
  const before = db.one("SELECT COUNT(*) n FROM materials WHERE course_id = ?", c.id).n;
  const again = (await rivera.post(`/api/prof/courses/${c.id}/sync`)).data;
  assert.equal(again.added, 0); assert.equal(again.updated, 0); assert.ok(again.unchanged >= 1);
  assert.equal(db.one("SELECT COUNT(*) n FROM materials WHERE course_id = ?", c.id).n, before);

  const user = db.one("SELECT * FROM users WHERE email = 'dr.rivera@demo.lost'");
  // Canvas down: sync fails, nothing is deleted
  canvas.setAdapterFactory(() => ({ source: "demo", label: "x", items: async () => { throw new Error("Canvas returned HTTP 503"); }, roster: async () => [] }));
  const failed = await canvas.syncCourse(user, c.id);
  assert.equal(failed.status, "failed");
  assert.equal(db.one("SELECT COUNT(*) n FROM materials WHERE course_id = ? AND status = 'ok'", c.id).n, before);
  const info = (await rivera.get(`/api/prof/courses/${c.id}`)).data.sync;
  assert.equal(info.status, "failed"); assert.ok(info.lastSuccess); assert.match(info.errors[0].error, /503/);
  // One item fails to download, one disappears, one changes
  canvas.setAdapterFactory(() => ({ source: "demo", label: "x", roster: async () => [], items: async () => ({ skipped: [], items: [
    { external_type: "page", external_id: "p-202-rec", title: "Recursion notes", url: "", kind: "page", module: "Week 9", visibility: "students", visibility_reason: "", source_updated_at: "2026-11-05T00:00:00Z",
      fetchParts: async () => ({ parts: [{ loc: "Recursion notes", text: "Updated: the base case stops recursion." }], status: "ok" }) },
    { external_type: "file", external_id: "new-broken", title: "broken.pdf", url: "", kind: "pdf", module: "", visibility: "students", visibility_reason: "", source_updated_at: "x",
      fetchParts: async () => { throw new Error("download failed"); } },
  ] }) }));
  const partial = await canvas.syncCourse(user, c.id);
  assert.equal(partial.status, "partial"); assert.equal(partial.updated, 1);
  assert.ok(mat.retrieve(c.id, "base case stops", { audience: "student" }).some((p) => /Updated/.test(p.text)));
  // Now the page is gone from Canvas
  canvas.setAdapterFactory(() => ({ source: "demo", label: "x", roster: async () => [], items: async () => ({ skipped: [], items: [] }) }));
  const removed = await canvas.syncCourse(user, c.id);
  assert.equal(removed.removed, 1);
  assert.equal(mat.retrieve(c.id, "base case recursion", { audience: "student" }).length, 0);
  canvas.setAdapterFactory((conn, u) => (conn.mode === "demo" ? new canvas.DemoAdapter(u.email) : new canvas.RealAdapter(conn)));
  const restored = await canvas.syncCourse(user, c.id);
  assert.equal(restored.updated, 1); // the page comes back without a duplicate row
  assert.equal(db.one("SELECT COUNT(*) n FROM materials WHERE course_id = ? AND external_id = 'p-202-rec'", c.id).n, 1);
});

test("the full help flow: explain, cleaned citations, diagnostic, retry, check, catch-up, while class continues", async () => {
  ai.setFakeProvider(fakeAi); aiMode = "ok"; aiCalls = 0;
  const rivera = await as("prof"), jordan = await as("jordan");
  const { sid } = await liveSession(rivera);
  await say(rivera, sid, "Single parity adds one bit so the number of ones is even.");
  await say(rivera, sid, "Two-dimensional parity puts the bits in a grid.");
  const tap = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data;
  assert.equal(tap.phrases.length, 2);
  const again = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data;
  assert.equal(again.event.id, tap.event.id, "a double tap is one event");
  const r = (await jordan.post(`/api/student/events/${tap.event.id}/help`, { kind: "explain", anchor: "phrase", line: 1, category: "reasoning" })).data;
  assert.equal(r.status, "ok");
  const card = r.payload;
  assert.equal(card.explanation.example.origin, "lecture");
  assert.equal(card.explanation.example.source.idx, 1);
  assert.ok(card.context.sources.every((s) => s.id !== "P99999" && s.id !== "L9999"), "invented citations removed");
  assert.equal(card.flow.next, null, "a 'next' that wasn't said after the line is dropped");
  assert.equal(card.flow.previous.source.idx, 0);
  assert.ok(card.diagnostic && card.diagnostic.correct_index === undefined, "answer stays on the server");
  // asking again returns the stored card, no new AI call
  const calls = aiCalls;
  await jordan.post(`/api/student/events/${tap.event.id}/help`, { kind: "explain" });
  assert.equal(aiCalls, calls);
  // wrong diagnostic answer -> prerequisite explanation attached to the same event
  const ans = (await jordan.post(`/api/student/checks/${card.diagnostic.id}/answer`, { chosen: 1 })).data;
  assert.equal(ans.correct, false); assert.equal(ans.correctIndex, 0);
  const pre = (await jordan.post(`/api/student/events/${tap.event.id}/help`, { kind: "prereq", attempt: 1 })).data;
  assert.equal(pre.status, "ok");
  // still confused -> a different explanation, same event
  await jordan.post(`/api/student/events/${tap.event.id}/status`, { status: "still" });
  const retry = (await jordan.post(`/api/student/events/${tap.event.id}/help`, { kind: "retry", attempt: 1 })).data;
  assert.equal(retry.status, "ok");
  assert.match(prompts.at(-1).prompt, /<previous>/);
  // the lecture continues; catch-up covers only what came after the tap
  await say(rivera, sid, "Next, the Internet checksum adds 16-bit words.");
  const cu = (await jordan.post(`/api/student/events/${tap.event.id}/help`, { kind: "catchup", attempt: 1 })).data;
  assert.equal(cu.payload.ai, true);
  assert.equal(cu.payload.lineCount, 1);
  assert.match(cu.payload.sources[0].text, /checksum/);
  // comprehension check graded on the server
  const q = (await jordan.post(`/api/student/events/${tap.event.id}/check`)).data;
  assert.equal(q.correct_index, undefined);
  assert.equal((await jordan.post(`/api/student/checks/${q.id}/answer`, { chosen: 0 })).data.correct, true);
  assert.equal(db.all("SELECT * FROM help_responses WHERE event_id = ?", tap.event.id).length, 4);
  await rivera.post(`/api/prof/sessions/${sid}/end`);
  ai.setFakeProvider(null);
});

test("several students at once, and duplicate requests share one AI call", async () => {
  ai.setFakeProvider(fakeAi); aiMode = "ok"; aiDelay = 80; aiCalls = 0;
  const rivera = await as("prof"), jordan = await as("jordan");
  const { sid, section } = await liveSession(rivera);
  const extra = [];
  for (let i = 0; i < 4; i++) {
    const c = new Client();
    await c.post("/api/auth/signup", { name: `Student ${i}`, email: `s${i}@example.edu`, password: "longenough1", role: "student" });
    c.csrf = (await c.get("/api/me")).data.csrf;
    await c.post("/api/student/join", { code: section.join_code });
    extra.push(c);
  }
  await say(rivera, sid, "Two-dimensional parity can correct one flipped bit.");
  const all5 = [jordan, ...extra];
  const evs = await Promise.all(all5.map((c) => c.post(`/api/student/sessions/${sid}/lost`).then((r) => r.data.event.id)));
  assert.equal(new Set(evs).size, 5);
  const outs = await Promise.all(all5.map((c, i) => c.post(`/api/student/events/${evs[i]}/help`, { kind: "explain" })));
  assert.ok(outs.every((o) => o.data.status === "ok"));
  aiCalls = 0;
  const dup = await Promise.all([1, 2, 3].map(() => jordan.post(`/api/student/events/${evs[0]}/help`, { kind: "retry", attempt: 1 })));
  assert.equal(aiCalls, 1, "three identical clicks, one AI call");
  assert.equal(new Set(dup.map((d) => d.data.id)).size, 1);
  aiDelay = 0;
  await rivera.post(`/api/prof/sessions/${sid}/end`);
  ai.setFakeProvider(null);
});

test("AI rate-limited or off: the student still gets the excerpt and course materials", async () => {
  const rivera = await as("prof"), jordan = await as("jordan");
  const { sid } = await liveSession(rivera);
  await say(rivera, sid, "Two-dimensional parity uses a grid of row and column parity bits.");
  ai.setFakeProvider(fakeAi); aiMode = "rate";
  const ev = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data.event;
  const r = (await jordan.post(`/api/student/events/${ev.id}/help`, { kind: "explain" })).data;
  assert.equal(r.status, "failed"); assert.match(r.error, /busy|rate/i);
  assert.equal(r.payload.ai, false);
  assert.ok(r.payload.excerpt.length >= 1);
  assert.ok(r.payload.passages.some((p) => /grid of rows and columns/.test(p.text)));
  // once the AI is back, the same request can be retried and succeeds
  aiMode = "ok";
  const ok = (await jordan.post(`/api/student/events/${ev.id}/help`, { kind: "explain" })).data;
  assert.equal(ok.status, "ok");
  ai.setFakeProvider(null); // provider "off"
  await new Promise((res) => setTimeout(res, 8100)); // past the double-tap window
  const ev2 = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data.event;
  const off = (await jordan.post(`/api/student/events/${ev2.id}/help`, { kind: "explain" })).data;
  assert.equal(off.status, "no_ai"); assert.equal(off.payload.ai, false);
  assert.equal((await jordan.post(`/api/student/events/${ev2.id}/check`)).status, 503);
  await rivera.post(`/api/prof/sessions/${sid}/end`);
});

test("transcript gaps are recorded and shown; thin evidence asks for clarification", async () => {
  const rivera = await as("prof"), jordan = await as("jordan");
  const { sid } = await liveSession(rivera);
  const rt = live.runtime(sid);
  rt.lastAudioAt = Date.now() - 10000; // pretend audio stopped 10 s ago
  live.checkGaps();
  const gaps = (await rivera.get(`/api/prof/sessions/${sid}/live`)).data.gaps;
  assert.equal(gaps.length, 1); assert.equal(gaps[0].to_t, null);
  live.audioPiece(sid, Buffer.from("x"), true); // audio is back
  assert.notEqual(db.one("SELECT to_t FROM transcript_gaps WHERE session_id = ?", sid).to_t, null);
  ai.setFakeProvider(fakeAi); aiMode = "thin";
  const tap = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data;
  assert.equal(tap.gaps.length, 1);
  const r = (await jordan.post(`/api/student/events/${tap.event.id}/help`, { kind: "explain" })).data;
  assert.equal(r.payload.enough, false);
  assert.equal(r.payload.clarify, "Which word was unclear?");
  aiMode = "ok"; ai.setFakeProvider(null);
  await rivera.post(`/api/prof/sessions/${sid}/end`);
});

test("ending class while a help request is running; summary after a restart; no duplicate notifications", async () => {
  ai.setFakeProvider(fakeAi); aiMode = "ok"; aiDelay = 200;
  const rivera = await as("prof"), jordan = await as("jordan");
  const { sid } = await liveSession(rivera);
  await say(rivera, sid, "Single parity misses two flipped bits.");
  await say(rivera, sid, "Two-dimensional parity finds the bad row and column.");
  const ev = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data.event;
  const pending = jordan.post(`/api/student/events/${ev.id}/help`, { kind: "explain" });
  await new Promise((r) => setTimeout(r, 20));
  await rivera.post(`/api/prof/sessions/${sid}/end`);
  assert.equal((await say(rivera, sid, "too late")).status, 409, "no new lines after End");
  const done = (await pending).data;
  assert.equal(done.status, "ok", "the running request finishes and stays attached");
  aiDelay = 0;
  for (let i = 0; i < 50 && db.one("SELECT status FROM lecture_sessions WHERE id = ?", sid).status !== "ended"; i++) await new Promise((r) => setTimeout(r, 20));
  // Simulate a crash mid-job: the job is "running" with nobody running it.
  db.run("UPDATE jobs SET status = 'running', lease_until = ? WHERE ref_id = ?", new Date(Date.now() + 60e3).toISOString(), sid);
  await drain();
  assert.equal(jobs.jobFor("summary", sid).status, "running", "a live lease isn't stolen");
  assert.ok(jobs.recoverJobs() >= 1); // what boot() does after a restart
  await drain();
  const rep = (await rivera.get(`/api/prof/sessions/${sid}/report`)).data;
  assert.equal(rep.summary.status, "ready");
  assert.equal(rep.summary.payload.shared.deadlines.length, 0, "a deadline without a real source is dropped");
  assert.equal(rep.summary.payload.shared.examples[0].origin, "ai", "an example citing a missing line is relabelled");
  // run it again: same summary, still one notification per person
  jobs.enqueue("summary", sid, { restart: true });
  await drain();
  assert.equal(db.one("SELECT COUNT(*) n FROM notifications WHERE ref_id = ? AND user_id = (SELECT id FROM users WHERE email = 'jordan@demo.lost')", sid).n, 1);
  const view = (await jordan.get(`/api/student/sessions/${sid}`)).data;
  assert.equal(view.summaryState, "ready");
  assert.equal(view.events.length, 1);
  assert.ok(view.events[0].review, "unresolved moment gets a review question");
  assert.equal(view.events[0].review.correctIndex, undefined);
  // the shared summary never carries a student's private question
  assert.ok(!JSON.stringify(view.summary).includes(ev.id));
  ai.setFakeProvider(null);
});

test("summary failures show as failed with retry, not as an empty summary", async () => {
  ai.setFakeProvider(fakeAi); aiMode = "timeout";
  const rivera = await as("prof");
  const { sid } = await liveSession(rivera, "CSC 415");
  await say(rivera, sid, "Round robin gives each process a time quantum.");
  await endAndSummarise(rivera, sid);
  let rep = (await rivera.get(`/api/prof/sessions/${sid}/report`)).data;
  assert.equal(rep.summary.status, "pending"); assert.equal(rep.job.status, "pending"); assert.equal(rep.job.attempts, 1);
  for (let i = 0; i < 3; i++) { db.run("UPDATE jobs SET run_after = ? WHERE ref_id = ?", new Date(0).toISOString(), sid); await drain(); }
  rep = (await rivera.get(`/api/prof/sessions/${sid}/report`)).data;
  assert.equal(rep.summary.status, "failed"); assert.equal(rep.job.status, "failed");
  assert.equal(db.one("SELECT published FROM session_summaries WHERE session_id = ?", sid).published, 0);
  aiMode = "ok";
  await rivera.post(`/api/prof/sessions/${sid}/retry-summary`);
  await drain();
  assert.equal((await rivera.get(`/api/prof/sessions/${sid}/report`)).data.summary.status, "ready");
  ai.setFakeProvider(null);
});

test("resolution counts: only 'That helped' resolves; checks are counted separately", async () => {
  ai.setFakeProvider(fakeAi); aiMode = "ok";
  const rivera = await as("prof"), jordan = await as("jordan");
  const { sid, course } = await liveSession(rivera, "CSC 202");
  await say(rivera, sid, "A recursive function calls itself on a smaller input.");
  const before = (await jordan.get(`/api/student/courses/${course.id}`)).data.stats;
  const e1 = (await jordan.post(`/api/student/sessions/${sid}/lost`)).data.event;
  await jordan.post(`/api/student/events/${e1.id}/help`, { kind: "explain" }); // opening an explanation
  let s = (await jordan.get(`/api/student/courses/${course.id}`)).data.stats;
  assert.equal(s.total, before.total + 1);
  assert.equal(s.resolved, before.resolved, "opening an explanation is not resolving");
  const q = (await jordan.post(`/api/student/events/${e1.id}/check`)).data;
  await jordan.post(`/api/student/checks/${q.id}/answer`, { chosen: 0 });
  s = (await jordan.get(`/api/student/courses/${course.id}`)).data.stats;
  assert.equal(s.resolved, before.resolved, "passing a check is not the same as marking resolved");
  assert.equal(s.checksPassed, before.checksPassed + 1);
  await jordan.post(`/api/student/events/${e1.id}/status`, { status: "resolved" });
  s = (await jordan.get(`/api/student/courses/${course.id}`)).data.stats;
  assert.equal(s.resolved, before.resolved + 1); assert.equal(s.unresolved, before.unresolved);
  await endAndSummarise(rivera, sid);
  const a = (await rivera.get(`/api/prof/sessions/${sid}/report`)).data.analytics;
  assert.equal(a.totals.taps, 1); assert.equal(a.totals.students, 1); assert.equal(a.totals.resolved, 1);
  assert.equal(a.totals.categories, null, "one student: no breakdown");
  assert.equal(a.moments[0].small, true); assert.equal(a.moments[0].students, null);
  ai.setFakeProvider(null);
});

test("one open session per section: starting twice resumes", async () => {
  const rivera = await as("prof");
  const c = await courseByCode(rivera, "CSC 415");
  const sec = (await rivera.get(`/api/prof/courses/${c.id}`)).data.sections[0].id;
  const [a, b] = await Promise.all([rivera.post(`/api/prof/courses/${c.id}/sessions`, { sectionId: sec }), rivera.post(`/api/prof/courses/${c.id}/sessions`, { sectionId: sec })]);
  assert.equal(a.data.id, b.data.id);
  assert.equal(db.one("SELECT COUNT(*) n FROM lecture_sessions WHERE section_id = ? AND status != 'ended'", sec).n, 1);
  await rivera.post(`/api/prof/sessions/${a.data.id}/end`); // a never-started session is discarded
  assert.equal(db.one("SELECT COUNT(*) n FROM lecture_sessions WHERE id = ?", a.data.id).n, 0);
});

test("join links and pages: signed-out users go to sign-in, wrong role goes home", async () => {
  const anon = new Client();
  let r = await anon.get("/join/ABC234");
  assert.equal(r.res.status, 302); assert.match(r.res.headers.get("location"), /^\/login\?next=/);
  r = await anon.get("/prof"); assert.match(r.res.headers.get("location"), /^\/login/);
  const jordan = await as("jordan");
  r = await jordan.get("/prof"); assert.equal(r.res.headers.get("location"), "/student");
  r = await jordan.get("/join/ABC234"); assert.equal(r.res.headers.get("location"), "/student#/join/ABC234");
  assert.match((await jordan.get("/student")).res.headers.get("content-security-policy"), /script-src 'self'/);
});

test("AI output validation rejects malformed shapes", () => {
  const S = ai.S;
  const schema = S.obj({ a: S.str, b: S.list(S.int), c: S.nullable(S.obj({ d: S.enum("x", "y") })) });
  assert.deepEqual(ai.validate(schema, { a: "1", b: [1, 2], c: null }), []);
  assert.ok(ai.validate(schema, { a: "1", b: [1, "2"], c: null }).length);
  assert.ok(ai.validate(schema, { a: "1", b: [], c: { d: "z" } }).length);
  assert.ok(ai.validate(schema, { b: [] }).length);
});

test("a student who fires help requests too fast is slowed down", async () => {
  const rivera = await as("prof");
  const c = new Client();
  await c.post("/api/auth/signup", { name: "Fast", email: "fast@example.edu", password: "longenough1", role: "student" });
  c.csrf = (await c.get("/api/me")).data.csrf;
  const { sid, section } = await liveSession(rivera, "CSC 311", 1);
  await c.post("/api/student/join", { code: section.join_code });
  const ev = (await c.post(`/api/student/sessions/${sid}/lost`)).data.event;
  process.env.LOST_HELP_BURST = "3";
  const codes = [];
  for (let i = 1; i <= 5; i++) codes.push((await c.post(`/api/student/events/${ev.id}/help`, { kind: "catchup", attempt: i })).status);
  process.env.LOST_HELP_BURST = "1000";
  assert.ok(codes.includes(429), codes.join(","));
  await rivera.post(`/api/prof/sessions/${sid}/end`);
});
