// The live help workflow: confusion event -> explanation card -> diagnostic / check -> catch-up.
//
// Every AI answer is built from evidence Lost hands the model with ids (L12 = transcript line 12,
// P34 = course passage 34). After the reply comes back, resolveRefs() drops any id that wasn't in
// the evidence, so a card can only cite lines and passages that exist and the student may see.
import { one, all, run, now, newId, parse } from "./db.js";
import { askJson, aiAvailable, S, AiError } from "./ai.js";
import { retrieve } from "./materials.js";

const fmt = (t) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- schemas ----------
const ref = S.str;
const DIAGNOSTIC = S.obj({ question: S.str, choices: S.list(S.str), correct_index: S.int, prerequisite: S.str });
export const CARD_SCHEMA = S.obj({
  enough_evidence: S.bool,
  clarify_question: S.str,
  topic: S.str,
  explanation: S.obj({
    text: S.str,
    terms: S.list(S.obj({ term: S.str, definition: S.str })),
    example: S.obj({ text: S.str, origin: S.enum("lecture", "materials", "ai"), ref }),
  }),
  context: S.obj({ text: S.str, refs: S.list(ref) }),
  flow: S.obj({
    previous: S.nullable(S.obj({ label: S.str, ref })),
    current: S.obj({ label: S.str, ref }),
    next: S.nullable(S.obj({ label: S.str, ref })),
  }),
  diagnostic: S.nullable(DIAGNOSTIC),
});
export const CHECK_SCHEMA = S.obj({ question: S.str, choices: S.list(S.str), correct_index: S.int, why: S.str });
export const CATCHUP_SCHEMA = S.obj({ happened: S.str, current_topic: S.str, connection: S.str, refs: S.list(ref) });

// ---------- evidence ----------
export function sessionLines(sessionId, from = 0, to = 1e9) {
  return all("SELECT idx, t, text, origin FROM transcript_lines WHERE session_id = ? AND idx BETWEEN ? AND ? ORDER BY idx", sessionId, from, to);
}
export function gapsBetween(sessionId, fromT, toT) {
  return all("SELECT from_t, to_t, reason FROM transcript_gaps WHERE session_id = ? AND from_t < ? AND COALESCE(to_t, 1e12) > ? ORDER BY from_t", sessionId, toT, fromT);
}

// Evidence for one event: the lines around the anchor (only what has already been said) and a few
// course passages students are allowed to see.
export function evidenceFor(ev) {
  const session = one("SELECT * FROM lecture_sessions WHERE id = ?", ev.session_id);
  const anchor = ev.anchor_line ?? ev.line_idx;
  const anchorLine = anchor != null ? one("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND idx = ?", ev.session_id, anchor) : null;
  const aroundT = anchorLine ? anchorLine.t : ev.t;
  // 2.5 minutes before the anchor, and up to 4 lines after it if they were already said
  const before = all("SELECT idx, t, text, origin FROM transcript_lines WHERE session_id = ? AND t >= ? AND t <= ? ORDER BY idx", ev.session_id, aroundT - 150, aroundT + 0.01);
  const after = anchorLine ? all("SELECT idx, t, text, origin FROM transcript_lines WHERE session_id = ? AND idx > ? ORDER BY idx LIMIT 4", ev.session_id, anchorLine.idx) : [];
  const lines = [...new Map([...before, ...after].map((l) => [l.idx, l])).values()].sort((a, b) => a.idx - b.idx).slice(-40);
  const query = [anchorLine?.text, ev.interim_text, ev.question, lines.slice(-6).map((l) => l.text).join(" ")].filter(Boolean).join(" ");
  const passages = retrieve(session.course_id, query, { limit: 3, audience: "student", materialIds: parse(session.material_ids, []) });
  const gaps = gapsBetween(ev.session_id, aroundT - 150, aroundT + 60);
  return { session, anchorLine, lines, passages, gaps };
}

