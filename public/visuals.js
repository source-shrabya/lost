// Visual explanations and the lesson card used by live help and the after-class summary.
// Everything here draws from a spec the server already checked (lib/visuals.js). Text is always
// escaped; the AI never supplies markup, styles or coordinates beyond the checked numbers.
(function () {
  const L = window.Lost;
  const { esc, fmt } = L;
  let uid = 0;
  const id = (p) => `${p}${++uid}`;

  // ---------- small helpers ----------
  const wrap = (text, max) => {
    const out = []; let cur = "";
    for (const w of String(text).split(/\s+/)) {
      if (!w) continue;
      if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const tspans = (lines, x, lh) => lines.map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join("");
  const num = (x) => {
    if (!Number.isFinite(x)) return "?";
    const a = Math.abs(x);
    return x.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 4 : 6 });
  };
  const figure = (v, body, { note = "" } = {}) => `<figure class="vis" data-vis="${esc(v.type)}">
      ${v.title || note ? `<figcaption>${v.title ? `<b>${esc(v.title)}</b>` : ""}${note ? ` <span class="v-note">${esc(note)}</span>` : ""}</figcaption>` : ""}
      ${body}
      ${v.text ? `<p class="visually-hidden">${esc(v.text)}</p>` : ""}
    </figure>`;

  // ---------- zones: a labeled surface (rink, field, strip) ----------
  function zones(v) {
    // Layout rules that keep labels apart whatever positions the AI chose: region names along the top
    // edge, mark labels under or over their dot (alternating when two are close), line names in two
    // staggered rows under the surface, and arrow labels in their own rows under those.
    // Region names sit in a row above the surface, so a rink's rounded corners never cut them off.
    const W = 340, left = 12, right = W - 12, top = (v.direction ? 34 : 14) + (v.regions.length ? 30 : 0), bottom = top + (v.frame === "strip" && !v.marks.length ? 70 : 118);
    const x = (at) => left + (at / 100) * (right - left);
    const clip = id("clip"), arrowId = id("arr");
    const rx = v.frame === "rink" ? 44 : v.frame === "field" ? 8 : 4;
    const regions = v.regions.map((r, i) => {
      const w = x(r.to) - x(r.from), lines = wrap(r.label, Math.max(6, Math.floor(w / 6.4)));
      return `<rect x="${x(r.from)}" y="${top}" width="${w}" height="${bottom - top}" class="${i % 2 ? "v-region-b" : "v-region-a"}"/>
        <text x="${(x(r.from) + x(r.to)) / 2}" y="${top - (Math.min(2, lines.length) === 2 ? 18 : 6)}" class="v-rlabel" text-anchor="middle">${tspans(lines.slice(0, 2), (x(r.from) + x(r.to)) / 2, 12)}</text>`;
    }).join("");
    const lineRow0 = bottom + 15;
    const lines = v.lines.map((l, i) => {
      const lx = x(l.at), ty = lineRow0 + (i % 2) * 14;
      const anchor = l.at < 12 ? "start" : l.at > 88 ? "end" : "middle";
      return `<line x1="${lx}" x2="${lx}" y1="${top}" y2="${bottom}" class="v-line ${l.style === "dashed" ? "dashed" : ""}"/>
        <line x1="${lx}" x2="${lx}" y1="${bottom}" y2="${ty - 10}" class="v-leader"/>
        <text x="${lx}" y="${ty}" class="v-llabel" text-anchor="${anchor}">${esc(l.label)}</text>`;
    }).join("");
    const laneY = { top: top + 40, middle: (top + bottom) / 2 + 8, bottom: bottom - 24 };
    const pos = new Map(v.marks.map((m) => [m.id, { x: x(Math.min(97, Math.max(3, m.at))), y: laneY[m.lane] || laneY.middle }]));
    // labels: below the dot unless a neighbour in the same lane is within 110px, then alternate above
    const byX = [...v.marks].sort((a, b) => a.at - b.at), above = new Set();
    byX.forEach((m, i) => {
      const prev = byX[i - 1]; if (!prev) return;
      const a = pos.get(prev.id), b = pos.get(m.id);
      if (b.x - a.x >= 110) return;
      if (a.y === b.y) { if (!above.has(prev.id)) above.add(m.id); }
      else above.add(a.y < b.y ? prev.id : m.id); // different rows: the upper label goes over its dot
    });
    const marks = v.marks.map((m) => {
      const p = pos.get(m.id), anchor = p.x < left + 70 ? "start" : p.x > right - 70 ? "end" : "middle";
      const tx = anchor === "start" ? Math.max(left + 4, p.x - 6) : anchor === "end" ? Math.min(right - 4, p.x + 6) : p.x;
      const shape = m.shape === "puck" ? `<ellipse cx="${p.x}" cy="${p.y}" rx="8" ry="4.5" class="v-puck"/>`
        : m.shape === "player" ? `<circle cx="${p.x}" cy="${p.y}" r="9" class="v-player"/><circle cx="${p.x}" cy="${p.y}" r="3" class="v-player-dot"/>`
        : `<circle cx="${p.x}" cy="${p.y}" r="6" class="v-mark"/>`;
      return `${shape}<text x="${tx}" y="${above.has(m.id) ? p.y - 11 : p.y + 19}" class="v-mlabel" text-anchor="${anchor}">${esc(m.label)}</text>`;
    }).join("");
    const arrowRow0 = lineRow0 + (v.lines.length > 1 ? 28 : v.lines.length ? 14 : 0) + 6;
    const arrows = v.arrows.map((a, i) => {
      const p = pos.get(a.from), q = pos.get(a.to), dir = Math.sign(q.x - p.x) || 1;
      const x1 = p.x + 8 * dir, x2 = q.x - 9 * dir, lift = Math.abs(q.y - p.y) < 4 ? 22 : 0;
      const mx = (x1 + x2) / 2, my = Math.min(p.y, q.y) - lift;
      return `<path d="M${x1},${p.y} Q${mx},${my - lift * 0.4} ${x2},${q.y}" class="v-arrow" marker-end="url(#${arrowId})"/>
        ${a.label ? `<text x="${left}" y="${arrowRow0 + i * 14}" class="v-alabel"><tspan class="v-arrowkey">→</tspan> ${esc(a.label)}</text>` : ""}`;
    }).join("");
    const H = arrowRow0 + v.arrows.filter((a) => a.label).length * 14 + 6;
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(v.alt)}" class="v-svg">
      <defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="${rx}"/></clipPath>
        <marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="v-arrowhead"/></marker></defs>
      ${v.direction ? `<text x="${left}" y="16" class="v-dir">${esc(v.direction)} →</text>` : ""}
      <g clip-path="url(#${clip})">${regions.replace(/<text[\s\S]*?<\/text>/g, "")}</g>${(regions.match(/<text[\s\S]*?<\/text>/g) || []).join("")}
      <rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="${rx}" class="v-frame"/>
      ${lines}${arrows}${marks}
    </svg>`;
    return figure(v, svg, { note: v.simplified ? "Simplified illustration" : "" });
  }

  // ---------- layered graphs: decision trees, concept maps, hierarchies ----------
  function layered(v, { decision = false } = {}) {
    const W = 340, gapY = 46, byDepth = [];
    for (const n of v.nodes) (byDepth[n.depth] ||= []).push(n);
    const parentOf = new Map(v.edges.map((e) => [e.to, e.from]));
    const place = new Map();
    let y = 8;
    for (const [d, layer] of byDepth.entries()) {
      if (!layer) continue;
      if (d) layer.sort((a, b) => (place.get(parentOf.get(a.id))?.cx ?? 0) - (place.get(parentOf.get(b.id))?.cx ?? 0));
      const n = layer.length, w = Math.min(160, (W - 8 - (n - 1) * 8) / n);
      const chars = Math.max(8, Math.floor((w - 14) / 6.3));
      let h = 0;
      layer.forEach((node, i) => {
        const lines = wrap(node.label, chars).slice(0, 4);
        const nh = 14 + lines.length * 14;
        h = Math.max(h, nh);
        place.set(node.id, { x: 4 + i * (w + 8), w, lines, cx: 4 + i * (w + 8) + w / 2 });
      });
      layer.forEach((node) => Object.assign(place.get(node.id), { y, h }));
      y += h + gapY;
    }
    const H = y - gapY + 8, arrowId = id("arr");
    const edges = v.edges.map((e) => {
      const a = place.get(e.from), b = place.get(e.to);
      const x1 = a.cx, y1 = a.y + a.h, x2 = b.cx, y2 = b.y - 3, my = (y1 + y2) / 2;
      const lw = e.label ? Math.min(150, e.label.length * 6.2 + 10) : 0, lx = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" class="v-edge" marker-end="url(#${arrowId})"/>
        ${e.label ? `<rect x="${lx - lw / 2}" y="${my - 9}" width="${lw}" height="17" rx="8" class="v-elabel-bg"/><text x="${lx}" y="${my + 3.5}" class="v-elabel" text-anchor="middle">${esc(e.label)}</text>` : ""}`;
    }).join("");
    const nodes = v.nodes.map((n) => {
      const p = place.get(n.id), cls = decision ? (n.kind === "question" ? "v-node v-q" : "v-node v-out") : n.depth === 0 && v.type === "tree" ? "v-node v-q" : "v-node";
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${decision && n.kind === "question" ? 10 : 6}" class="${cls}"/>
        <text x="${p.cx}" y="${p.y + 19}" class="v-ntext" text-anchor="middle">${tspans(p.lines, p.cx, 14)}</text>`;
    }).join("");
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(v.alt)}" class="v-svg">
      <defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="v-arrowhead"/></marker></defs>
      ${edges}${nodes}</svg>`;
    return figure(v, svg, { note: decision ? "Each branch is a different case" : "" });
  }

  // ---------- process: ordered steps, one highlighted at a time ----------
  function processV(v) {
    return figure(v, `<ol class="v-flow">${v.steps.map((s, i) => `<li><span class="v-stepn" aria-hidden="true">${i + 1}</span><span><b>${esc(s.label)}</b>${s.detail ? `<span class="v-stepd">${esc(s.detail)}</span>` : ""}</span></li>`).join("")}</ol>`);
  }

  function causeEffect(v) {
    return figure(v, `<div class="v-ce">${v.links.map((l) => `<div class="v-ce-row"><span class="v-box">${esc(l.cause)}</span><span class="v-rel"><span>${esc(l.relation)}</span><svg viewBox="0 0 40 12" aria-hidden="true"><path d="M0,6 H32 M28,1 L36,6 L28,11" class="v-relarrow"/></svg></span><span class="v-box v-box-effect">${esc(l.effect)}</span></div>`).join("")}</div>`);
  }

  function comparison(v) {
    const ex = v.mode === "example_vs_counterexample";
    const side = (s, kind) => `<div class="v-cmp-side ${kind}"><p class="v-cmp-h">${ex ? `<span class="v-cmp-mark" aria-hidden="true">${kind === "yes" ? "✓" : "✗"}</span>` : ""}${esc(s.title)}${ex ? `<span class="visually-hidden">${kind === "yes" ? " (example)" : " (counterexample)"}</span>` : ""}</p><ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
    return figure(v, `<div class="v-cmp">${side(v.left, ex ? "yes" : "a")}${side(v.right, ex ? "no" : "b")}</div>`, { note: ex ? "Example and counterexample" : "" });
  }

  // ---------- calculation: values computed by Lost, revealed one step at a time ----------
  function calculation(v) {
    const cid = id("calc"), vals = Object.fromEntries(v.inputs.map((i) => [i.name, i.value]));
    const sub = (expr) => esc(expr).replace(/[A-Za-z_][A-Za-z0-9_]*/g, (n) => (Object.hasOwn(vals, n) ? `<span class="v-sub" title="${esc(n)}">${esc(num(vals[n]))}</span>` : n));
    const rows = v.steps.map((s, i) => { const html = `<li${i ? " hidden" : ""}><span class="v-calc-l">${esc(s.label)}</span><span class="v-calc-e"><code>${sub(s.expr)}</code> = <b class="v-calc-v">${esc(num(s.value))}</b></span></li>`; vals[s.name] = s.value; return html; }).join("");
    return figure(v, `<dl class="v-inputs">${v.inputs.map((i) => `<div><dt>${esc(i.label)}</dt><dd>${esc(num(i.value))}${i.unit ? ` ${esc(i.unit)}` : ""}</dd></div>`).join("")}</dl>
      <ol class="v-calc" id="${cid}">${rows}</ol>
      ${v.steps.length > 1 ? `<div class="v-ctl"><button type="button" data-act="calc" data-for="${cid}">Next step</button><button type="button" class="quiet" data-act="calc-all" data-for="${cid}">Show all</button></div>` : ""}
      ${sequence(v)}
      <p class="v-result">Result: <b>${esc(num(v.result))}${v.result_unit ? ` ${esc(v.result_unit)}` : ""}</b> <span class="v-note">calculated by Lost</span></p>
      ${v.mismatch ? `<p class="v-warn">The AI's own answer (${esc(num(v.stated))}) didn't match this calculation, so the calculated value is shown.</p>` : ""}`);
  }

  // A short bar sequence under a calculation whose steps are a changing amount (a balance year by year).
  // Heights come from the values Lost computed, never from the AI.
  function sequence(v) {
    const vals = v.steps.map((s) => s.value);
    if (vals.length < 3 || !vals.every((x) => Number.isFinite(x) && x > 0)) return "";
    const max = Math.max(...vals), W = 300, H = 96, bw = Math.min(46, (W - 10) / vals.length - 8);
    const bars = vals.map((x, i) => { const h = Math.max(3, (x / max) * (H - 30)), bx = 6 + i * (bw + 8);
      return `<rect x="${bx}" y="${H - 16 - h}" width="${bw}" height="${h}" rx="3" class="v-bar"/><text x="${bx + bw / 2}" y="${H - 20 - h}" class="v-tick" text-anchor="middle">${esc(num(x))}</text><text x="${bx + bw / 2}" y="${H - 3}" class="v-tick" text-anchor="middle">${i + 1}</text>`; }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="v-svg v-seq" role="img" aria-label="Bars for each step: ${esc(vals.map(num).join(", "))}">${bars}</svg>`;
  }

  // ---------- market: schematic supply and demand with one shift ----------
  function market(v) {
    const W = 320, H = 250, x0 = 46, x1 = 304, y0 = 14, y1 = 206;
    const X = (q) => x0 + (q / 10) * (x1 - x0), Y = (p) => y1 - (p / 10) * (y1 - y0);
    const seg = (a, b) => { // P = a + bQ inside the 0-10 box
      let lo = 0, hi = 10;
      const qAt = (p) => (p - a) / b;
      if (b > 0) { lo = Math.max(lo, qAt(0)); hi = Math.min(hi, qAt(10)); } else { lo = Math.max(lo, qAt(10)); hi = Math.min(hi, qAt(0)); }
      return `M${X(lo)},${Y(a + b * lo)} L${X(hi)},${Y(a + b * hi)}`;
    };
    const arrowId = id("arr"), d = v.curve === "demand" ? 2 * v.dir : 0, s = v.curve === "supply" ? 2 * v.dir : 0;
    const curves = [`<path d="${seg(8, -1)}" class="v-curve v-demand"/>`, `<path d="${seg(2, 1)}" class="v-curve v-supply"/>`];
    if (v.curve === "demand") curves.push(`<path d="${seg(8 + d, -1)}" class="v-curve v-demand v-shifted"/>`);
    if (v.curve === "supply") curves.push(`<path d="${seg(2 - s, 1)}" class="v-curve v-supply v-shifted"/>`);
    const eqp = (e, i) => `<line x1="${X(e.q)}" x2="${X(e.q)}" y1="${Y(e.p)}" y2="${y1}" class="v-guide"/><line x1="${x0}" x2="${X(e.q)}" y1="${Y(e.p)}" y2="${Y(e.p)}" class="v-guide"/>
      <circle cx="${X(e.q)}" cy="${Y(e.p)}" r="4.5" class="v-eq ${i ? "v-eq2" : ""}"/><text x="${X(e.q) + 7}" y="${Y(e.p) - 6}" class="v-elabel2">E${i + 1}</text>
      <text x="${X(e.q)}" y="${y1 + 13}" class="v-tick" text-anchor="middle">Q${i + 1}</text><text x="${x0 - 5}" y="${Y(e.p) + 4}" class="v-tick" text-anchor="end">P${i + 1}</text>`;
    // short labels on the curves; full names go in the legend under the chart
    const tag = (txt, q, p, cls, dy) => `<text x="${X(q)}" y="${Y(p) + dy}" class="v-clabel ${cls}" text-anchor="middle">${esc(txt)}</text>`;
    const labels = [tag("D", 7.2, 0.8, "v-demand", 14), tag("S", 7.2, 9.2, "v-supply", -6)];
    if (v.curve === "demand") labels.push(tag("D2", Math.min(9.4, 7.2 + d), 0.8 + Math.max(0, 7.2 + d - 9.4), "v-demand", 14));
    if (v.curve === "supply") labels.push(tag("S2", Math.max(0.6, Math.min(9.4, 7.2 - s)), 9.2, "v-supply", -6));
    const legend = `<ul class="v-legendlist"><li><span class="v-sw v-sw-s" aria-hidden="true"></span>S: ${esc(v.supply_label)}</li><li><span class="v-sw v-sw-d" aria-hidden="true"></span>D: ${esc(v.demand_label)}</li>${v.curve ? `<li><span class="v-sw v-sw-${v.curve === "demand" ? "d" : "s"} dashed" aria-hidden="true"></span>${v.curve === "demand" ? "D2" : "S2"}: after the shift</li>` : ""}</ul>`;
    let shiftArrow = "";
    if (v.after) {
      const p = v.curve === "demand" ? 6.5 : 7.5, qa = v.curve === "demand" ? 8 - p : p - 2, qb = qa + 2 * v.dir;
      shiftArrow = `<path d="M${X(qa) + 5 * v.dir},${Y(p)} L${X(qb) - 7 * v.dir},${Y(p)}" class="v-shift" marker-end="url(#${arrowId})"/>`;
    }
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(v.alt)}" class="v-svg">
      <defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="v-arrowhead"/></marker></defs>
      <line x1="${x0}" x2="${x0}" y1="${y0}" y2="${y1}" class="v-axis"/><line x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" class="v-axis"/>
      <text x="${(x0 + x1) / 2}" y="${H - 8}" class="v-axlabel" text-anchor="middle">${esc(v.x_label)} →</text>
      <text transform="translate(17 ${(y0 + y1) / 2}) rotate(-90)" class="v-axlabel" text-anchor="middle">${esc(v.y_label)} →</text>
      ${curves.join("")}${eqp(v.before, 0)}${v.after ? eqp(v.after, 1) : ""}${shiftArrow}${labels.join("")}
    </svg>`;
    const word = (w) => (w === "up" ? "rises" : w === "down" ? "falls" : "stays the same");
    const effect = v.effect ? `<p class="v-effect"><span><span class="v-dirmark" aria-hidden="true">${v.effect.price === "up" ? "▲" : v.effect.price === "down" ? "▼" : "■"}</span> ${esc(v.y_label)} ${word(v.effect.price)}</span><span><span class="v-dirmark" aria-hidden="true">${v.effect.quantity === "up" ? "▲" : v.effect.quantity === "down" ? "▼" : "■"}</span> ${esc(v.x_label)} ${word(v.effect.quantity)}</span></p>` : "";
    return figure(v, `${svg}${legend}${v.cause ? `<p class="v-cause">${esc(v.cause)}</p>` : ""}${effect}`, { note: "Schematic, not to scale" });
  }

  // ---------- bit grid: sent vs received, with the failing row and column ----------
  function bitGrid(v) {
    const gid = id("grid");
    const table = (grid, received) => {
      const failRow = received ? v.failRow : null, failCol = received ? v.failCol : null;
      const head = `<tr><th scope="col"><span class="visually-hidden">Row</span></th>${grid[0].map((_, c) => `<th scope="col">c${c + 1}</th>`).join("")}<th scope="col" class="v-par">parity</th></tr>`;
      const body = grid.map((r, i) => `<tr><th scope="row">r${i + 1}</th>${r.map((b, c) => {
        const flipped = received && v.flip && v.flip.row === i && v.flip.col === c;
        return `<td class="${flipped ? "v-flip" : ""}">${b}${flipped ? `<span class="visually-hidden"> (flipped)</span>` : ""}</td>`;
      }).join("")}<td class="v-par ${received && v.flip ? (i === failRow ? "v-fail" : "v-ok") : ""}">${v.rowPar[i]}${received && v.flip ? `<span class="v-pmark">${i === failRow ? " ✗" : " ✓"}</span>` : ""}</td></tr>`).join("");
      const foot = `<tr><th scope="row" class="v-par">parity</th>${v.colPar.map((p, c) => `<td class="v-par ${received && v.flip ? (c === failCol ? "v-fail" : "v-ok") : ""}">${p}${received && v.flip ? `<span class="v-pmark">${c === failCol ? " ✗" : " ✓"}</span>` : ""}</td>`).join("")}<td class="v-par">${v.corner}</td></tr>`;
      return `<table class="v-grid"><caption class="visually-hidden">${received ? "Bits as received" : "Bits as sent"}</caption>${head}${body}${foot}</table>`;
    };
    const legend = v.flip ? `<p class="v-legend"><span class="v-flip-key">1</span> the flipped bit · <span class="v-fail-key">✗</span> parity check fails: row ${v.failRow + 1} and column ${v.failCol + 1} cross at the flipped bit</p>` : `<p class="v-legend">Each parity bit makes its row or column have an even number of 1s.</p>`;
    return figure(v, `${v.flip ? `<div class="v-tabs" role="group" aria-label="Which grid to show"><button type="button" data-act="grid" data-for="${gid}" data-show="sent" aria-pressed="false">As sent</button><button type="button" data-act="grid" data-for="${gid}" data-show="received" aria-pressed="true">As received</button></div>` : ""}
      <div id="${gid}"><div data-view="sent"${v.flip ? " hidden" : ""}>${table(v.sent, false)}</div>${v.flip ? `<div data-view="received">${table(v.received, true)}</div>` : ""}</div>${legend}`);
  }

  function analogy(v) {
    return figure(v, `<p class="v-analogy">${esc(v.analogy)}</p>
      <table class="v-pairs"><thead><tr><th scope="col">In class</th><th scope="col">In the analogy</th></tr></thead><tbody>${v.pairs.map((p) => `<tr><td>${esc(p.concept)}</td><td>${esc(p.analogy)}</td></tr>`).join("")}</tbody></table>
      ${v.breaks_down ? `<p class="v-breaks"><b>Where it breaks down:</b> ${esc(v.breaks_down)}</p>` : ""}`, { note: "An analogy, not the real thing" });
  }

  // Place values: the digits under their places, the ones that count lit, the sum computed by Lost.
  function placeValue(v) {
    const cells = v.places.map((p) => `<td class="${p.value ? "pv-on" : ""}">${esc(p.digit)}</td>`).join("");
    return figure(v, `<table class="pv"><caption class="visually-hidden">${esc(v.digits)} in base ${v.base}</caption>
      <tr class="pv-w">${v.places.map((p) => `<th scope="col">${esc(num(p.weight))}</th>`).join("")}</tr><tr class="pv-d">${cells}</tr></table>
      <p class="pv-sum">${v.places.filter((p) => p.value).map((p) => `<span>${p.value > 1 ? `${esc(p.digit)}×` : ""}${esc(num(p.weight))}</span>`).join(" + ") || "0"} = <b>${esc(num(v.total))}</b> <span class="v-note">calculated by Lost</span></p>`);
  }

  const RENDER = { place_value: placeValue, zones, decision: (v) => layered(v, { decision: true }), concept_map: (v) => layered(v), tree: (v) => layered(v), process: processV, cause_effect: causeEffect, comparison, calculation, market, bit_grid: bitGrid, analogy };
  L.visual = (v) => {
    if (!v || !RENDER[v.type]) return "";
    try { return RENDER[v.type](v); }
    catch { return v.text ? `<p class="v-fallback">${esc(v.text)}</p>` : ""; }
  };

  // ---------- citations ----------
  const chipLabel = (s) => (s.type === "line" ? fmt(s.t) : /^page \d+/i.test(s.location || "") ? `p. ${String(s.location).match(/\d+/)[0]}` : "notes");
  const sourceItem = (s) => `<li${s.flags?.length ? ' class="flagged"' : ""}>${s.type === "line"
    ? `<span class="src-kind">Lecture ${fmt(s.t)}</span> <q>${esc(s.text)}</q>`
    : `<span class="src-kind">${esc(s.source === "demo" ? "Course material (demo)" : "Course material")}</span> ${L.safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}${s.location && s.location !== s.title ? `, ${esc(s.location)}` : ""}${s.text ? `<q class="src-text">${esc(s.text.slice(0, 260))}${s.text.length > 260 ? "…" : ""}</q>` : ""}`}
    ${(s.flags || []).map((f) => `<span class="src-flag">${esc(f)}</span>`).join("")}</li>`;
  // A claim: its text, compact source chips, any warning about those sources, and a hidden pop-out with the quotes.
  const claim = (c, cls = "") => (c?.text ? `<div class="claim ${cls}"><p>${esc(c.text)}</p></div>` : "");
  L.claim = claim;

  // Turns an old (version 1) help card into the new shape so earlier classes still display.
  const upgrade = (p) => (p.v === 2 ? p : {
    v: 2, title: p.topic || "", takeaway: { text: p.explanation?.text || "", sources: p.context?.sources || [] },
    example: p.explanation?.example?.text ? { ...p.explanation.example, why: "" } : null, terms: p.explanation?.terms || [],
    connection: p.context?.text ? { text: p.context.text, sources: [] } : null, qualifications: [], provenance: [], enough: p.enough, clarify: p.clarify,
  });
  const exampleLabel = (ex) => ex.origin === "lecture" ? `Your professor's example${ex.source ? ` (${fmt(ex.source.t)})` : ""}` : ex.origin === "materials" ? "From the course notes" : "Example (made up by the AI)";

  // The lesson card. Up front: the question (as the panel title), a hook, the idea in one line, one
  // picture, an example, and where it fits in class. "Explain more" holds the rest; "Sources" opens on demand.
  // ---------- AI illustration: drawn only when the student asks, then kept for this page ----------
  const illos = new Map(); // help id -> { url, caption, alt }
  const illoFigure = (d) => `<figure class="illo-fig"><img src="${esc(d.url)}" alt="${esc(d.alt)}" width="512" height="512" decoding="async">
      <figcaption><span class="illo-tag">AI illustration</span> ${esc(d.caption)}</figcaption></figure>`;
  function illustration(p, helpId) {
    if (!p.illustration || !helpId || !L.illustrations) return "";
    const done = illos.get(helpId);
    return `<div class="illo" data-illo-box="${esc(helpId)}">${done ? illoFigure(done)
      : `<button type="button" class="illo-btn" data-illo="${esc(helpId)}">Show illustration</button>`}</div>`;
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-illo]"); if (!b || b.disabled) return;
    const id = b.dataset.illo, box = b.closest(".illo");
    b.disabled = true; b.textContent = "Drawing…"; box.querySelector(".illo-err")?.remove();
    b.insertAdjacentHTML("afterend", `<div class="illo-skel" aria-hidden="true"></div>`);
    try {
      const d = await L.api(`/api/help/${encodeURIComponent(id)}/illustration`, { method: "POST", body: {} });
      illos.set(id, d);
      box.innerHTML = illoFigure(d);
    } catch (err) {
      box.querySelector(".illo-skel")?.remove();
      b.disabled = false; b.textContent = "Try the illustration again";
      box.insertAdjacentHTML("beforeend", `<p class="illo-err" role="status">${esc(err.message || "No illustration this time.")}</p>`);
    }
  });

  L.lesson = (raw, { kicker = "", headingLevel = 3, showTitle = true, helpId = "" } = {}) => {
    const p = upgrade(raw), h = `h${headingLevel}`;
    const all = [p.takeaway, p.explanation, p.connection, ...(p.qualifications || []), ...(p.rule ? [p.rule.what_happened, p.rule.what_next, ...p.rule.when_differs] : [])].filter(Boolean).flatMap((c) => c.sources || []);
    const seen = new Set(), sources = all.filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
    const shaky = sources.filter((s) => s.flags?.length).length;
    const more = [
      claim(p.explanation, "lesson-body"),
      p.terms?.length ? `<dl class="lesson-terms">${p.terms.map((t) => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.definition)}</dd></div>`).join("")}</dl>` : "",
      p.qualifications?.length ? `<div class="lesson-quals"><p class="lesson-label">Keep in mind</p>${p.qualifications.map((c) => claim(c)).join("")}</div>` : "",
    ].filter(Boolean).join("");
    const notes = (p.provenance || []).map((n) => `<p class="src-note">${esc(n)}</p>`).join("");
    return `<article class="lesson">
      ${kicker ? `<p class="lesson-kicker">${esc(kicker)}</p>` : ""}
      ${showTitle && p.title ? `<${h} class="lesson-title">${esc(p.title)}</${h}>` : ""}
      ${!p.enough && p.clarify ? `<p class="clarify">${esc(p.clarify)}</p>` : ""}
      ${p.hook ? `<p class="lesson-hook">${esc(p.hook)}</p>` : ""}
      ${claim(p.takeaway, p.hook ? "lesson-takeaway small" : "lesson-takeaway")}
      ${p.uncertainty ? `<p class="lesson-flag" role="note"><span class="unsure-mark" aria-hidden="true">!</span> ${esc(p.uncertainty)}</p>` : ""}
      ${p.visual ? L.visual(p.visual) : ""}
      ${p.rule ? `<div class="rule-flow" role="group" aria-label="The rule, with its exceptions as branches">
          <p class="rf-row"><span class="rf-k">If</span><span>${esc(p.rule.what_happened.text)}</span></p>
          <p class="rf-row"><span class="rf-k">Then</span><span>${esc(p.rule.what_next.text)}</span></p>
          ${p.rule.when_differs.map((c) => `<p class="rf-row rf-alt"><span class="rf-k">Unless</span><span>${esc(c.text)}</span></p>`).join("")}
        </div>` : ""}
      ${p.example ? `<div class="lesson-example"><p class="lesson-label">${exampleLabel(p.example)}</p><p>${esc(p.example.text)}</p></div>` : ""}
      ${illustration(p, helpId)}
      ${p.connection?.text ? `<p class="lesson-connect-line"><span class="lesson-label">In class</span> ${esc(p.connection.text)}</p>` : ""}
      <div class="lesson-foot">
        ${more ? `<details class="lesson-more"><summary>Explain more</summary><div class="lesson-more-body">${more}</div></details>` : ""}
        <details class="lesson-src"><summary>Sources${sources.length ? ` (${sources.length})` : ""}${shaky ? ` · ${shaky} unclear` : ""}</summary><div class="lesson-more-body">
          ${notes}${sources.length ? `<ul class="src-list">${sources.map(sourceItem).join("")}</ul>` : `<p class="note">Nothing in the lecture or notes backed this up, so treat it as background.</p>`}</div></details>
      </div>
    </article>`;
  };

  // The after-class summary (version 2): overview, concept map, then topics to open one at a time.
  L.summaryV2 = (s, { headingLevel = 3 } = {}) => {
    const h = `h${headingLevel}`;
    return `<div class="sum2">
      ${s.overview ? claim(s.overview, "sum-overview") : ""}
      ${s.map ? L.visual({ ...s.map, title: "How today's ideas connect" }) : ""}
      
      <${h} class="sum-topics-h">Topics</${h}>
      ${s.topics.map((t, i) => `<details class="sum-topic"${i === 0 ? " open" : ""}><summary><span class="sum-t">${esc(t.title)}</span><span class="sum-k">${esc(t.key_idea?.text || "")}</span></summary>
        ${L.lesson({ v: 2, title: t.title, takeaway: t.key_idea, explanation: t.explanation, visual: t.visual, example: t.example, qualifications: t.qualifications, enough: true }, { showTitle: false, headingLevel: headingLevel + 1 })}
      </details>`).join("")}
      ${s.concepts?.length ? `<details class="sum-terms"><summary>Terms (${s.concepts.length})</summary><dl class="lesson-terms">${s.concepts.map((c) => `<div><dt>${esc(c.term)}</dt><dd>${esc(c.definition)}</dd></div>`).join("")}</dl></details>` : ""}
      ${s.uncertain?.length ? `<details class="sum-terms"><summary>Unclear in the recording (${s.uncertain.length})</summary>${s.uncertain.map((c) => claim(c)).join("")}</details>` : ""}
      ${s.deadlines?.length ? `<div class="sum-deadlines"><p class="lesson-label">Due dates</p>${s.deadlines.map((d) => claim(d)).join("")}</div>` : ""}
    </div>`;
  };

  // ---------- interactions (one listener for the whole page) ----------
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const target = document.getElementById(b.dataset.for);
    if (!target) return;
    const act = b.dataset.act;
    if (act === "cite") {
      const open = target.hidden;
      target.hidden = !open;
      b.closest(".claim")?.querySelectorAll('[data-act="cite"]').forEach((x) => x.setAttribute("aria-expanded", String(open)));
    } else if (act === "step") {
      const items = [...target.children], cur = items.findIndex((li) => li.classList.contains("on"));
      const next = Math.max(0, Math.min(items.length - 1, cur + Number(b.dataset.dir)));
      items.forEach((li, i) => { li.classList.toggle("on", i === next); if (i === next) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
      const pos = b.parentElement.querySelector(".v-ctl-pos"); if (pos) pos.textContent = `Step ${next + 1} of ${items.length}`;
    } else if (act === "calc" || act === "calc-all") {
      const hidden = [...target.children].filter((li) => li.hidden);
      (act === "calc-all" ? hidden : hidden.slice(0, 1)).forEach((li) => (li.hidden = false));
      if (hidden.length <= 1 || act === "calc-all") b.parentElement.remove();
    } else if (act === "grid") {
      target.querySelectorAll("[data-view]").forEach((d) => (d.hidden = d.dataset.view !== b.dataset.show));
      b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }
  });
})();
