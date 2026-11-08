// Visual explanations: the schema the AI fills in, and the validation that turns its reply into a safe
// render spec. The AI never sends markup. It sends labels, ids and numbers; this file checks the
// structure, limits sizes, computes every number that is shown (sums, parity, curve positions), and
// drops anything it can't trust. The browser draws the spec with fixed, escaped templates (public/visuals.js).
import { S } from "./ai.js";

const num = { type: "number" };
const label = S.str;
const alt = S.str; // a one-sentence text alternative for screen readers

const V = {
  // A labeled strip or playing surface: regions along its length, lines across it, marks and arrows on it.
  zones: S.obj({
    type: S.enum("zones"), title: S.str, frame: S.enum("rink", "field", "strip"), simplified: S.bool,
    direction: S.str, // e.g. "Your team attacks left to right", or ""
    regions: S.list(S.obj({ label, from: num, to: num })),
    lines: S.list(S.obj({ label, at: num, style: S.enum("solid", "dashed") })),
    marks: S.list(S.obj({ id: S.str, label, at: num, lane: S.enum("top", "middle", "bottom"), shape: S.enum("point", "puck", "player") })),
    arrows: S.list(S.obj({ from: S.str, to: S.str, label })),
    alt,
  }),
  // Rules and exceptions: a tree that starts with a question; exceptions branch from the condition they apply to.
  decision: S.obj({
    type: S.enum("decision"), title: S.str,
    nodes: S.list(S.obj({ id: S.str, label, kind: S.enum("question", "outcome") })),
    edges: S.list(S.obj({ from: S.str, to: S.str, label })),
    alt,
  }),
  process: S.obj({ type: S.enum("process"), title: S.str, steps: S.list(S.obj({ label, detail: S.str })), alt }),
  cause_effect: S.obj({
    type: S.enum("cause_effect"), title: S.str,
    links: S.list(S.obj({ cause: label, effect: label, relation: S.enum("causes", "leads to", "prevents", "raises", "lowers", "requires") })),
    alt,
  }),
  comparison: S.obj({
    type: S.enum("comparison"), title: S.str, mode: S.enum("example_vs_counterexample", "side_by_side"),
    left: S.obj({ title: S.str, points: S.list(S.str) }), right: S.obj({ title: S.str, points: S.list(S.str) }),
    alt,
  }),
  // Worked calculation. Lost evaluates every step itself; the AI's own answer is only compared, never shown.
  calculation: S.obj({
    type: S.enum("calculation"), title: S.str,
    inputs: S.list(S.obj({ name: S.str, label, value: num, unit: S.str })),
    steps: S.list(S.obj({ name: S.str, label, expr: S.str })),
    result_unit: S.str, stated_result: S.nullable(num),
    alt,
  }),
  // Supply and demand (goods, loanable funds, labour...). Always drawn as a schematic, not to scale.
  market: S.obj({
    type: S.enum("market"), title: S.str, x_label: S.str, y_label: S.str, supply_label: S.str, demand_label: S.str,
    shift: S.enum("demand_right", "demand_left", "supply_right", "supply_left", "none"), cause: S.str,
    alt,
  }),
  // Even-parity bit grid: the data rows as sent, and optionally one flipped bit.
  bit_grid: S.obj({
    type: S.enum("bit_grid"), title: S.str, data_rows: S.list(S.str), flip: S.nullable(S.obj({ row: S.int, col: S.int })),
    alt,
  }),
  // A number written in a base: each digit under its place value; Lost computes the places and the total.
  place_value: S.obj({ type: S.enum("place_value"), title: S.str, digits: S.str, base: S.int, alt }),
  concept_map: S.obj({
    type: S.enum("concept_map"), title: S.str,
    nodes: S.list(S.obj({ id: S.str, label })), edges: S.list(S.obj({ from: S.str, to: S.str, label })),
    alt,
  }),
  tree: S.obj({ type: S.enum("tree"), title: S.str, nodes: S.list(S.obj({ id: S.str, label, parent: S.str })), alt }),
  analogy: S.obj({
    type: S.enum("analogy"), title: S.str, analogy: S.str,
    pairs: S.list(S.obj({ concept: label, analogy: label })), breaks_down: S.str,
    alt,
  }),
};
export const VISUAL_TYPES = Object.keys(V);

