// End of class: the durable summary job, the student's personal review, and professor analytics.
import { one, all, run, now, newId, parse, tx } from "./db.js";
import { askJson, aiAvailable, S, AiError } from "./ai.js";
import { retrieve } from "./materials.js";
import { registerJob } from "./jobs.js";
import { VISUAL_SCHEMA, VISUAL_GUIDE, MAP_SCHEMA, cleanVisual, cleanMap } from "./visuals.js";
import { flagSources, fixClaims, stripIds } from "./help.js";

const fmt = (t) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const CLUSTER_GAP = 60;      // taps closer than this (seconds) form one moment
export const SMALL_GROUP = 3;       // under this many students, breakdowns are hidden

// Group a session's confusion events into moments by time.
export function moments(sessionId) {
  const evs = all("SELECT * FROM confusion_events WHERE session_id = ? ORDER BY t", sessionId);
  const groups = [];
  for (const e of evs) {
    const g = groups.at(-1);
    if (g && e.t - g.end <= CLUSTER_GAP) { g.end = e.t; g.events.push(e); }
    else groups.push({ start: e.t, end: e.t, events: [e] });
  }
  return groups.map((g, i) => ({ index: i, ...g }));
}

const ref = S.str;
const CLAIM = S.obj({ text: S.str, refs: S.list(ref) });
const SUMMARY_SCHEMA = S.obj({
  overview: CLAIM,
  concept_map: MAP_SCHEMA,
  topics: S.list(S.obj({
    title: S.str, key_idea: CLAIM, explanation: CLAIM, visual: VISUAL_SCHEMA,
    example: S.nullable(S.obj({ text: S.str, why: S.str, origin: S.enum("lecture", "materials", "ai"), refs: S.list(ref) })),
    qualifications: S.list(CLAIM),
  })),
  terms: S.list(S.obj({ term: S.str, definition: S.str, refs: S.list(ref) })),
  deadlines: S.list(S.obj({ text: S.str, refs: S.list(ref) })),
  uncertain: S.list(CLAIM),
  moments: S.list(S.obj({ topic: S.str, evidence: S.list(ref), review: S.nullable(S.obj({ question: S.str, choices: S.list(S.str), correct_index: S.int, why: S.str })) })),
});

function resolve(ids, lineMap, pasMap) {
  const out = [], seen = new Set();
  for (const id of ids || []) {
    const k = String(id).trim().toUpperCase();
    if (seen.has(k)) continue; seen.add(k);
    if (lineMap.has(k)) { const l = lineMap.get(k); out.push({ type: "line", id: k, idx: l.idx, t: l.t, text: l.text }); }
    else if (pasMap.has(k)) { const p = pasMap.get(k); out.push({ type: "passage", id: k, title: p.title, location: p.location, url: p.url, source: p.source }); }
  }
  return out;
}

export async function buildSummary(sessionId) {
  const session = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
  const course = one("SELECT * FROM courses WHERE id = ?", session.course_id);
  const lines = all("SELECT idx, t, text, origin FROM transcript_lines WHERE session_id = ? ORDER BY idx", sessionId);
  const gaps = all("SELECT from_t, to_t, reason FROM transcript_gaps WHERE session_id = ? ORDER BY from_t", sessionId);
  const ms = moments(sessionId);
  if (!lines.length) return { status: "transcript_only", payload: { empty: true, gaps } };
  if (!aiAvailable()) return { status: "transcript_only", payload: { reason: "off", gaps } };

  // Materials: a handful of student-visible passages matching the lecture text.
  const text = lines.map((l) => l.text).join(" ");
  const passages = retrieve(course.id, text.slice(-4000), { limit: 6, audience: "student", materialIds: parse(session.material_ids, []) });
  const lineMap = new Map(lines.map((l) => [`L${l.idx}`, l])), pasMap = new Map(passages.map((p) => [`P${p.id}`, p]));
  const momentBlock = ms.map((m) => {
    const anchors = [...new Set(m.events.map((e) => e.anchor_line ?? e.line_idx).filter((x) => x != null))];
    const cats = countBy(m.events.map((e) => e.category).filter(Boolean));
    return `Moment ${m.index}: ${fmt(m.start)}-${fmt(m.end)}, ${m.events.length} taps. Lines near the taps: ${anchors.map((a) => `L${a}`).join(", ") || "none"}. Kinds chosen: ${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`;
  }).join("\n");

  const prompt = `Course: ${course.code} ${course.name}.${session.title ? ` Lecture: ${session.title}.` : ""}
Full lecture transcript (speech-to-text; [m:ss] is time into class):
<transcript>
${lines.map((l) => `L${l.idx} [${fmt(l.t)}]${l.origin === "sample" ? " (sample text)" : ""} ${l.text}`).join("\n").slice(-120000)}
</transcript>
${gaps.length ? `Audio gaps (nothing recorded): ${gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "end" : fmt(g.to_t)}`).join(", ")}` : ""}
${passages.length ? `Course materials students can see:\n${passages.map((p) => `<material id="P${p.id}" title="${p.title.replace(/"/g, "'")}" location="${p.location}">\n${p.text}\n</material>`).join("\n")}` : "No course materials matched."}