function evidenceBlock({ session, anchorLine, lines, passages, gaps }, ev) {
  const course = one("SELECT name, code FROM courses WHERE id = ?", session.course_id);
  const mark = (l) => (anchorLine && l.idx === anchorLine.idx ? " <<< student is lost here" : "");
  return `Course: ${course.code} ${course.name}.${session.title ? ` Lecture: ${session.title}.` : ""}
Transcript (speech-to-text, may contain recognition errors; [m:ss] is time into class):
<transcript>
${lines.map((l) => `L${l.idx} [${fmt(l.t)}]${l.origin === "sample" ? " (sample text)" : ""} ${l.text}${mark(l)}`).join("\n") || "(nothing was transcribed around this moment)"}
</transcript>
${ev.interim_text && !lines.some((l) => l.text.includes(ev.interim_text.slice(0, 40))) ? `Words the professor was in the middle of saying when the student tapped (not yet a transcript line, no id):\n<being_said>${ev.interim_text}</being_said>\n` : ""}${gaps.length ? `Transcript gaps (audio missing, nothing recorded): ${gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)}`).join(", ")}\n` : ""}${passages.length ? `Course materials students can see:\n${passages.map((p) => `<material id="P${p.id}" title="${p.title.replace(/"/g, "'")}" location="${p.location}">\n${p.text}\n</material>`).join("\n")}` : "No matching course material was found."}
${ev.anchor === "earlier" ? "The student says the confusion started earlier in class, not at the latest line." : ev.anchor === "phrase" && anchorLine ? `The student picked line L${anchorLine.idx}.` : anchorLine ? `The student tapped while line L${anchorLine.idx} was being said (matched by time).` : "The student tapped without picking a line; the confusion is probably in the last few lines."}
${ev.category ? `What kind of confusion the student chose: ${{ term: "a term or word they don't know", reasoning: "a step in the reasoning", connection: "how this connects to what came before", missed: "they missed what was said" }[ev.category]}.` : ""}
${ev.question ? `The student's own question:\n<student_question>${ev.question}</student_question>` : ""}`;
}

// Keep only ids that were in the evidence; turn them into display objects.
export function resolveRefs(ids, ev, evidence) {
  const lines = new Map(evidence.lines.map((l) => [`L${l.idx}`, l]));
  const pas = new Map(evidence.passages.map((p) => [`P${p.id}`, p]));
  const out = [], seen = new Set();
  for (const id of ids || []) {
    const k = String(id).trim().toUpperCase();
    if (seen.has(k)) continue; seen.add(k);
    if (lines.has(k)) { const l = lines.get(k); out.push({ type: "line", id: k, idx: l.idx, t: l.t, text: l.text }); }
    else if (pas.has(k)) { const p = pas.get(k); out.push({ type: "passage", id: k, title: p.title, location: p.location, url: p.url, source: p.source, text: p.text.slice(0, 400) }); }
  }
  return out;
}

// Check a card against the evidence. Anything unsupported is removed, never shown.
export function cleanCard(raw, ev, evidence) {
  const anchorIdx = evidence.anchorLine?.idx ?? (evidence.lines.length ? evidence.lines.filter((l) => l.t <= ev.t + 0.5).at(-1)?.idx : null);
  const lineRef = (r) => { const x = resolveRefs([r], ev, evidence)[0]; return x?.type === "line" ? x : null; };
  const ex = raw.explanation.example;
  let example = { text: ex.text, origin: ex.origin, source: null };
  if (ex.origin === "lecture") { const l = lineRef(ex.ref); example = l ? { ...example, source: l } : { ...example, origin: "ai" }; }
  else if (ex.origin === "materials") { const p = resolveRefs([ex.ref], ev, evidence)[0]; example = p?.type === "passage" ? { ...example, source: p } : { ...example, origin: "ai" }; }
  else example.origin = "ai";

  const prev = raw.flow.previous && lineRef(raw.flow.previous.ref);
  const next = raw.flow.next && lineRef(raw.flow.next.ref);
  const flow = {
    previous: prev && (anchorIdx == null || prev.idx <= anchorIdx) ? { label: raw.flow.previous.label, source: prev } : null,
    current: { label: raw.flow.current.label, source: lineRef(raw.flow.current.ref) },
    // "next" only when that line was really said after the confusing one; never a guess
    next: next && anchorIdx != null && next.idx > anchorIdx ? { label: raw.flow.next.label, source: next } : null,
  };
  const d = raw.diagnostic;
  const diagnostic = d && d.choices.length >= 2 && d.choices.length <= 4 && d.correct_index >= 0 && d.correct_index < d.choices.length && d.question.trim() ? d : null;
  return {
    enough: raw.enough_evidence, clarify: raw.enough_evidence ? "" : raw.clarify_question,
    topic: raw.topic.slice(0, 80),
    explanation: { text: raw.explanation.text, terms: raw.explanation.terms.slice(0, 4), example },
    context: { text: raw.context.text, sources: resolveRefs(raw.context.refs, ev, evidence) },
    flow, diagnostic,
  };
}

// Without AI the student still gets the captured excerpt and the matching course passages.
function fallbackCard(ev, evidence, reason) {
  return {
    ai: false, reason,
    excerpt: evidence.lines.filter((l) => l.t <= ev.t + 0.5).slice(-6).map((l) => ({ idx: l.idx, t: l.t, text: l.text, mine: l.idx === evidence.anchorLine?.idx })),
    passages: evidence.passages.map((p) => ({ id: `P${p.id}`, title: p.title, location: p.location, url: p.url, source: p.source, text: p.text.slice(0, 500) })),
    gaps: evidence.gaps,
  };
}

const KIND_TEXT = {
  explain: `Write a help card the student can read in 20-30 seconds while class continues.