// What the AI actually fills in: one flat shape for every visual type (a union of 11 shapes is too
// large for structured output). fromWire() turns it into the per-type shape above before checking.
const opt = S.str;
// Only type, title and alt are required; the AI writes just the fields its chosen type uses.
const loose = (props, required) => ({ type: "object", properties: props, required, additionalProperties: false });
export const VISUAL_SCHEMA = S.nullable(loose({
  type: S.enum(...Object.keys(V)), title: S.str, alt: S.str,
  items: S.list(loose({ id: S.str, label: S.str, detail: S.str, kind: S.str, parent: S.str, at: num, to: num, lane: S.str, value: num, unit: S.str, expr: S.str }, ["label"])),
  links: S.list(loose({ from: S.str, to: S.str, label: S.str }, ["from", "to"])),
  rows: S.list(S.str),
  settings: loose({ frame: opt, simplified: S.bool, direction: opt, mode: opt, left_title: opt, right_title: opt, shift: opt,
    x_label: opt, y_label: opt, supply_label: opt, demand_label: opt, cause: opt, analogy: opt, breaks_down: opt,
    result_unit: opt, stated_result: S.nullable(num), flip_row: S.int, flip_col: S.int, base: S.int }, []),
}, ["type", "title", "alt"]));
export const MAP_SCHEMA = S.nullable(S.obj({ nodes: S.list(S.obj({ id: S.str, label })), edges: S.list(S.obj({ from: S.str, to: S.str, label: S.str })) }));

export function fromWire(w) {
  const it = (w.items || []).map((x) => ({ id: "", detail: "", parent: "", lane: "", unit: "", expr: "", ...x })), links = (w.links || []).map((l) => ({ label: "", ...l })), st = w.settings || {}, k = (x) => String(x.kind || "").toLowerCase();
  const base = { type: w.type, title: w.title, alt: w.alt };
  switch (w.type) {
    case "zones": return { ...base, frame: ["rink", "field", "strip"].includes(st.frame) ? st.frame : "strip", simplified: st.simplified !== false, direction: st.direction || "",
      regions: it.filter((x) => k(x) === "region").map((x) => ({ label: x.label, from: x.at, to: x.to })),
      lines: it.filter((x) => k(x) === "line").map((x) => ({ label: x.label, at: x.at, style: x.detail === "dashed" ? "dashed" : "solid" })),
      marks: it.filter((x) => k(x) === "mark").map((x) => ({ id: x.id, label: x.label, at: x.at, lane: ["top", "middle", "bottom"].includes(x.lane) ? x.lane : "middle", shape: ["puck", "player"].includes(x.detail) ? x.detail : "point" })),
      arrows: links.map((l) => ({ from: l.from, to: l.to, label: l.label })) };
    case "decision": return { ...base, nodes: it.map((x) => ({ id: x.id, label: x.label, kind: k(x) === "question" ? "question" : "outcome" })), edges: links };
    case "process": return { ...base, steps: it.map((x) => ({ label: x.label, detail: x.detail })) };
    case "cause_effect": return { ...base, links: links.map((l) => ({ cause: l.from, effect: l.to, relation: ["causes", "leads to", "prevents", "raises", "lowers", "requires"].includes(l.label) ? l.label : "leads to" })) };
    case "comparison": return { ...base, mode: st.mode === "example_vs_counterexample" ? st.mode : "side_by_side",
      left: { title: st.left_title, points: it.filter((x) => k(x) === "left").map((x) => x.label) }, right: { title: st.right_title, points: it.filter((x) => k(x) === "right").map((x) => x.label) } };
    case "calculation": return { ...base, inputs: it.filter((x) => k(x) === "input").map((x) => ({ name: x.id, label: x.label, value: x.value, unit: x.unit })),
      steps: it.filter((x) => k(x) === "step").map((x) => ({ name: x.id, label: x.label, expr: x.expr })), result_unit: st.result_unit || "", stated_result: st.stated_result ?? null };
    case "market": return { ...base, x_label: st.x_label, y_label: st.y_label, supply_label: st.supply_label, demand_label: st.demand_label,
      shift: ["demand_right", "demand_left", "supply_right", "supply_left"].includes(st.shift) ? st.shift : "none", cause: st.cause || "" };
    case "bit_grid": return { ...base, data_rows: w.rows || [], flip: Number.isInteger(st.flip_row) && Number.isInteger(st.flip_col) && st.flip_row >= 0 && st.flip_col >= 0 ? { row: st.flip_row, col: st.flip_col } : null };
    case "place_value": return { ...base, digits: String((w.rows || [])[0] || ""), base: Number(st.base) || 2 };
    case "concept_map": return { ...base, nodes: it.map((x) => ({ id: x.id, label: x.label })), edges: links };
    case "tree": return { ...base, nodes: it.map((x) => ({ id: x.id, label: x.label, parent: x.parent || "" })) };
    case "analogy": return { ...base, analogy: st.analogy || "", pairs: it.map((x) => ({ concept: x.label, analogy: x.detail })), breaks_down: st.breaks_down || "" };
    default: return base;
  }
}

