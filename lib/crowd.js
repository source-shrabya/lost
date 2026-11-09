// Live "confusion clusters" for the professor, and simulated students for demos.
//
// A cluster is the set of taps that point at the same part of the lecture (anchored lines no more than
// one line apart) in the last 10 minutes of class. The professor sees a cluster only once SMALL_GROUP
// distinct students are in it, so a card never points at one or two people. For each cluster the AI
// writes a short topic, what the students seem to be asking, and one concrete way to re-explain it,
// labelled as an AI reading of the taps and questions.
//
// Simulated students exist only when LOST_DEMO_BOTS=1. They are real rows (users.demo = 1, emails at
// sim.lost) so every screen shows them the way it would show real students, and every place that
// shows a cluster says how many of its students are simulated.
import fs from "node:fs";
import path from "node:path";
import { one, all, run, now, newId } from "./db.js";
import { askJson, aiAvailable, S } from "./ai.js";
import { retrieve } from "./materials.js";
import * as live from "./live.js";
import { SMALL_GROUP } from "./summary.js";

export const BOTS_ON = process.env.LOST_DEMO_BOTS === "1";
const WINDOW_S = 600;
const fmt = (t) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

const CLUSTER_SCHEMA = S.obj({ topic: S.str, gist: S.str, flow: S.list(S.str), say: S.str });
const ai = new Map(); // `${sessionId}:${firstLine}` -> { key, running, topic, gist, flow, say, error }

function groups(sessionId, clock) {
  const evs = all(`SELECT e.id, e.t, e.student_id, e.question, COALESCE(e.anchor_line, e.line_idx) line, u.demo
    FROM confusion_events e JOIN users u ON u.id = e.student_id
    WHERE e.session_id = ? AND e.t >= ? AND COALESCE(e.anchor_line, e.line_idx) IS NOT NULL ORDER BY line, e.t`, sessionId, clock - WINDOW_S);
  const out = [];
  for (const e of evs) {
    const g = out.at(-1);
    if (g && e.line - g.to <= 1) { g.to = e.line; g.events.push(e); } else out.push({ from: e.line, to: e.line, events: [e] });
  }
  return out;
}

// The clusters the professor sees right now, biggest first.
export function liveClusters(session, clock) {
  const res = [];
  for (const g of groups(session.id, clock)) {
    const students = new Map();
    for (const e of g.events) students.set(e.student_id, e.demo);
    if (students.size < SMALL_GROUP) continue;
    const counts = {};
    for (const e of g.events) counts[e.line] = (counts[e.line] || 0) + 1;
    const top = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    const line = one("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND idx = ?", session.id, top);
    const questions = [...new Set(g.events.map((e) => (e.question || "").trim()).filter(Boolean))].slice(0, 8);
    const key = `${session.id}:${g.from}`, sig = `${students.size}:${questions.length}`;
    const lastTap = Math.max(...g.events.map((e) => e.t));
    let a = ai.get(key);
    // Ask once the taps settle (3 s without a new one), and again if the group grows.
    if (aiAvailable() && (!a || (a.key !== sig && !a.running)) && clock - lastTap >= 3) a = think(session, key, sig, line, questions, g);
    const revisit = one("SELECT created_at FROM prof_notes WHERE session_id = ? AND kind = 'revisit' AND text LIKE ?", session.id, `line ${g.from}:%`);
    res.push({
      id: g.from, lines: [g.from, g.to], line, taps: g.events.length, students: students.size,
      simulated: [...students.values()].filter(Boolean).length,
      questions, since: Math.min(...g.events.map((e) => e.t)), last: lastTap,
      topic: a?.topic || null, gist: a?.gist || null, flow: a?.flow || [], say: a?.say || null,
      thinking: !!a?.running || (aiAvailable() && !a), revisited: !!revisit,
    });
  }
  return res.sort((x, y) => y.students - x.students || y.last - x.last);
}