Write a class summary every student in the course will see. Students should get the gist in 30 seconds and open topics for detail. Follow the order of the lecture. Write like a friend who took great notes: second person, contractions, short punchy sentences, everyday pictures; never like a textbook. Students see only titles and key ideas until they open a topic, so keep everything else short. Say each idea once: a definition lives in one place only.
overview: 2 short sentences (under 40 words) on what today's class covered, written to the student ("Today you learned...").
concept_map: 3-6 short nodes (under 4 words each, matching the topic titles where possible) and labelled links ("leads to", "is part of", "decides") showing how today's ideas connect; null if fewer than 3 ideas.
topics: 2-6 topics. title: under 6 words. key_idea: one sentence. explanation: 1-2 sentences that add to the key idea, "" if nothing to add. visual: only where a picture really helps (at most 3 topics), otherwise null. example: one worked or concrete example with "why" it shows the idea (prefer the lecture's or materials' own, with refs), or null. qualifications: limits, exceptions and conditions that must not be lost; an exception belongs here or as a branch in a decision visual, never as a later step.
${VISUAL_GUIDE}
terms: important terms with definitions as the professor or materials gave them, each defined once.
deadlines: only assignments or dates that appear in the transcript or the materials, each with its ref; otherwise an empty list.
uncertain: places where the transcript is garbled, audio is missing, or the transcript and materials disagree, and what that leaves unclear; [] if none. When the transcript is garbled, take rule wording from the materials.
Cite L and P ids in every refs list. Never add facts, positions or numbers the lecture or materials don't support.
Confusion moments (for topic labels; this part is not shown to students as-is):
${momentBlock || "none"}
moments: one entry per moment above, same order and count: topic (2-5 words, what students were probably stuck on), evidence (L ids that support it), and review: a short multiple-choice question (3 choices) on that topic using a new example, or null if the transcript doesn't support one.
Do not mention any individual student.`;
  const raw = await askJson({ prompt, schema: SUMMARY_SCHEMA, effort: "medium", timeoutMs: 120000, maxTokens: 12000, label: "summary", strict: false, fix: (v) => { fixClaims(v, ["overview"], ["uncertain", "deadlines", "terms"]); for (const t of v.topics || []) { fixClaims(t, ["key_idea", "explanation"], ["qualifications"]); if (!("visual" in t)) t.visual = null; if (!("example" in t)) t.example = null; } if (!("concept_map" in v)) v.concept_map = null; return v; } });

  const r = (ids) => resolve(ids, lineMap, pasMap);
  const src = (ids) => flagSources(r(ids), sessionId);
  const claim = (c) => (c && c.text?.trim() ? { text: stripIds(c.text), sources: src(c.refs) } : null);
  const shared = {
    v: 2,
    overview: claim(raw.overview),
    map: cleanMap(raw.concept_map),
    topics: raw.topics.slice(0, 8).map((x) => {
      const vis = cleanVisual(x.visual);
      let example = x.example?.text?.trim() ? { text: x.example.text.trim(), why: (x.example.why || "").trim(), origin: x.example.origin, sources: src(x.example.refs) } : null;
      if (example && example.origin !== "ai" && !example.sources.length) example.origin = "ai";
      return { title: x.title, key_idea: claim(x.key_idea), explanation: claim(x.explanation), visual: vis.ok ? vis.visual : null, visualIssue: vis.ok || vis.reason === "none" ? null : vis.reason, example, qualifications: x.qualifications.map(claim).filter(Boolean).slice(0, 4) };
    }).filter((t) => t.key_idea),
    concepts: raw.terms.slice(0, 12).map((x) => ({ term: x.term, definition: x.definition, sources: src(x.refs) })),
    // a deadline without a real source is dropped
    deadlines: raw.deadlines.map((d) => ({ text: d.text, sources: src(d.refs) })).filter((d) => d.sources.length),
    uncertain: raw.uncertain.map(claim).filter(Boolean).slice(0, 4),
  };
  const momentOut = ms.map((m, i) => {
    const a = raw.moments[i];
    const review = a?.review && a.review.choices.length >= 2 && a.review.correct_index >= 0 && a.review.correct_index < a.review.choices.length ? a.review : null;
    return { index: i, start: m.start, end: m.end, topic: a?.topic || "", inferred: true, evidence: r(a?.evidence || []).filter((x) => x.type === "line"), review };
  });
  return { status: "ready", payload: { shared, moments: momentOut, gaps, materials: passages.map((p) => ({ title: p.title, location: p.location, url: p.url, source: p.source })) } };
}

const countBy = (arr) => arr.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {});

// Job handler. Safe to run twice: upsert the summary, notifications are unique per user+session.
export async function summaryJob(sessionId, { final } = {}) {
  const session = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
  if (!session) return;
  if (session.status !== "ended") throw new Error("Session hasn't finished ending yet.");
  run("INSERT INTO session_summaries (session_id, status, updated_at) VALUES (?, 'pending', ?) ON CONFLICT (session_id) DO UPDATE SET status = 'pending', error = NULL, updated_at = excluded.updated_at WHERE session_summaries.status IN ('pending', 'failed')", sessionId, now());
  let out;
  try { out = await buildSummary(sessionId); }
  catch (e) {
    run("UPDATE session_summaries SET status = ?, error = ?, updated_at = ? WHERE session_id = ?", final ? "failed" : "pending", e instanceof AiError ? e.message : `Summary failed: ${e.message}`, now(), sessionId);
    throw e;
  }
  publish(sessionId, out);
}

export function publish(sessionId, out) {
  const session = one("SELECT s.*, c.code, c.name, c.owner_id FROM lecture_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = ?", sessionId);
  tx(() => {
    run(`INSERT INTO session_summaries (session_id, status, payload, published, published_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET status = excluded.status, payload = excluded.payload, error = NULL, published = 1,
           published_at = COALESCE(session_summaries.published_at, excluded.published_at), updated_at = excluded.updated_at`,
      sessionId, out.status, JSON.stringify(out.payload), now(), now());
    const title = `${session.code}: ${out.status === "ready" ? "class summary is ready" : "class transcript is available"}`;
    const students = all("SELECT user_id FROM enrollments WHERE section_id = ?", session.section_id);
    const ins = (uid, link) => run("INSERT OR IGNORE INTO notifications (id, user_id, kind, ref_id, title, link, created_at) VALUES (?, ?, 'summary', ?, ?, ?, ?)", newId(9), uid, sessionId, title, link, now());
    for (const s of students) ins(s.user_id, `/student#/session/${sessionId}`);
    ins(session.owner_id, `/prof#/session/${sessionId}`);
  });
}