export const VISUAL_GUIDE = `visual: pick the type that fits the idea, or null when a picture adds nothing (then the example does the work). Write only the fields that type uses and leave the others out.
- zones: where things are on a surface or strip (rink, field, timeline). settings.frame rink|field|strip, settings.simplified true unless the materials give exact geometry, settings.direction e.g. "Your team attacks". items: kind "region" (label, at = start 0-100, to = end 0-100), kind "line" (label, at, detail "solid" or "dashed"), kind "mark" (id, label, at, lane top|middle|bottom, detail "puck", "player" or "point"). links: arrows between mark ids, with a label. Show the movement the idea is about (for example the puck from where it is shot to where it ends up); leave consequences to the text. When a rule compares positions (offside: a player's skates and the puck against the blue line), mark every object it compares, each with its detail "player" or "puck", on the correct side of the line. Label every region. Place only what the lecture or materials say.
- decision: a rule with conditions and exceptions. items: id, label, kind "question" or "outcome". links from a question to the next node, labelled with the condition ("Yes", "No", "Shorthanded"). The root is a question. An exception is its own branch from the condition it changes, never a step after an outcome.
- process: items in the real order (label, detail), 2-5 of them.
- cause_effect: links with from = cause, to = effect, label one of causes|leads to|prevents|raises|lowers|requires.
- comparison: settings.mode example_vs_counterexample or side_by_side, settings.left_title, settings.right_title; items kind "left" or "right", label = one short point.
- calculation: items kind "input" (id = short name, label, value, unit), then kind "step" (id = short name, label, expr using + - * / ^ ( ) and earlier ids). Lost computes every number; put your own final answer in settings.stated_result.
- market: supply and demand (goods, loanable funds, labour). settings.x_label, y_label, supply_label, demand_label, shift demand_right|demand_left|supply_right|supply_left|none, cause. Lost draws the curves.
- place_value: a number written in a base, for converting or reading binary, decimal or hex numbers. rows = [the digits, e.g. "1101"]; settings.base 2, 8, 10 or 16. Lost computes every place value and the total.
- bit_grid: only for parity error detection. rows = data rows of 0/1 (2-5 rows, 2-6 bits each); settings.flip_row and flip_col = the flipped bit (0-based) or -1.
- concept_map: items (id, label), links (from, to, label). tree: items (id, label, parent id or "").
- analogy: only for abstract ideas. settings.analogy = one sentence; items label = the class idea, detail = its match in the analogy; settings.breaks_down.
Labels under 28 characters. alt: one sentence saying what the picture shows.`;

// ---------- helpers ----------
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const L = (s) => clip(s, 40);
const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
const uniq = (arr, key) => { const seen = new Set(); return arr.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x)))); };
class Reject extends Error {}
const need = (ok, why) => { if (!ok) throw new Reject(why); };

// Safe arithmetic: numbers, names, + - * / ^ and parentheses. No function calls, no property access.
export function evaluate(expr, vars) {
  const src = String(expr).replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  const toks = src.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^()]|\S/g) || [];
  let i = 0;
  const peek = () => toks[i], take = () => toks[i++];
  const prim = () => {
    const t = take();
    if (t === undefined) throw new Reject("expression ended early");
    if (t === "(") { const v = add(); need(take() === ")", "missing )"); return v; }
    if (t === "-") return -prim();
    if (t === "+") return prim();
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) { need(Object.hasOwn(vars, t), `unknown name ${t}`); return vars[t]; }
    throw new Reject(`unexpected ${t}`);
  };
  const pow = () => { const b = prim(); if (peek() === "^") { take(); return b ** pow(); } return b; };
  const mul = () => { let v = pow(); while (peek() === "*" || peek() === "/") { const o = take(), r = pow(); v = o === "*" ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (peek() === "+" || peek() === "-") { const o = take(), r = mul(); v = o === "+" ? v + r : v - r; } return v; };
  const v = add();
  need(i === toks.length, "extra text in expression");
  need(Number.isFinite(v), "result is not a finite number");
  return v;
}

