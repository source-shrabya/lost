// The live help workflow: confusion event -> explanation card -> diagnostic / check -> catch-up.
//
// Every AI answer is built from evidence Lost hands the model with ids (L12 = transcript line 12,
// P34 = course passage 34). After the reply comes back, resolveRefs() drops any id that wasn't in
// the evidence, so a card can only cite lines and passages that exist and the student may see.
import { one, all, run, now, newId, parse } from "./db.js";
import { askJson, aiAvailable, S, AiError } from "./ai.js";
import { retrieve } from "./materials.js";
import { VISUAL_SCHEMA, VISUAL_GUIDE, cleanVisual } from "./visuals.js";

const fmt = (t) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- schemas ----------
const ref = S.str;
const DIAGNOSTIC = S.obj({ question: S.str, choices: S.list(S.str), correct_index: S.int, prerequisite: S.str });
const CLAIM = S.obj({ text: S.str, refs: S.list(ref) });
export const CARD_SCHEMA = S.obj({
  enough_evidence: S.bool,
  clarify_question: S.str,
  title: S.str,
  hook: S.str,
  takeaway: CLAIM,
  explanation: CLAIM,
  terms: S.list(S.obj({ term: S.str, definition: S.str })),
  example: S.obj({ text: S.str, why: S.str, origin: S.enum("lecture", "materials", "ai"), ref }),
  rule: S.nullable(S.obj({ what_happened: CLAIM, what_next: CLAIM, when_differs: S.list(CLAIM) })),
  qualifications: S.list(CLAIM),
  uncertainty: S.str,
  connection: CLAIM,
  visual: VISUAL_SCHEMA,
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
  const before = all("SELECT idx, t, text, origin, unsure FROM transcript_lines WHERE session_id = ? AND t >= ? AND t <= ? ORDER BY idx", ev.session_id, aroundT - 150, aroundT + 0.01);
  const after = anchorLine ? all("SELECT idx, t, text, origin, unsure FROM transcript_lines WHERE session_id = ? AND idx > ? ORDER BY idx LIMIT 4", ev.session_id, anchorLine.idx) : [];
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
${lines.map((l) => `L${l.idx} [${fmt(l.t)}]${l.origin === "sample" ? " (sample text)" : ""}${l.unsure ? " (speech-to-text unsure of some words)" : ""} ${l.text}${mark(l)}`).join("\n") || "(nothing was transcribed around this moment)"}
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

// Small, safe repairs before validation: a sentence given as plain text where a cited claim was asked for
// becomes a claim with no sources (so it shows as unsupported), and a missing optional list becomes [].
export function fixClaims(v, keys, lists = []) {
  if (!v || typeof v !== "object") return v;
  const c = (x) => (typeof x === "string" ? { text: x, refs: [] } : x && typeof x === "object" && !Array.isArray(x.refs) ? { ...x, refs: [] } : x);
  for (const k of keys) if (k in v) v[k] = c(v[k]);
  for (const k of lists) if (!Array.isArray(v[k])) v[k] = (v[k] == null ? [] : [v[k]]).map(c);
  return v;
}
const fixCard = (v) => {
  fixClaims(v, ["takeaway", "explanation", "connection"], ["qualifications"]);
  if (v.rule) { fixClaims(v.rule, ["what_happened", "what_next"], ["when_differs"]); }
  if (!Array.isArray(v.terms)) v.terms = [];
  for (const k of ["rule", "visual", "diagnostic"]) if (!(k in v)) v[k] = null;
  if (typeof v.uncertainty !== "string") v.uncertainty = "";
  if (typeof v.clarify_question !== "string") v.clarify_question = "";
  if (typeof v.hook !== "string") v.hook = "";
  return v;
};

// Ids like "(L4, L5)" or "P12" belong in refs, not in text a student reads.
export const stripIds = (t) => String(t).replace(/\s*\((?:\s*[LP]\d+\s*,?)+\)/g, "").replace(/\b[LP]\d+\b,?\s*/g, "").replace(/\s{2,}/g, " ").trim();

// ---------- provenance ----------
// Flags on a cited transcript line, so a shaky source is visible next to the claim it supports.
export function flagSources(sources, sessionId) {
  if (!sources?.length) return sources || [];
  const gaps = all("SELECT from_t, to_t FROM transcript_gaps WHERE session_id = ?", sessionId);
  return sources.map((src) => {
    if (src.type !== "line") return src;
    const row = one("SELECT unsure, t FROM transcript_lines WHERE session_id = ? AND idx = ?", sessionId, src.idx);
    const flags = [];
    const span = (g) => `${fmt(g.from_t)}-${g.to_t == null ? "end" : fmt(g.to_t)}`;
    const inside = gaps.find((x) => src.t > x.from_t + 0.5 && src.t < (x.to_t ?? 1e12) - 0.5);
    const after = gaps.find((x) => x.to_t != null && src.t >= x.to_t - 0.5 && src.t <= x.to_t + 3);
    if (inside) flags.push(`Timed inside a stretch with no recorded audio (${span(inside)}), so its timing doesn't add up.`);
    else if (after) flags.push(`First line after an audio gap (${span(after)}); it may mix in words from the missing part.`);
    if (row?.unsure) flags.push("Speech-to-text was unsure about some words in this line.");
    if (src.text.trim().split(/\s+/).length < 4) flags.push("Only a fragment of a sentence was captured.");
    return flags.length ? { ...src, flags } : src;
  });
}
// Notes about the moment itself: a tap during missing audio, or a tap far from the nearest recorded line.
export function momentNotes(ev, evidence) {
  const notes = [];
  const g = one("SELECT from_t, to_t FROM transcript_gaps WHERE session_id = ? AND from_t <= ? AND COALESCE(to_t, 1e12) >= ?", ev.session_id, ev.t, ev.t);
  if (g) notes.push(`Your tap came while no audio was reaching Lost (${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)}). This help uses the last lines that were recorded.`);
  const near = evidence.anchorLine || evidence.lines.filter((l) => l.t <= ev.t + 0.5).at(-1);
  if (near && ev.t - near.t > 45 && ev.anchor !== "phrase") notes.push(`The nearest recorded line is from ${fmt(near.t)}, ${Math.round(ev.t - near.t)} seconds before your tap.`);
  return notes;
}

// Typed and sample lines can't be misheard: drop a "misheard / garbled" warning when no line around
// the moment came from speech-to-text.
const misheardClaimWithoutSpeech = (text, evidence) => /mishear|misheard|garbl|mis-?transcri|transcribed unclear|unclear(ly)? transcri/i.test(String(text || ""))
  && !evidence.lines.some((l) => l.origin === "speech");

// Check a card against the evidence. Anything unsupported is removed, never shown.
export function cleanCard(raw, ev, evidence) {
  const refs = (ids) => flagSources(resolveRefs(ids, ev, evidence), ev.session_id);
  const claim = (c) => (c && c.text?.trim() ? { text: stripIds(c.text), sources: refs(c.refs) } : null);
  const ex = raw.example;
  let example = ex?.text?.trim() ? { text: ex.text.trim(), why: (ex.why || "").trim(), origin: ex.origin, source: null } : null;
  if (example) {
    const src = refs([ex.ref])[0];
    if (ex.origin === "lecture" && src?.type === "line") example.source = src;
    else if (ex.origin === "materials" && src?.type === "passage") example.source = src;
    else example.origin = "ai";
  }
  const rule = raw.rule && claim(raw.rule.what_happened) && claim(raw.rule.what_next)
    ? { what_happened: claim(raw.rule.what_happened), what_next: claim(raw.rule.what_next), when_differs: raw.rule.when_differs.map(claim).filter(Boolean).slice(0, 3) } : null;
  const vis = cleanVisual(raw.visual);
  const d = raw.diagnostic;
  const diagnostic = d && d.choices.length >= 2 && d.choices.length <= 4 && d.correct_index >= 0 && d.correct_index < d.choices.length && d.question.trim() ? d : null;
  return {
    v: 2,
    enough: raw.enough_evidence, clarify: raw.enough_evidence ? "" : raw.clarify_question,
    title: raw.title.trim().slice(0, 90), topic: raw.title.trim().slice(0, 80),
    hook: stripIds(raw.hook || "").slice(0, 140),
    takeaway: claim(raw.takeaway), explanation: rule ? null : claim(raw.explanation),
    terms: raw.terms.filter((t) => t.term && t.definition).slice(0, 2),
    example, rule,
    qualifications: raw.qualifications.map(claim).filter(Boolean).slice(0, 2),
    uncertainty: misheardClaimWithoutSpeech(raw.uncertainty, evidence) ? "" : stripIds(raw.uncertainty || "").slice(0, 200),
    connection: claim(raw.connection),
    visual: vis.ok ? vis.visual : null,
    visualIssue: vis.ok || vis.reason === "none" ? null : vis.reason,
    provenance: momentNotes(ev, evidence),
    diagnostic,
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

const CARD_RULES = `Voice: talk like the sharpest friend in the next seat, leaning over to whisper the thing that makes it click. Second person, contractions, short punchy sentences. Concrete and vivid beats abstract and correct-sounding. Never sound like a textbook or a report: no "This means", "Essentially", "In this context", "The professor is saying", "refers to", "is defined as", "plays a role". Don't repeat the marked line back.
title: the student's question in their own words, under 7 words ("Wait, what does the CPU do?").
hook: one line under 14 words that makes the idea stick: a picture from everyday student life, a surprising fact, or a tiny story. Not a definition. Invent it fresh for this idea; never a stock line. Must stay true to the lecture.
When <previous> cards exist, the new card must use a different hook, a different example and, if it has a visual, a different visual type. Reusing any of them makes the card useless to this student.
takeaway: the idea itself in one plain sentence under 18 words.
explanation: at most 1 short sentence that adds the why. "" if the hook and takeaway already cover it. Must be "" when rule is set.
The student sees only title, hook, takeaway, visual and example at first; everything else sits behind "More". So those five must carry the whole idea on their own, in about 50 words total.
terms: 0-1 word the student can't follow without, definition under 10 words. [] usually.
example: one concrete case under 22 words from a college student's life (phone, laptop, games, food, music, campus) or the professor's own example. Prefer the professor's or the materials' example (origin "lecture" or "materials" with its id); otherwise write one with origin "ai" and ref "". "why": "".
rule: only when the concept is a rule with a consequence (a sport, a law, grammar, a protocol). what_happened: the condition that triggers it, under 15 words. what_next: the consequence, under 15 words. when_differs: exceptions the sources mention, each under 15 words; [] if none. Otherwise null.
qualifications: 0-1 limit that must not be lost (a number, "not", "only if"). [] usually.
uncertainty: only when words in the transcript are clearly misheard (they make no sense where they stand, like "Divide the drink" for "Dive into the rink"), or the lecture and the notes disagree on a fact, and that could change what the student believes. A long, fast or run-on sentence is not garbled; numbers written as words are not garbled. When it applies: one sentence under 18 words, written to the student ("Some words were misheard here, so the notes' version is used."). Never mention line ids, timestamps or "L1". Otherwise "".
connection: one sentence under 15 words on where this sits in today's class.
Hook, visual and example each show something new: if the hook or an analogy visual already uses a picture, the example must be a different case, never the same picture again.
refs on every claim: the L and P ids that support it. When the transcript is garbled, take the wording of rules from the course materials, not from the garbled line.
Being right matters more than being catchy: never add a fact, position, number or label that the lecture or materials don't support. The hook's picture can be your own, but the fact inside it can't.
${VISUAL_GUIDE}
The visual must agree with the text. An exception is a branch from its condition, never a later step.
When rule is set, Lost already draws the rule as a branch, so the visual must show something else: where it happens (zones) or a comparison; never a process of the rule's steps. If the rule is about places on a surface (a rink, field, court, board, map), the visual must be zones.
Never write L or P ids inside any text; they only go in refs.`;

const KIND_TEXT = {
  explain: `Write a help card the student reads in about 20 seconds while class keeps going. One idea only: the one in the marked line (or the student's question).
${CARD_RULES}
diagnostic: when the confusion probably comes from a missing prerequisite (e.g. two-dimensional parity needs ordinary parity), one multiple-choice question with 3 choices that checks that prerequisite; name it in "prerequisite". Otherwise null.`,
  retry: `The student read the card(s) in <previous> and asked to see it explained differently. Use a different angle: an everyday analogy (use the analogy visual), an example next to a counterexample (comparison visual), or a picture. Use a different visual type, a different hook and a completely different example from the ones in <previous>; repeating any of them is a failure.
${CARD_RULES}
diagnostic: null.`,
  steps: `The student asked to see the steps. Break the same idea into 2-5 steps in the order they really happen, or a worked calculation if numbers are involved. Use a process or calculation visual (or decision, if it's a rule with exceptions). explanation can be "".
${CARD_RULES}
diagnostic: null.`,
  simpler: `The student read <previous> and is still confused. Go one level more basic: explain the idea underneath in the simplest words, then link it back in one sentence. Shorter than before. Don't repeat earlier wording.
${CARD_RULES}
diagnostic: null.`,
  prereq: `The student answered a check about the prerequisite wrongly (see <previous>). Explain that prerequisite first, simply, then link it in one sentence to the concept they were lost on.
${CARD_RULES}
diagnostic: null.`,
};

async function aiCard(ev, kind, evidence) {
  const prev = all("SELECT payload FROM help_responses WHERE event_id = ? AND status = 'ok' AND kind != 'catchup' ORDER BY created_at", ev.id)
    .map((r) => parse(r.payload)).filter((p) => p?.explanation || p?.takeaway).map((p) => `- ${cardText(p)}`);
  const diag = kind === "prereq" ? one("SELECT * FROM checks WHERE event_id = ? AND kind = 'diagnostic' ORDER BY created_at DESC LIMIT 1", ev.id) : null;
  const prompt = `${evidenceBlock(evidence, ev)}

${KIND_TEXT[kind]}
${prev.length ? `<previous>\nExplanations already shown:\n${prev.join("\n")}${diag ? `\nPrerequisite checked: ${diag.prerequisite}. Question: ${diag.question}. The student chose "${parse(diag.choices, [])[diag.chosen_idx] ?? "?"}", the right answer was "${parse(diag.choices, [])[diag.correct_idx]}".` : ""}\n</previous>` : ""}
If the evidence is too thin to know what the student means (for example nothing was transcribed and no question was typed), set enough_evidence false, ask one short clarify_question, and keep the other fields brief and general.
Mark examples you wrote yourself with origin "ai". Reply as JSON in the given schema.`;
  const raw = await askJson({ prompt, schema: CARD_SCHEMA, effort: "low", timeoutMs: 30000, maxTokens: 3000, label: `help:${kind}`, strict: false, fix: fixCard, think: false });
  return cleanCard(raw, ev, evidence);
}

// The words of a card, for prompts that need to know what the student already read.
export function cardText(p) {
  if (!p) return "";
  if (p.v === 2) return [p.title, p.hook, p.takeaway?.text, p.explanation?.text, p.rule ? `${p.rule.what_happened.text} ${p.rule.what_next.text}` : "", p.example ? `Example: ${p.example.text}` : ""].filter(Boolean).join(" ");
  return `${p.explanation?.text || ""} (example: ${p.explanation?.example?.text || ""})`;
}

// ---------- running a help request (deduplicated) ----------
const inflight = new Map(); // `${event}:${kind}:${attempt}` -> promise
export const LIMITS = { retry: 3, catchup: 12, perStudentSession: 60 };
export const CARD_KINDS = ["explain", "retry", "steps", "simpler", "prereq"];

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
  // Too little was said to summarise: show the lines themselves instead of asking the AI to fill in.
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  if (lines.length < 2 || words < 20) return { ...base, ai: false, thin: true, lines: lines.slice(-12) };
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
${shown?.explanation || shown?.takeaway ? `The student read this explanation:\n<previous>${cardText(shown)}</previous>` : ""}
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