registerJob("summary", summaryJob);

// ---------- what a student sees after class ----------
export function studentSessionView(sessionId, studentId) {
  const session = one("SELECT s.*, c.code, c.name AS course_name, c.office_hours_url, c.tutoring_url FROM lecture_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = ?", sessionId);
  const sum = one("SELECT * FROM session_summaries WHERE session_id = ?", sessionId);
  const job = one("SELECT status, attempts, last_error FROM jobs WHERE type = 'summary' AND ref_id = ?", sessionId);
  const published = sum?.published ? parse(sum.payload, {}) : null;
  const ms = published?.moments || [];
  const events = all("SELECT * FROM confusion_events WHERE session_id = ? AND student_id = ? ORDER BY t", sessionId, studentId).map((e) => {
    const helps = all("SELECT kind, status, payload FROM help_responses WHERE event_id = ? ORDER BY created_at", e.id).map((h) => ({ kind: h.kind, status: h.status, payload: parse(h.payload) }));
    const checks = all("SELECT id, kind, question, choices, chosen_idx, correct, skipped, why, correct_idx FROM checks WHERE event_id = ? ORDER BY created_at", e.id)
      .map((c) => ({ id: c.id, kind: c.kind, question: c.question, choices: parse(c.choices, []), chosen: c.chosen_idx, correct: c.correct == null ? null : !!c.correct, skipped: !!c.skipped,
        ...(c.chosen_idx != null ? { why: c.why, correctIndex: c.correct_idx } : {}) }));
    const anchor = e.anchor_line ?? e.line_idx;
    const line = anchor != null ? one("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND idx = ?", sessionId, anchor) : null;
    const m = ms.find((x) => e.t >= x.start - 0.01 && e.t <= x.end + 0.01);
    const card = helps.filter((h) => h.kind !== "catchup" && h.payload).at(-1)?.payload || null;
    const ohq = one("SELECT text FROM office_hours_questions WHERE event_id = ?", e.id);
    return {
      id: e.id, t: e.t, category: e.category, question: e.question, status: e.self_status, topic: e.topic || m?.topic || "",
      line, card, checks, officeHours: ohq?.text || null,
      review: e.self_status !== "resolved" && m?.review ? reviewFor(e.id, m.review) : null,
    };
  });
  return {
    session: { id: session.id, title: session.title, status: session.status, code: session.code, course: session.course_name, course_id: session.course_id, started_at: session.started_at, ended_at: session.ended_at },
    summary: sum?.published ? { status: sum.status, ...published } : null,
    summaryState: sum ? sum.status : session.status === "ended" ? (job?.status === "failed" ? "failed" : "pending") : "not_ended",
    transcript: sum?.published && sum.status === "transcript_only" ? all("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? ORDER BY idx", sessionId) : null,
    events,
    support: { officeHours: session.office_hours_url || "", tutoring: session.tutoring_url || "" },
  };
}