function graph(nodes, edges, { maxNodes = 8, tree = false } = {}) {
  const ns = uniq(nodes.map((n) => ({ ...n, id: clip(n.id, 20), label: L(n.label) })).filter((n) => n.id && n.label), (n) => n.id);
  need(ns.length >= 2 && ns.length <= maxNodes, `needs 2-${maxNodes} nodes`);
  const ids = new Set(ns.map((n) => n.id));
  const es = uniq(edges.map((e) => ({ from: clip(e.from, 20), to: clip(e.to, 20), label: clip(e.label, 24) })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to), (e) => `${e.from}>${e.to}`);
  need(es.length >= 1, "no valid links");
  // no cycles (Kahn); a tree also needs one root and one parent per node
  const indeg = new Map(ns.map((n) => [n.id, 0]));
  for (const e of es) indeg.set(e.to, indeg.get(e.to) + 1);
  if (tree) {
    need([...indeg.values()].filter((d) => d === 0).length === 1, "a tree needs exactly one starting point");
    need([...indeg.values()].every((d) => d <= 1), "a branch can only come from one place");
  }
  const q = ns.filter((n) => indeg.get(n.id) === 0).map((n) => n.id), d2 = new Map(indeg), order = [], depth = new Map(q.map((id) => [id, 0]));
  while (q.length) { const id = q.shift(); order.push(id); for (const e of es.filter((x) => x.from === id)) { depth.set(e.to, Math.max(depth.get(e.to) ?? 0, depth.get(id) + 1)); d2.set(e.to, d2.get(e.to) - 1); if (!d2.get(e.to)) q.push(e.to); } }
  need(order.length === ns.length, "links go in a circle");
  need(Math.max(...depth.values()) <= 4, "too many levels");
  return { nodes: ns.map((n) => ({ ...n, depth: depth.get(n.id) })), edges: es };
}

