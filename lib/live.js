// Live lecture runtime: what has to be fast and in memory (audio relay, words in progress, who's
// connected), with everything that matters written to SQLite as it happens (lines, gaps, events).
//
// The speech engine (engines.js) handles one audio stream at a time. The first live session that
// sends audio owns it; any other live session falls back to Chrome speech recognition on the
// professor's laptop and says so.
import { one, all, run, now, tx } from "./db.js";
import { engine, newStream, feed, endStream, setTerms } from "../engines.js";
import { courseTerms } from "./materials.js";
import { enqueue } from "./jobs.js";

const rt = new Map(); // session id -> runtime
let engineOwner = null;
export const GAP_AFTER_MS = 5000;

export function runtime(sessionId) {
  if (!rt.has(sessionId)) rt.set(sessionId, { interim: "", relay: { id: 0, seq: -1, header: null, pieces: new Map() }, lastAudioAt: 0, openGap: null, editRev: 0, present: new Map(), wantsServer: false });
  return rt.get(sessionId);
}
export const sessionClock = (s) => (s.started_at ? (Date.now() - Date.parse(s.started_at)) / 1000 : 0);

export function addLine(sessionId, text, { t = null, origin = "speech", unsure = null } = {}) {
  const s = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
  if (!s || s.status === "ended" || !s.started_at) return null;
  if (s.status === "ending" && origin !== "speech") return null; // after End only the engine's last words get in
  text = String(text || "").trim().slice(0, 1000);
  if (!text) return null;
  const at = Math.max(0, t ?? sessionClock(s));
  return tx(() => {
    const idx = (one("SELECT MAX(idx) m FROM transcript_lines WHERE session_id = ?", sessionId).m ?? -1) + 1;
    run("INSERT INTO transcript_lines (session_id, idx, t, text, unsure, origin) VALUES (?, ?, ?, ?, ?, ?)", sessionId, idx, at, text, unsure?.length ? JSON.stringify(unsure.slice(0, 20)) : null, origin);
    if (s.status === "live") inputArrived(sessionId); // a typed line also means the transcript isn't empty here
    return idx;
  });
}

export function editLine(sessionId, idx, text) {
  text = String(text || "").trim().slice(0, 1000);
  const l = one("SELECT * FROM transcript_lines WHERE session_id = ? AND idx = ?", sessionId, idx);
  if (!l || !text) return false;
  run("UPDATE transcript_lines SET original = COALESCE(original, text), text = ?, edited_at = ?, unsure = NULL WHERE session_id = ? AND idx = ?", text, now(), sessionId, idx);
  runtime(sessionId).editRev++;
  return true;
}

// ---------- engine glue ----------
export function onEnginePartial(text) { if (engineOwner) runtime(engineOwner).interim = String(text).slice(0, 500); }
export function onEngineLine({ text, wallStart, unsure }) {
  if (!engineOwner) return;
  const s = one("SELECT * FROM lecture_sessions WHERE id = ?", engineOwner);
  if (!s?.started_at) return;
  addLine(engineOwner, text, { t: (wallStart - Date.parse(s.started_at)) / 1000, origin: "speech", unsure });
  runtime(engineOwner).interim = "";
}
export const transcriberFor = (sessionId) => (engine.ready && (engineOwner === null || engineOwner === sessionId) ? "server" : "browser");

// Professor uploads one audio piece. first = the WebM header piece of a new recording.
export function audioPiece(sessionId, buf, first) {
  const r = runtime(sessionId), relay = r.relay;
  if (first) {
    relay.id++; relay.header = buf; relay.pieces.clear(); relay.seq = 0;
    if (engine.ready && (engineOwner === null || engineOwner === sessionId)) {
      engineOwner = sessionId;
      const s = one("SELECT course_id FROM lecture_sessions WHERE id = ?", sessionId);
      setTerms(courseTerms(s.course_id));
      newStream(buf);
    }
  } else if (relay.header) {
    relay.seq++; relay.pieces.set(relay.seq, buf); relay.pieces.delete(relay.seq - 30);
    if (engineOwner === sessionId) feed(buf);
  }
  inputArrived(sessionId);
  return relay.seq;
}
export function audioStopped(sessionId) {
  const r = runtime(sessionId);
  r.relay.header = null; r.relay.pieces.clear(); r.relay.seq = -1;
  if (engineOwner === sessionId) { endStream(); }
}