A. explanation.text: 2-3 short plain sentences on the concept in the marked line. Define only essential terms (0-3 in "terms"). One example or worked step in "example": if the professor or the materials gave one, use it with origin "lecture" (ref = its L id) or "materials" (ref = its P id); otherwise write your own small example with origin "ai" and ref "".
B. context.text: 1-2 sentences on how this connects to the surrounding lecture and the materials. Put the L and P ids you relied on in context.refs.
C. flow: previous idea -> confusing concept -> next idea, labels under 6 words, each with the L id it comes from. "next" must be a line that was said AFTER the marked line; if none, use null. Never guess where the professor is going.
diagnostic: when the confusion probably comes from a missing prerequisite (e.g. two-dimensional parity needs ordinary parity), one multiple-choice question with 3 choices that checks that prerequisite; name it in "prerequisite". Otherwise null.`,
  retry: `The student read the explanation(s) in <previous> and is still confused. Do not repeat them. Try a different angle: a simpler concrete example, a step-by-step walk-through, or the prerequisite idea underneath. Same card format, keep it short. diagnostic should be null.`,
  prereq: `The student answered a check about the prerequisite wrongly (see <previous>). Explain that prerequisite first, simply, then link it in one sentence to the concept they were lost on. Same card format. diagnostic should be null.`,
};

async function aiCard(ev, kind, evidence) {
  const prev = all("SELECT payload FROM help_responses WHERE event_id = ? AND status = 'ok' AND kind != 'catchup' ORDER BY created_at", ev.id)
    .map((r) => parse(r.payload)).filter((p) => p?.explanation).map((p) => `- ${p.explanation.text} (example: ${p.explanation.example.text})`);
  const diag = kind === "prereq" ? one("SELECT * FROM checks WHERE event_id = ? AND kind = 'diagnostic' ORDER BY created_at DESC LIMIT 1", ev.id) : null;
  const prompt = `${evidenceBlock(evidence, ev)}