const CLEAN = {
  zones(v) {
    const regions = v.regions.map((r) => ({ label: L(r.label), from: clamp(r.from, 0, 100), to: clamp(r.to, 0, 100) })).filter((r) => r.label && r.to - r.from >= 5).sort((a, b) => a.from - b.from).slice(0, 4);
    const lines = uniq(v.lines.map((l) => ({ label: clip(l.label, 24), at: clamp(l.at, 0, 100), style: l.style })), (l) => Math.round(l.at)).sort((a, b) => a.at - b.at).slice(0, 6);
    const marks = uniq(v.marks.map((m) => ({ id: clip(m.id, 20), label: clip(m.label, 28), at: clamp(m.at, 0, 100), lane: m.lane, shape: ["puck", "player"].includes(m.shape) ? m.shape : "point" })).filter((m) => m.id && m.label), (m) => m.id).slice(0, 4);
    const ids = new Set(marks.map((m) => m.id));
    const arrows = v.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to).map((a) => ({ from: a.from, to: a.to, label: clip(a.label, 28) })).slice(0, 3);
    need(regions.length + lines.length + marks.length >= 2, "too little to draw");
    return { frame: v.frame, simplified: v.simplified !== false, direction: clip(v.direction, 48), regions, lines, marks, arrows };
  },
  decision(v) {
    const g = graph(v.nodes.map((n) => ({ ...n, kind: n.kind })), v.edges, { maxNodes: 9, tree: true });
    const root = g.nodes.find((n) => n.depth === 0);
    need(root.kind === "question", "a rule tree starts with a question");
    const parents = new Set(g.edges.map((e) => e.from));
    need(g.nodes.every((n) => n.kind !== "outcome" || !parents.has(n.id)), "an outcome can't lead anywhere");
    return g;
  },
  process(v) {
    const steps = v.steps.map((s) => ({ label: L(s.label), detail: clip(s.detail, 140) })).filter((s) => s.label).slice(0, 6);
    need(steps.length >= 2, "a process needs at least 2 steps");
    return { steps };
  },
  cause_effect(v) {
    const links = v.links.map((l) => ({ cause: L(l.cause), effect: L(l.effect), relation: l.relation })).filter((l) => l.cause && l.effect).slice(0, 4);
    need(links.length >= 1, "no links");
    return { links };
  },
  comparison(v) {
    const side = (s) => ({ title: clip(s.title, 32), points: s.points.map((p) => clip(p, 90)).filter(Boolean).slice(0, 4) });
    const left = side(v.left), right = side(v.right);
    need(left.title && right.title && left.points.length && right.points.length, "both sides need a title and points");
    return { mode: v.mode, left, right };
  },
  calculation(v) {
    const vars = {}, inputs = [];
    for (const x of v.inputs.slice(0, 6)) {
      const name = String(x.name).trim();
      need(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(name) && !Object.hasOwn(vars, name), `bad input name ${name}`);
      need(Number.isFinite(x.value), `input ${name} has no number`);
      vars[name] = x.value; inputs.push({ name, label: L(x.label), value: x.value, unit: clip(x.unit, 12) });
    }
    const steps = [];
    for (const s of v.steps.slice(0, 6)) {
      const name = String(s.name).trim();
      need(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(name) && !Object.hasOwn(vars, name), `bad step name ${name}`);
      const value = evaluate(s.expr, vars);
      vars[name] = value; steps.push({ name, label: L(s.label), expr: clip(s.expr, 80), value });
    }
    need(steps.length >= 1, "no steps");
    const result = steps.at(-1).value, stated = v.stated_result;
    const mismatch = Number.isFinite(stated) && Math.abs(stated - result) > Math.max(0.005 * Math.abs(result), 0.01);
    return { inputs, steps, result, result_unit: clip(v.result_unit, 12), mismatch, stated: mismatch ? stated : null };
  },
  market(v) {
    // Fixed schematic lines: demand P = 8 - Q, supply P = 2 + Q (Q, P in 0-10). A shift moves a curve 2 units along Q.
    const [curve, dir] = v.shift === "none" ? [null, 0] : [v.shift.split("_")[0], v.shift.endsWith("right") ? 1 : -1];
    const eq = (dShift, sShift) => { const q = (6 + dShift + sShift) / 2; return { q, p: 8 - (q - dShift) }; };
    const before = eq(0, 0), after = curve === "demand" ? eq(2 * dir, 0) : curve === "supply" ? eq(0, 2 * dir) : null;
    const sign = (a, b) => (b > a + 1e-9 ? "up" : b < a - 1e-9 ? "down" : "same");
    return {
      x_label: clip(v.x_label, 32) || "Quantity", y_label: clip(v.y_label, 32) || "Price", supply_label: clip(v.supply_label, 20) || "Supply", demand_label: clip(v.demand_label, 20) || "Demand",
      shift: v.shift, curve, dir, cause: clip(v.cause, 90), before, after,
      effect: after ? { price: sign(before.p, after.p), quantity: sign(before.q, after.q) } : null,
    };
  },
  bit_grid(v) {
    const rows = v.data_rows.map((r) => String(r).replace(/\s/g, ""));
    need(rows.length >= 2 && rows.length <= 5, "2-5 rows");
    need(rows.every((r) => /^[01]{2,6}$/.test(r) && r.length === rows[0].length), "rows must be 0/1 and the same length");
    const sent = rows.map((r) => [...r].map(Number));
    const par = (bits) => bits.reduce((a, b) => a ^ b, 0);
    const rowPar = sent.map(par), colPar = sent[0].map((_, c) => par(sent.map((r) => r[c]))), corner = par(rowPar);
    let flip = null, received = sent.map((r) => [...r]), failRow = null, failCol = null;
    if (v.flip) {
      need(v.flip.row >= 0 && v.flip.row < sent.length && v.flip.col >= 0 && v.flip.col < sent[0].length, "flipped bit is outside the grid");
      flip = { row: v.flip.row, col: v.flip.col };
      received[flip.row][flip.col] ^= 1;
      failRow = received.findIndex((r, i) => par(r) !== rowPar[i]);
      failCol = received[0].findIndex((_, c) => par(received.map((r) => r[c])) !== colPar[c]);
    }
    return { sent, received, rowPar, colPar, corner, flip, failRow, failCol };
  },
  place_value(v) {
    const base = [2, 8, 10, 16].includes(v.base) ? v.base : 2;
    const digits = String(v.digits || "").replace(/[\s_]/g, "").toUpperCase();
    const ok = { 2: /^[01]{1,8}$/, 8: /^[0-7]{1,6}$/, 10: /^[0-9]{1,6}$/, 16: /^[0-9A-F]{1,4}$/ }[base];
    need(ok.test(digits), `digits don't fit base ${base}`);
    const n = digits.length, places = [...digits].map((d, i) => ({ digit: d, value: parseInt(d, 16), weight: base ** (n - 1 - i) }));
    places.forEach((p) => (p.part = p.value * p.weight));
    return { base, digits, places, total: places.reduce((a, p) => a + p.part, 0) };
  },
  concept_map(v) { return graph(v.nodes, v.edges, { maxNodes: 7 }); },
  tree(v) {
    const nodes = v.nodes.slice(0, 8);
    const edges = nodes.filter((n) => n.parent).map((n) => ({ from: n.parent, to: n.id, label: "" }));
    return graph(nodes, edges, { maxNodes: 8, tree: true });
  },
  analogy(v) {
    const pairs = v.pairs.map((p) => ({ concept: L(p.concept), analogy: L(p.analogy) })).filter((p) => p.concept && p.analogy).slice(0, 4);
    need(v.analogy && pairs.length, "an analogy needs pairs");
    return { analogy: clip(v.analogy, 140), pairs, breaks_down: clip(v.breaks_down, 140) };
  },
};