// The review question for an unresolved event, stored once per event so the answer can be graded on the server.
function reviewFor(eventId, review) {
  let c = one("SELECT * FROM checks WHERE event_id = ? AND kind = 'review'", eventId);
  if (!c) {
    const id = newId(9);
    run("INSERT INTO checks (id, event_id, kind, question, choices, correct_idx, why, created_at) VALUES (?, ?, 'review', ?, ?, ?, ?, ?)", id, eventId, review.question, JSON.stringify(review.choices), review.correct_index, review.why, now());
    c = one("SELECT * FROM checks WHERE id = ?", id);
  }
  return { id: c.id, question: c.question, choices: parse(c.choices, []), chosen: c.chosen_idx, correct: c.correct == null ? null : !!c.correct, ...(c.chosen_idx != null ? { why: c.why, correctIndex: c.correct_idx } : {}) };
}

// ---------- student statistics (definitions shown next to them in the UI) ----------
export function studentStats(studentId, courseId) {
  const evs = all("SELECT e.* FROM confusion_events e JOIN lecture_sessions s ON s.id = e.session_id WHERE e.student_id = ? AND s.course_id = ?", studentId, courseId);
  const passed = one(`SELECT COUNT(*) n FROM checks k JOIN confusion_events e ON e.id = k.event_id JOIN lecture_sessions s ON s.id = e.session_id
                      WHERE e.student_id = ? AND s.course_id = ? AND k.kind IN ('comprehension', 'review') AND k.correct = 1`, studentId, courseId).n;
  const answered = one(`SELECT COUNT(*) n FROM checks k JOIN confusion_events e ON e.id = k.event_id JOIN lecture_sessions s ON s.id = e.session_id
                      WHERE e.student_id = ? AND s.course_id = ? AND k.kind IN ('comprehension', 'review') AND k.chosen_idx IS NOT NULL`, studentId, courseId).n;
  const resolved = evs.filter((e) => e.self_status === "resolved").length;
  const topics = countBy(evs.filter((e) => e.self_status !== "resolved").map((e) => e.topic).filter(Boolean));
  return { total: evs.length, resolved, unresolved: evs.length - resolved, checksPassed: passed, checksAnswered: answered,
    unresolvedTopics: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic, n]) => ({ topic, n })) };
}