${KIND_TEXT[kind]}
${prev.length ? `<previous>\nExplanations already shown:\n${prev.join("\n")}${diag ? `\nPrerequisite checked: ${diag.prerequisite}. Question: ${diag.question}. The student chose "${parse(diag.choices, [])[diag.chosen_idx] ?? "?"}", the right answer was "${parse(diag.choices, [])[diag.correct_idx]}".` : ""}\n</previous>` : ""}
If the evidence is too thin to know what the student means (for example nothing was transcribed and no question was typed), set enough_evidence false, ask one short clarify_question, and keep the other fields brief and general.
Mark examples you wrote yourself with origin "ai". Reply as JSON in the given schema.`;
  const raw = await askJson({ prompt, schema: CARD_SCHEMA, effort: "low", timeoutMs: 25000, label: `help:${kind}` });
  return cleanCard(raw, ev, evidence);
}

// ---------- running a help request (deduplicated) ----------
const inflight = new Map(); // `${event}:${kind}:${attempt}` -> promise
export const LIMITS = { retry: 3, catchup: 12, perStudentSession: 60 };

export async function requestHelp(ev, kind, attempt) {
  const key = `${ev.id}:${kind}:${attempt}`;
  const existing = one("SELECT * FROM help_responses WHERE event_id = ? AND kind = ? AND attempt = ?", ev.id, kind, attempt);
  if (existing && existing.status !== "pending" && existing.status !== "failed") return rowOut(existing);
  if (inflight.has(key)) return inflight.get(key);
  const id = existing?.id || newId(9);
  if (!existing) run("INSERT INTO help_responses (id, event_id, kind, attempt, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", id, ev.id, kind, attempt, now());
  else run("UPDATE help_responses SET status = 'pending', error = NULL WHERE id = ?", id);
  const p = (async () => {
    const evidence = kind === "catchup" ? null : evidenceFor(ev);
    try {
      const payload = kind === "catchup" ? await catchUp(ev) : aiAvailable() ? await aiCard(ev, kind, evidence) : fallbackCard(ev, evidence, "off");
      if (payload.diagnostic) {
        const d = payload.diagnostic;
        const cid = newId(9);
        run("INSERT INTO checks (id, event_id, kind, question, choices, correct_idx, prerequisite, created_at) VALUES (?, ?, 'diagnostic', ?, ?, ?, ?, ?)",
          cid, ev.id, d.question, JSON.stringify(d.choices), d.correct_index, d.prerequisite, now());
        payload.diagnostic = { id: cid, question: d.question, choices: d.choices, prerequisite: d.prerequisite }; // answer stays on the server
      }
      if (payload.topic && !ev.topic) run("UPDATE confusion_events SET topic = ? WHERE id = ?", payload.topic, ev.id);
      const status = payload.ai === false ? "no_ai" : "ok";
      run("UPDATE help_responses SET status = ?, payload = ? WHERE id = ?", status, JSON.stringify(payload), id);
      return { id, kind, attempt, status, payload };
    } catch (e) {
      const code = e instanceof AiError ? e.code : "error";
      // AI failed: still give the student the excerpt and materials, and say why.
      const payload = kind === "catchup" ? await catchUp(ev, { noAi: true }) : fallbackCard(ev, evidence, code);
      run("UPDATE help_responses SET status = 'failed', payload = ?, error = ? WHERE id = ?", JSON.stringify(payload), `${code}|${e.message}`.slice(0, 300), id);
      return { id, kind, attempt, status: "failed", error: friendly(code), payload };
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

export const friendly = (code) => ({
  off: "The AI helper is off on this server.",
  timeout: "The AI took too long.",
  rate_limited: "The AI is busy right now (rate limit).",
  unavailable: "The AI service isn't reachable right now.",
  invalid: "The AI's answer didn't pass Lost's checks, so it isn't shown.",
  refused: "The AI declined to answer this one.",
}[code] || "Something went wrong getting help.");

function rowOut(r) {
  const payload = parse(r.payload);
  return { id: r.id, kind: r.kind, attempt: r.attempt, status: r.status, payload, error: r.status === "failed" ? friendly(String(r.error || "").split("|")[0]) : undefined };
}

// ---------- catch-up ----------
export async function catchUp(ev, { noAi = false } = {}) {
  const session = one("SELECT * FROM lecture_sessions WHERE id = ?", ev.session_id);
  const endT = session.status === "live" && session.started_at ? (Date.now() - Date.parse(session.started_at)) / 1000 : (session.ended_at ? (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000 : ev.t);
  const lines = all("SELECT idx, t, text, origin FROM transcript_lines WHERE session_id = ? AND t > ? ORDER BY idx LIMIT 80", ev.session_id, ev.t);
  const gaps = gapsBetween(ev.session_id, ev.t, endT);
  const base = { since: ev.t, until: endT, gaps, lineCount: lines.length };
  if (!lines.length) return { ...base, ai: false, empty: true, lines: [] };
  if (noAi || !aiAvailable()) return { ...base, ai: false, lines: lines.slice(-12) };
  const before = all("SELECT idx, t, text FROM transcript_lines WHERE session_id = ? AND t <= ? ORDER BY idx DESC LIMIT 4", ev.session_id, ev.t).reverse();
  const prompt = `A student tapped "I'm lost" at ${fmt(ev.t)} and has been reading an explanation since. Help them rejoin class.