// A plain-language description built from the checked spec, used when the AI's alt is empty and as the text fallback.
function describe(type, s) {
  switch (type) {
    case "zones": return [s.direction, s.regions.length ? `Areas from left to right: ${s.regions.map((r) => r.label).join(", ")}.` : "", s.lines.length ? `Lines: ${s.lines.map((l) => l.label).join(", ")}.` : "", ...s.arrows.map((a) => `${s.marks.find((m) => m.id === a.from).label} moves to ${s.marks.find((m) => m.id === a.to).label}${a.label ? ` (${a.label})` : ""}.`)].filter(Boolean).join(" ");
    case "process": return s.steps.map((x, i) => `${i + 1}. ${x.label}`).join(" ");
    case "cause_effect": return s.links.map((l) => `${l.cause} ${l.relation} ${l.effect}.`).join(" ");
    case "comparison": return `${s.left.title}: ${s.left.points.join("; ")}. ${s.right.title}: ${s.right.points.join("; ")}.`;
    case "calculation": return s.steps.map((x) => `${x.label} = ${x.expr} = ${Math.round(x.value * 100) / 100}`).join(". ");
    case "market": return s.after ? `${s.curve === "demand" ? s.demand_label : s.supply_label} shifts ${s.dir > 0 ? "right" : "left"}; ${s.y_label} goes ${s.effect.price} and ${s.x_label} goes ${s.effect.quantity}.` : `${s.supply_label} and ${s.demand_label} meet at the equilibrium.`;
    case "bit_grid": return s.flip ? `Bit in row ${s.flip.row + 1}, column ${s.flip.col + 1} flipped; row ${s.failRow + 1} and column ${s.failCol + 1} fail their parity checks and cross at that bit.` : `A ${s.sent.length} by ${s.sent[0].length} grid with a parity bit for each row and column.`;
    case "decision": case "concept_map": case "tree": return s.edges.map((e) => `${s.nodes.find((n) => n.id === e.from).label} ${e.label ? `(${e.label}) ` : ""}→ ${s.nodes.find((n) => n.id === e.to).label}`).join(". ");
    case "analogy": return `Analogy: ${s.analogy}`;
    case "place_value": return `${s.digits} in base ${s.base}: ${s.places.map((p) => `${p.digit} × ${p.weight}`).join(" + ")} = ${s.total}.`;
    default: return "";
  }
}

// Returns { ok: true, visual } or { ok: false, reason }. Never throws.
export function cleanVisual(raw) {
  if (!raw) return { ok: false, reason: "none" };
  if (Array.isArray(raw.items) || raw.settings) raw = fromWire(raw);
  const type = raw.type;
  if (!CLEAN[type]) return { ok: false, reason: `unsupported visual type ${String(type).slice(0, 20)}` };
  try {
    const spec = CLEAN[type](raw);
    const text = describe(type, spec);
    return { ok: true, visual: { type, title: clip(raw.title, 60), alt: clip(raw.alt, 240) || clip(text, 240), text: clip(text, 600), ...spec } };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    return { ok: false, reason: "couldn't check this picture" };
  }
}
export function cleanMap(raw) {
  if (!raw) return null;
  const r = cleanVisual({ type: "concept_map", title: "", alt: "", ...raw });
  return r.ok ? r.visual : null;
}