// ---------- professor analytics ----------
export function profAnalytics(sessionId) {
  const session = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
  const evs = all("SELECT * FROM confusion_events WHERE session_id = ? ORDER BY t", sessionId);
  const dur = session.started_at ? ((session.ended_at ? Date.parse(session.ended_at) : Date.now()) - Date.parse(session.started_at)) / 1000 : 0;
  const bin = dur < 600 ? 30 : 60, nb = Math.max(1, Math.ceil(dur / bin)); // 30 s bars for short classes
  const bins = Array.from({ length: nb }, (_, i) => ({ from: i * bin, taps: 0, students: new Set() }));
  for (const e of evs) { const b = bins[Math.min(nb - 1, Math.floor(e.t / bin))]; b.taps++; b.students.add(e.student_id); }
  const sum = one("SELECT * FROM session_summaries WHERE session_id = ?", sessionId);
  const sm = parse(sum?.payload, {})?.moments || [];
  const unique = new Set(evs.map((e) => e.student_id)).size;
  const checkPass = one("SELECT COUNT(*) n FROM checks k JOIN confusion_events e ON e.id = k.event_id WHERE e.session_id = ? AND k.kind = 'comprehension' AND k.correct = 1", sessionId).n;
  const ms = moments(sessionId).map((m) => {
    const students = new Set(m.events.map((e) => e.student_id)).size;
    const small = students < SMALL_GROUP;
    const anchors = countBy(m.events.map((e) => e.anchor_line ?? e.line_idx).filter((x) => x != null));
    const lines = Object.keys(anchors).map(Number).sort((a, b) => a - b).map((idx) => ({ ...one("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND idx = ?", sessionId, idx), taps: anchors[idx] }));
    const ai = sm.find((x) => Math.abs(x.start - m.start) < 0.01);
    const resolved = m.events.filter((e) => e.self_status === "resolved").length;
    return {
      index: m.index, start: m.start, end: m.end, taps: m.events.length,
      students: small ? null : students, small,
      // breakdowns could point at one person in a small group, so they're hidden there
      categories: small ? null : countBy(m.events.map((e) => e.category || "not chosen")),
      resolved: small ? null : resolved, unresolved: small ? null : m.events.length - resolved,
      lines, topic: ai?.topic || null, topicEvidence: ai?.evidence || [],
    };
  });
  return {
    duration: dur, binSeconds: bin,
    bins: bins.map((b) => ({ from: b.from, taps: b.taps, students: b.students.size })),
    totals: { taps: evs.length, students: unique, resolved: evs.filter((e) => e.self_status === "resolved").length,
      unresolved: evs.filter((e) => e.self_status !== "resolved").length, checksPassed: checkPass,
      categories: unique >= SMALL_GROUP ? countBy(evs.map((e) => e.category || "not chosen")) : null },
    moments: ms,
    notes: all("SELECT id, moment_idx, kind, text, created_at FROM prof_notes WHERE session_id = ? ORDER BY created_at", sessionId),
  };
}

// Optional professor actions. Only run when the professor clicks; drafts stay in Lost.
const DRAFT_SCHEMA = S.obj({ text: S.str });
export async function draftForMoment(sessionId, momentIdx, kind) {
  const session = one("SELECT * FROM lecture_sessions WHERE id = ?", sessionId);
  const course = one("SELECT * FROM courses WHERE id = ?", session.course_id);
  const m = moments(sessionId)[momentIdx];
  if (!m) throw new AiError("invalid", "No such moment.");
  const lines = all("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND t BETWEEN ? AND ? ORDER BY idx", sessionId, m.start - 120, m.end + 30);
  const passages = retrieve(course.id, lines.map((l) => l.text).join(" "), { limit: 3, audience: "staff" });
  const ask = kind === "clarification"
    ? "Draft a short clarification (4-6 sentences) the professor could post or say next class about this part. Plain and friendly, no apology, no mention of individual students. The professor will edit it; Lost never sends it."
    : "List 2-4 optional, concrete ways the professor could support students on this part (for example an extra worked example, a quick check question, a pointer to a material). Neutral tone, no judgement of the teaching, under 120 words.";
  const prompt = `Course: ${course.code} ${course.name}. Students tapped "I'm lost" ${m.events.length} times around ${fmt(m.start)}-${fmt(m.end)}.
<transcript>
${lines.map((l) => `[${fmt(l.t)}] ${l.text}`).join("\n")}
</transcript>
${passages.map((p) => `<material title="${p.title.replace(/"/g, "'")}" location="${p.location}">${p.text}</material>`).join("\n")}
${ask} Reply as JSON {"text": "..."}.`;
  const raw = await askJson({ prompt, schema: DRAFT_SCHEMA, effort: "low", timeoutMs: 40000, label: `prof:${kind}` });
  const id = newId(9);
  run("INSERT INTO prof_notes (id, session_id, moment_idx, kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, sessionId, momentIdx, kind, raw.text, now());
  return { id, kind, text: raw.text };
}