function think(session, key, sig, line, questions, g) {
  const prev = ai.get(key) || {};
  const entry = { ...prev, key: sig, running: true };
  ai.set(key, entry);
  const course = one("SELECT * FROM courses WHERE id = ?", session.course_id);
  const around = all("SELECT t, text FROM transcript_lines WHERE session_id = ? AND idx BETWEEN ? AND ? ORDER BY idx", session.id, Math.max(0, g.from - 6), g.to + 2);
  const passages = retrieve(course.id, around.map((l) => l.text).join(" "), { limit: 3, audience: "staff" });
  const prompt = `Course: ${course.code} ${course.name}. During class, ${new Set(g.events.map((e) => e.student_id)).size} students tapped "I'm lost" on the same part of the lecture.
<transcript>
${around.map((l) => `[${fmt(l.t)}] ${l.text}`).join("\n")}
</transcript>
<marked_line>${line?.text || ""}</marked_line>
<student_questions>
${questions.map((q) => `- ${q}`).join("\n") || "(none typed)"}
</student_questions>
${passages.map((p) => `<material title="${p.title.replace(/"/g, "'")}">${p.text}</material>`).join("\n")}
Write for the professor, who is mid-lecture and will glance at this for five seconds.
topic: the shared confusion as a short noun phrase, under 8 words, about the concept (not "students are confused").
gist: one sentence, under 22 words, saying what the students seem to be asking, based on the marked line and their questions.
flow: 3-5 short steps (each under 7 words) of one concrete, everyday example the professor could use to re-explain it, in cause-to-effect order.
say: one sentence the professor could open with, under 20 words.
Use only what the lecture, materials and questions support. Reply as JSON.`;
  askJson({ prompt, schema: CLUSTER_SCHEMA, effort: "low", timeoutMs: 25000, maxTokens: 800, label: "prof:cluster", think: false })
    .then((r) => Object.assign(entry, { topic: r.topic.slice(0, 80), gist: r.gist.slice(0, 220), flow: r.flow.slice(0, 5).map((x) => x.slice(0, 60)), say: r.say.slice(0, 200), error: null }))
    .catch((e) => { entry.error = String(e.message || e); entry.key = prev.key || null; })
    .finally(() => { entry.running = false; });
  return entry;
}

// The professor says they're going over a cluster now. Kept as a note on the class, so the report shows it.
export function markRevisited(session, firstLine, clock) {
  const c = liveClusters(session, clock).find((x) => x.id === firstLine);
  if (!c) return null;
  if (!one("SELECT 1 FROM prof_notes WHERE session_id = ? AND kind = 'revisit' AND text LIKE ?", session.id, `line ${firstLine}:%`)) {
    const moments = all("SELECT t FROM confusion_events WHERE session_id = ? ORDER BY t", session.id).map((x) => x.t);
    // moment index the way summary.moments() counts them (taps within 60 s form one moment)
    let idx = -1, end = -Infinity;
    for (const t of moments) { if (t - end > 60) idx++; end = t; if (t >= c.since) break; }
    run("INSERT INTO prof_notes (id, session_id, moment_idx, kind, text, created_at) VALUES (?, ?, ?, 'revisit', ?, ?)",
      newId(9), session.id, Math.max(0, idx), `line ${firstLine}: Went over "${c.topic || c.line?.text || "this part"}" again in class at ${fmt(clock)} (${c.students} students had tapped).`, now());
  }
  return true;
}

// ---------- simulated students (demo only) ----------
const keepers = new Map(); // sessionId -> interval keeping the simulated room present
const FALLBACK_QUESTIONS = ["Can you say that part again?", "How does this connect to what came before?", "Can you give an example?",
  "What does that word mean here?", "Why does that happen?", "How would this show up in real life?"];

function botQuestions(n) {
  // data/demo-bot-questions.txt (one per line, or LOST_BOT_QUESTIONS_FILE) wins, so a rehearsed demo
  // shows the same questions every time.
  const file = process.env.LOST_BOT_QUESTIONS_FILE || path.join(process.env.LOST_DATA || "data", "demo-bot-questions.txt");
  let qs = [];
  try { qs = fs.readFileSync(file, "utf8").split("\n").map((x) => x.trim()).filter(Boolean); } catch {}
  if (!qs.length) qs = FALLBACK_QUESTIONS;
  return Array.from({ length: n }, (_, i) => qs[i % qs.length]);
}

function ensureBots(sectionId, n) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const email = `sim-${String(i).padStart(2, "0")}@sim.lost`;
    let u = one("SELECT id FROM users WHERE email = ?", email);
    if (!u) {
      const id = newId(9);
      run("INSERT INTO users (id, email, name, role, password_hash, demo, onboarded, created_at) VALUES (?, ?, ?, 'student', NULL, 1, 1, ?)", id, email, `Simulated student ${i}`, now());
      u = { id };
    }
    run("INSERT OR IGNORE INTO enrollments (user_id, section_id, source, created_at) VALUES (?, ?, 'demo', ?)", u.id, sectionId, now());
    ids.push(u.id);
  }
  return ids;
}

// Fill the room to `room` connected students (counting the real ones), then have `tappers` of the
// simulated students tap the given line, a few hundred milliseconds apart, each with a question.
export function runBots(session, { room = 20, tappers = 6, line = null } = {}) {
  if (!BOTS_ON) throw new Error("Simulated students are off on this server.");
  if (session.status !== "live") throw new Error("Start the class first.");
  const target = line ?? one("SELECT MAX(idx) m FROM transcript_lines WHERE session_id = ?", session.id).m;
  if (target == null) throw new Error("There's no transcript line to tap yet.");
  const realPresent = live.presentCount(session.id);
  const sims = Math.max(tappers, Math.min(40, room - realPresent));
  const ids = ensureBots(session.section_id, sims);
  const keep = () => { const s = one("SELECT status FROM lecture_sessions WHERE id = ?", session.id); if (s?.status !== "live") { clearInterval(keepers.get(session.id)); keepers.delete(session.id); return; } for (const id of ids) live.markPresent(session.id, id); };
  keep(); clearInterval(keepers.get(session.id)); keepers.set(session.id, setInterval(keep, 5000));
  const qs = botQuestions(tappers);
  ids.slice(0, tappers).forEach((id, i) => setTimeout(() => {
    const s = one("SELECT * FROM lecture_sessions WHERE id = ?", session.id);
    if (s?.status !== "live") return;
    const t = live.sessionClock(s);
    run(`INSERT INTO confusion_events (id, session_id, student_id, t, line_idx, context_from, context_to, anchor, anchor_line, category, question, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'phrase', ?, 'connection', ?, ?)`, newId(9), s.id, id, t, target, Math.max(0, target - 3), target, target, qs[i], now());
  }, 300 + i * 450));
  return { simulated: sims, tapping: tappers, line: target };
}
export const botsRunning = (sessionId) => keepers.has(sessionId);