// ---------- transcript gaps ----------
// A gap is a stretch of a live class where nothing reached Lost: no audio and no transcript line.
function inputArrived(sessionId) {
  const r = runtime(sessionId);
  r.lastAudioAt = Date.now();
  if (r.openGap) {
    const s = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
    run("UPDATE transcript_gaps SET to_t = ? WHERE id = ?", sessionClock(s), r.openGap);
    r.openGap = null;
  }
}
export function checkGaps() {
  for (const s of all("SELECT * FROM lecture_sessions WHERE status = 'live'")) {
    const r = runtime(s.id);
    const since = r.lastAudioAt || Date.parse(s.started_at);
    if (!r.openGap && Date.now() - since > GAP_AFTER_MS) {
      const from = Math.max(0, (since - Date.parse(s.started_at)) / 1000);
      r.openGap = Number(run("INSERT INTO transcript_gaps (session_id, from_t, reason) VALUES (?, ?, ?)", s.id, from, r.lastAudioAt ? "No audio or transcript reached Lost" : "Mic not started yet").lastInsertRowid);
    }
  }
}

// ---------- start / end ----------
export function startSession(sessionId) {
  const changed = run("UPDATE lecture_sessions SET status = 'live', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'ready'", now(), sessionId).changes;
  runtime(sessionId);
  return changed > 0;
}

// End: stop taking new audio, let the engine finish its last words, then close the session and
// queue the summary job. Help requests already running keep going; their events stay attached.
export async function endSession(sessionId, settleMs = Number(process.env.LOST_END_SETTLE_MS ?? 2500)) {
  const changed = run("UPDATE lecture_sessions SET status = 'ending' WHERE id = ? AND status = 'live'", sessionId).changes;
  if (!changed) return false;
  const r = runtime(sessionId);
  r.relay.header = null; r.relay.pieces.clear(); r.relay.seq = -1;
  if (engineOwner === sessionId) endStream();
  await new Promise((ok) => setTimeout(ok, settleMs));
  finishEnding(sessionId);
  return true;
}
export function finishEnding(sessionId) {
  const s = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
  if (!s || s.status !== "ending") return;
  const end = sessionClock(s);
  tx(() => {
    run("UPDATE transcript_gaps SET to_t = ? WHERE session_id = ? AND to_t IS NULL", end, sessionId);
    run("UPDATE lecture_sessions SET status = 'ended', ended_at = ? WHERE id = ?", now(), sessionId);
    run("INSERT INTO session_summaries (session_id, status, updated_at) VALUES (?, 'pending', ?) ON CONFLICT (session_id) DO NOTHING", sessionId, now());
  });
  enqueue("summary", sessionId);
  if (engineOwner === sessionId) engineOwner = null;
  const r = rt.get(sessionId); if (r) { r.interim = ""; r.present.clear(); }
}

// After a restart: sessions caught mid-"ending" are finished now; live sessions keep going
// (the professor's page reconnects), with a gap for the downtime.
export function recoverSessions() {
  for (const s of all("SELECT id FROM lecture_sessions WHERE status = 'ending'")) finishEnding(s.id);
}

// Who is in the room: students whose live page checked in within 20 s.
export function markPresent(sessionId, userId) { runtime(sessionId).present.set(userId, Date.now()); }
export function presentCount(sessionId) {
  const r = runtime(sessionId), t = Date.now();
  for (const [id, at] of r.present) if (t - at > 20000) r.present.delete(id);
  return r.present.size;
}