What was being said when they tapped:
<transcript>
${before.map((l) => `L${l.idx} [${fmt(l.t)}] ${l.text}`).join("\n")}
</transcript>
What was said since (newest last):
<transcript>
${lines.map((l) => `L${l.idx} [${fmt(l.t)}] ${l.text}`).join("\n")}
</transcript>
${gaps.length ? `Gaps with no audio: ${gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)}`).join(", ")}. Say that part is missing; don't fill it in.` : ""}
happened: 1-3 sentences on what happened since the tap. current_topic: what is being discussed right now, under 10 words. connection: one sentence linking the tapped idea to the current topic so the student can follow again. Use only the transcript. refs: the L ids you used.`;
  const raw = await askJson({ prompt, schema: CATCHUP_SCHEMA, effort: "low", timeoutMs: 20000, label: "catchup" });
  const evidence = { lines: [...before, ...lines], passages: [] };
  return { ...base, ai: true, happened: raw.happened, current_topic: raw.current_topic, connection: raw.connection, sources: resolveRefs(raw.refs, ev, evidence), lines: lines.slice(-6) };
}

// ---------- comprehension check ----------
export async function makeCheck(ev) {
  const open = one("SELECT * FROM checks WHERE event_id = ? AND kind = 'comprehension' AND chosen_idx IS NULL AND skipped = 0", ev.id);
  if (open) return { id: open.id, question: open.question, choices: parse(open.choices, []) };
  if (!aiAvailable()) throw new AiError("off", "AI is off.");
  const evidence = evidenceFor(ev);
  const card = one("SELECT payload FROM help_responses WHERE event_id = ? AND status = 'ok' AND kind != 'catchup' ORDER BY created_at DESC LIMIT 1", ev.id);
  const shown = parse(card?.payload);
  const prompt = `${evidenceBlock(evidence, ev)}
${shown?.explanation ? `The student read this explanation:\n<previous>${shown.explanation.text} Example: ${shown.explanation.example.text}</previous>` : ""}
Write one short multiple-choice question that checks understanding of the concept using a NEW example (different numbers or situation from the lecture and the explanation). 3 or 4 choices, exactly one correct. "why": one sentence explaining the right answer.`;
  const raw = await askJson({ prompt, schema: CHECK_SCHEMA, effort: "low", timeoutMs: 25000, label: "check" });
  if (raw.choices.length < 2 || raw.choices.length > 5 || raw.correct_index < 0 || raw.correct_index >= raw.choices.length) throw new AiError("invalid", "Bad check.");
  const id = newId(9);
  run("INSERT INTO checks (id, event_id, kind, question, choices, correct_idx, why, created_at) VALUES (?, ?, 'comprehension', ?, ?, ?, ?, ?)",
    id, ev.id, raw.question, JSON.stringify(raw.choices), raw.correct_index, raw.why, now());
  return { id, question: raw.question, choices: raw.choices };
}

export function answerCheck(check, chosen, skip) {
  if (check.chosen_idx != null || check.skipped) return { already: true, correct: !!check.correct, correctIndex: check.correct_idx, why: check.why };
  if (skip) { run("UPDATE checks SET skipped = 1, answered_at = ? WHERE id = ?", now(), check.id); return { skipped: true }; }
  const choices = parse(check.choices, []);
  if (!Number.isInteger(chosen) || chosen < 0 || chosen >= choices.length) return { error: "Pick one of the choices." };
  const correct = chosen === check.correct_idx ? 1 : 0;
  run("UPDATE checks SET chosen_idx = ?, correct = ?, answered_at = ? WHERE id = ?", chosen, correct, now(), check.id);
  return { correct: !!correct, correctIndex: check.correct_idx, why: check.why, prerequisite: check.prerequisite };
}
