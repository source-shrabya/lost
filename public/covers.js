// Course covers: decorative SVG compositions, three per subject. They are drawn here from code, so
// they cost nothing, work offline and never call an image service. A course's cover is "subject/variant"
// (lib/theme.js picks it, or the professor does); the course id seeds the small jitter so a cover never
// changes on refresh. Covers are decoration only: no axes, numbers or labels that could read as data.
(function () {
  const L = window.Lost;
  const W = 400, H = 100;
  const rng = (seed) => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489917)) >>> 0) / 4294967296; };
  const n = (x) => Math.round(x * 10) / 10;
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  // c = class: l line, f soft fill, g gold line, gf gold fill, d dashed line
  const circle = (x, y, rad, c = "l") => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(rad)}" class="${c}"/>`;
  const path = (d, c = "l") => `<path d="${d}" class="${c}"/>`;
  const line = (x1, y1, x2, y2, c = "l") => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="${c}"/>`;
  const rect = (x, y, w, h, c = "l", rx = 0, rot = 0) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}" class="${c}"${rot ? ` transform="rotate(${n(rot)} ${n(x + w / 2)} ${n(y + h / 2)})"` : ""}/>`;
  // Non-overlapping circles by trial (cells, atoms, people).
  function scatter(r, count, minR, maxR, pad = 4) {
    const out = [];
    for (let t = 0; t < 600 && out.length < count; t++) {
      const rad = minR + r() * (maxR - minR), x = rad + r() * (W - 2 * rad), y = rad * 0.6 + r() * (H - rad * 1.2);
      if (out.every((o) => Math.hypot(o.x - x, o.y - y) > o.rad + rad + pad)) out.push({ x, y, rad });
    }
    return out;
  }

  const S = {
    biology: [
      (r) => { // cells
        const cells = scatter(r, 16, 9, 26, 3), gold = Math.floor(r() * cells.length);
        return cells.map((c, i) => circle(c.x, c.y, c.rad, "f") + circle(c.x + (r() - 0.5) * c.rad * 0.5, c.y + (r() - 0.5) * c.rad * 0.5, c.rad * 0.3, i === gold ? "gf" : "l")).join("");
      },
      (r) => { // branching
        const out = [];
        const branch = (x, y, a, len, d, gold) => {
          const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
          out.push(path(`M${n(x)} ${n(y)} Q${n((x + x2) / 2 + Math.sin(a) * 4)} ${n((y + y2) / 2)} ${n(x2)} ${n(y2)}`, gold ? "g" : "l"));
          if (d === 0) { out.push(circle(x2, y2, 2.4, gold ? "gf" : "f")); return; }
          branch(x2, y2, a - 0.35 - r() * 0.3, len * 0.72, d - 1, gold);
          branch(x2, y2, a + 0.35 + r() * 0.3, len * 0.72, d - 1, gold && r() < 0.5);
        };
        const roots = 4, g = Math.floor(r() * roots);
        for (let i = 0; i < roots; i++) branch(30 + i * 100 + r() * 30, H + 4, -Math.PI / 2 + (r() - 0.5) * 0.5, 26 + r() * 8, 4, i === g);
        return out.join("");
      },
      (r) => { // leaf venation
        const leaf = (cx, cy, len, wid, tilt, gold) => {
          const x0 = cx - len / 2, x1 = cx + len / 2, veins = [];
          for (let i = 1; i < 7; i++) { const x = x0 + (len * i) / 7, s = Math.sin((Math.PI * i) / 7) * wid * 0.85; veins.push(path(`M${n(x)} ${n(cy)} Q${n(x + 8)} ${n(cy - s * 0.6)} ${n(x + 14)} ${n(cy - s)}`), path(`M${n(x)} ${n(cy)} Q${n(x + 8)} ${n(cy + s * 0.6)} ${n(x + 14)} ${n(cy + s)}`)); }
          return `<g transform="rotate(${n(tilt)} ${n(cx)} ${n(cy)})">${path(`M${n(x0)} ${n(cy)} Q${n(cx)} ${n(cy - wid * 1.6)} ${n(x1)} ${n(cy)} Q${n(cx)} ${n(cy + wid * 1.6)} ${n(x0)} ${n(cy)}Z`, "f")}${line(x0 - 10, cy, x1, cy, gold ? "g" : "l")}${veins.join("")}</g>`;
        };
        return leaf(120 + r() * 30, 52, 190, 30, -8 + r() * 6, true) + leaf(310 + r() * 20, 44, 120, 20, 14 + r() * 8, false);
      },
    ],
    computing: [
      (r) => { // circuit traces and a chip
        const out = [], cx = 250 + r() * 60, cy = 50;
        out.push(rect(cx - 26, cy - 22, 52, 44, "f", 4), rect(cx - 14, cy - 10, 28, 20, "l", 2));
        for (let i = 0; i < 5; i++) { const y = cy - 16 + i * 8; out.push(line(cx - 26, y, cx - 32, y), line(cx + 26, y, cx + 32, y)); }
        const g = Math.floor(r() * 9);
        for (let i = 0; i < 9; i++) {
          const y0 = 8 + i * 10.5, x0 = 6 + r() * 30, x1 = 70 + r() * 90, y1 = Math.max(6, Math.min(94, y0 + (r() - 0.5) * 30)), x2 = Math.min(cx - 34, x1 + 30 + r() * 60);
          out.push(path(`M${n(x0)} ${n(y0)} H${n(x1)} L${n(x1 + Math.abs(y1 - y0) * 0.6)} ${n(y1)} H${n(x2)}`, i === g ? "g" : "l"), circle(x0, y0, 2.6, i === g ? "gf" : "f"), circle(x2, y1, 2.6, "f"));
        }
        for (let i = 0; i < 4; i++) { const y = 14 + i * 22; out.push(path(`M${n(cx + 32)} ${n(cy - 16 + i * 8)} H${n(cx + 50 + i * 8)} V${n(y)} H${W}`)); }
        return out.join("");
      },
      (r) => { // network graph with one gold route
        const cols = 9, rows = 3, pts = [];
        for (let c = 0; c < cols; c++) for (let k = 0; k < rows; k++) pts.push({ c, k, x: 24 + c * 44 + (r() - 0.5) * 18, y: 20 + k * 30 + (r() - 0.5) * 14 });
        const at = (c, k) => pts[c * rows + k], out = [];
        for (const p of pts) { if (p.c < cols - 1) out.push(line(p.x, p.y, at(p.c + 1, p.k).x, at(p.c + 1, p.k).y)); if (p.k < rows - 1 && r() < 0.6) out.push(line(p.x, p.y, at(p.c, p.k + 1).x, at(p.c, p.k + 1).y)); if (p.c < cols - 1 && p.k < rows - 1 && r() < 0.35) out.push(line(p.x, p.y, at(p.c + 1, p.k + 1).x, at(p.c + 1, p.k + 1).y)); }
        let k = Math.floor(r() * rows); const route = [];
        for (let c = 0; c < cols; c++) { route.push(at(c, k)); if (r() < 0.4) k = Math.max(0, Math.min(rows - 1, k + (r() < 0.5 ? -1 : 1))); }
        out.push(path("M" + route.map((p) => `${n(p.x)} ${n(p.y)}`).join(" L"), "g"));
        for (const p of pts) out.push(circle(p.x, p.y, route.includes(p) ? 4 : 3, route.includes(p) ? "gf" : "f"));
        return out.join("");
      },
      (r) => { // stacked layers
        const out = [], x = 40 + r() * 30, dx = 70, dy = 20, w = 150;
        for (let i = 3; i >= 0; i--) { const y = 22 + i * 14; out.push(`<polygon points="${n(x)},${n(y + dy)} ${n(x + dx)},${n(y)} ${n(x + dx + w)},${n(y)} ${n(x + w)},${n(y + dy)}" class="${i === 0 ? "f g" : "f"}"/>`); }
        for (let i = 0; i < 7; i++) { const y = 18 + i * 11; out.push(line(x + dx + w + 14, y, W - 10 - r() * 40, y, "d")); if (r() < 0.6) out.push(rect(x + dx + w + 30 + r() * 120, y - 3, 6, 6, i === 3 ? "gf" : "f", 1)); }
        return out.join("");
      },
    ],
    micro: [
      (r) => { // two sides exchanging
        const left = scatter(() => r() * 0.4, 7, 5, 9, 4), right = scatter(() => 0.6 + r() * 0.4, 7, 5, 9, 4), out = [];
        const m = Math.min(left.length, right.length), g = Math.floor(r() * m);
        for (let i = 0; i < m; i++) { const a = left[i], b = right[i], up = i % 2 ? -1 : 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + up * (24 + r() * 18);
          out.push(path(`M${n(a.x)} ${n(a.y)} Q${n(mx)} ${n(my)} ${n(b.x)} ${n(b.y)}`, i === g ? "g" : "d"), circle((a.x + 2 * mx + b.x) / 4, (a.y + 2 * my + b.y) / 4, 2.2, i === g ? "gf" : "f")); }
        return out.join("") + [...left, ...right].map((c) => circle(c.x, c.y, c.rad, "f")).join("");
      },
      (r) => { // a choice that forks
        const out = [], nodes = [];
        const fork = (x, y, d, chosen) => {
          nodes.push({ x, y, chosen });
          if (d === 0) return;
          const step = 88 + r() * 16, spread = 34 / (4 - d);
          const kids = [-1, 1].map((s) => ({ x: x + step, y: Math.max(10, Math.min(90, y + s * spread)) }));
          const pickK = r() < 0.5 ? 0 : 1;
          kids.forEach((k, i) => { out.push(path(`M${n(x)} ${n(y)} C${n(x + step / 2)} ${n(y)} ${n(x + step / 2)} ${n(k.y)} ${n(k.x)} ${n(k.y)}`, chosen && i === pickK ? "g" : "d")); fork(k.x, k.y, d - 1, chosen && i === pickK); });
        };
        fork(20, 50, 4, true);
        return out.join("") + nodes.map((p) => circle(p.x, p.y, p.chosen ? 4.5 : 3.2, p.chosen ? "gf" : "f")).join("");
      },
      (r) => { // many small agents, paired
        const out = [], g = Math.floor(r() * 10);
        for (let i = 0; i < 10; i++) {
          const x = 24 + i * 38 + (r() - 0.5) * 8, top = i % 2 === 0, y = top ? 30 : 70, peer = { x: x + 19 + (r() - 0.5) * 6, y: top ? 70 : 30 };
          const person = (px, py, c) => circle(px, py - 6, 4.5, c) + path(`M${n(px - 8)} ${n(py + 8)} Q${n(px)} ${n(py - 4)} ${n(px + 8)} ${n(py + 8)}`, c === "gf" ? "g" : "l");
          out.push(line(x, y + (top ? 10 : -12), peer.x, peer.y + (top ? -12 : 10), i === g ? "g" : "d"), person(x, y, i === g ? "gf" : "f"));
          if (i < 9) out.push(person(peer.x, peer.y, i === g ? "gf" : "f"));
        }
        return out.join("");
      },
    ],
    macro: [
      (r) => { // circular flow between two loops
        const out = [], cx1 = 120 + r() * 20, cx2 = 280 - r() * 20, cy = 50, rx = 100, ry = 34;
        out.push(`<ellipse cx="${n(cx1)}" cy="${cy}" rx="${rx}" ry="${ry}" class="l"/>`, `<ellipse cx="${n(cx2)}" cy="${cy}" rx="${rx}" ry="${ry}" class="g"/>`);
        for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + r() * 0.2, gold = i % 2 === 1, cx = gold ? cx2 : cx1;
          const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry, tx = -Math.sin(a), ty = Math.cos(a) * (ry / rx);
          out.push(path(`M${n(x - tx * 6 - ty * 4)} ${n(y - ty * 6 + tx * 4)} L${n(x)} ${n(y)} L${n(x - tx * 6 + ty * 4)} ${n(y - ty * 6 - tx * 4)}`, gold ? "g" : "l")); }
        out.push(circle(cx1 - rx, cy, 5, "f"), circle(cx2 + rx, cy, 5, "gf"), circle((cx1 + cx2) / 2, cy - 30, 4, "f"), circle((cx1 + cx2) / 2, cy + 30, 4, "f"));
        return out.join("");
      },
      (r) => { // broad flows splitting and merging
        const out = [], g = Math.floor(r() * 4);
        for (let i = 0; i < 4; i++) {
          const y0 = 14 + i * 22, y1 = 10 + ((i + 1 + Math.floor(r() * 2)) % 4) * 24, w0 = 8 + r() * 8, w1 = 6 + r() * 10, mx = 120 + r() * 160;
          out.push(path(`M0 ${n(y0)} C${n(mx)} ${n(y0)} ${n(mx)} ${n(y1)} ${W} ${n(y1)} V${n(y1 + w1)} C${n(mx)} ${n(y1 + w1)} ${n(mx)} ${n(y0 + w0)} 0 ${n(y0 + w0)}Z`, i === g ? "f gtint" : "f"));
        }
        return out.join("");
      },
      (r) => { // nested systems
        const out = [], cx = 70 + r() * 40, cy = 50 + (r() - 0.5) * 20, g = 1 + Math.floor(r() * 4);
        for (let i = 1; i <= 6; i++) out.push(circle(cx, cy, i * 28, i === g ? "g" : i % 2 ? "l" : "d"));
        const pts = [];
        for (let i = 1; i <= 6; i++) for (let k = 0; k < 3; k++) { const a = -0.9 + r() * 1.8, x = cx + Math.cos(a) * i * 28, y = cy + Math.sin(a) * i * 28; if (x > 0 && x < W && y > 4 && y < 96) pts.push({ x, y, i }); }
        pts.sort((a, b) => a.i - b.i);
        for (let k = 1; k < pts.length; k++) if (pts[k].i !== pts[k - 1].i && r() < 0.7) out.push(line(pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y));
        return out.join("") + pts.map((p) => circle(p.x, p.y, 3.4, p.i === g ? "gf" : "f")).join("");
      },
    ],
    history: [
      (r) => { // archival layers
        const out = [], g = Math.floor(r() * 5);
        for (let i = 0; i < 5; i++) {
          const x = 12 + i * 76 + r() * 10, y = 10 + r() * 14, w = 92, h = 74, rot = (r() - 0.5) * 10;
          let lines = ""; for (let k = 0; k < 6; k++) lines += line(x + 10, y + 14 + k * 9, x + 10 + (w - 20) * (0.5 + r() * 0.5), y + 14 + k * 9);
          out.push(`<g transform="rotate(${n(rot)} ${n(x + w / 2)} ${n(y + h / 2)})">${rect(x, y, w, h, "f", 2)}${lines}${i === g ? circle(x + w - 16, y + h - 14, 7, "gf") : ""}</g>`);
        }
        return out.join("");
      },
      (r) => { // timeline with eras
        const out = [line(0, 62, W, 62)], marks = [];
        for (let x = 8; x < W; x += 12) { const tall = r() < 0.18; out.push(line(x, 62, x, tall ? 44 : 56)); if (tall) marks.push(x); }
        const a = 60 + r() * 120, b = a + 70 + r() * 90;
        out.push(path(`M${n(a)} 76 V82 H${n(b)} V76`, "g"), rect(a, 64, b - a, 8, "f gtint", 2));
        for (const x of marks) out.push(`<polygon points="${n(x)},${36} ${n(x + 5)},${41} ${n(x)},${46} ${n(x - 5)},${41}" class="${x > a && x < b ? "gf" : "f"}"/>`);
        out.push(line(0, 20, W, 20, "d"));
        return out.join("");
      },
      (r) => { // colonnade
        const out = [], cols = 8 + Math.floor(r() * 3), x0 = 20, span = (W - 40) / cols, base = 88, top = 30, g = Math.floor(r() * (cols - 1));
        out.push(rect(x0 - 10, base, W - 20, 6, "f"), rect(x0 - 4, base - 4, W - 32, 4, "f"));
        for (let i = 0; i <= cols; i++) { const x = x0 + i * span; out.push(rect(x - 4, top, 8, base - 4 - top, "f"), line(x - 6, top, x + 6, top)); }
        for (let i = 0; i < cols; i++) { const x = x0 + i * span + 4, w = span - 8; out.push(path(`M${n(x)} ${top + 12} Q${n(x + w / 2)} ${n(top - 12)} ${n(x + w)} ${top + 12}`, i === g ? "g" : "l")); if (i === g) out.push(rect(x + w / 2 - 3, top - 3, 6, 7, "gf", 1)); }
        out.push(path(`M${x0 - 10} ${top - 6} L${W / 2} ${top - 26} L${W - x0 + 10} ${top - 6}Z`, "l"));
        return out.join("");
      },
    ],
    math: [
      (r) => { // compass construction
        const out = [], d = 70 + r() * 20, ax = 140 + r() * 40, ay = 58, bx = ax + d, rad = d;
        out.push(circle(ax, ay, rad, "l"), circle(bx, ay, rad, "l"), line(ax - rad - 20, ay, bx + rad + 20, ay, "d"));
        const h = Math.sqrt(rad * rad - (d / 2) ** 2), mx = (ax + bx) / 2;
        out.push(line(mx, ay - h - 10, mx, ay + h + 10, "d"), path(`M${n(ax)} ${ay} L${n(mx)} ${n(ay - h)} L${n(bx)} ${ay}Z`, "g"));
        out.push(circle(ax, ay, 3, "f"), circle(bx, ay, 3, "f"), circle(mx, ay - h, 3.6, "gf"), circle(mx, ay + h, 3, "f"));
        out.push(circle(48 + r() * 20, 30, 18, "d"), circle(W - 40, 70, 26, "d"));
        return out.join("");
      },
      (r) => { // a family of curves
        const out = [], g = Math.floor(r() * 6);
        for (let i = 0; i < 6; i++) {
          const amp = 10 + i * 5 + r() * 4, k = 0.018 + r() * 0.012, ph = r() * 6, pts = [];
          for (let x = 0; x <= W; x += 8) pts.push(`${x} ${n(50 + Math.sin(x * k + ph) * amp * Math.sin((x / W) * Math.PI))}`);
          out.push(path("M" + pts.join(" L"), i === g ? "g" : "l"));
        }
        return out.join("");
      },
      (r) => { // nested polygons turning
        const out = [];
        const nest = (cx, cy, size, sides, gold) => {
          for (let i = 0; i < 9; i++) {
            const s = size * Math.pow(0.86, i), a0 = i * 0.18, pts = [];
            for (let k = 0; k < sides; k++) { const a = a0 + (k / sides) * Math.PI * 2; pts.push(`${n(cx + Math.cos(a) * s)},${n(cy + Math.sin(a) * s)}`); }
            out.push(`<polygon points="${pts.join(" ")}" class="${gold && i === 3 ? "g" : "l"}"/>`);
          }
        };
        nest(110 + r() * 30, 50, 46, 4, true); nest(270 + r() * 30, 50, 40, pick(r, [3, 5, 6]), false);
        return out.join("");
      },
    ],
    chemistry: [
      (r) => { // ring lattice
        const out = [], s = 15, g = Math.floor(r() * 12); let i = 0;
        for (let row = 0; row < 4; row++) for (let col = 0; col < 12; col++) {
          if (r() < 0.45) continue;
          const cx = 20 + col * s * 1.75 + (row % 2) * s * 0.87, cy = 14 + row * s * 1.5, pts = [];
          for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; pts.push(`${n(cx + Math.cos(a) * s)},${n(cy + Math.sin(a) * s)}`); }
          out.push(`<polygon points="${pts.join(" ")}" class="${i === g ? "g" : "l"}"/>`, r() < 0.3 ? circle(cx, cy, s * 0.5, i === g ? "g" : "d") : ""); i++;
        }
        return out.join("");
      },
      (r) => { // ball and stick
        const atoms = scatter(r, 12, 6, 12, 22), out = [];
        for (let i = 0; i < atoms.length; i++) { const a = atoms[i], near = atoms.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)).slice(0, 2);
          for (const b of near) { out.push(line(a.x, a.y, b.x, b.y)); if (r() < 0.25) out.push(line(a.x + 3, a.y + 3, b.x + 3, b.y + 3)); } }
        return out.join("") + atoms.map((a, i) => circle(a.x, a.y, a.rad, i === 0 ? "gf" : "f")).join("");
      },
      (r) => { // orbitals
        const out = [];
        for (const [cx, sz, gold] of [[110 + r() * 30, 44, true], [290 + r() * 30, 30, false]]) {
          for (let k = 0; k < 3; k++) out.push(`<ellipse cx="${n(cx)}" cy="50" rx="${sz}" ry="${n(sz * 0.32)}" transform="rotate(${k * 60 + n(r() * 10)} ${n(cx)} 50)" class="${gold && k === 1 ? "g" : "l"}"/>`);
          out.push(circle(cx, 50, 5, gold ? "gf" : "f"));
        }
        return out.join("");
      },
    ],
    physics: [
      (r) => { // two-source ripples
        const out = [], a = 130 + r() * 30, b = 250 + r() * 30;
        for (let i = 1; i <= 9; i++) { out.push(circle(a, 50, i * 14, i === 4 ? "g" : "l"), circle(b, 50, i * 14, "d")); }
        return out.join("") + circle(a, 50, 3.5, "gf") + circle(b, 50, 3.5, "f");
      },
      (r) => { // orbits
        const out = [], cx = 140 + r() * 60;
        for (let i = 1; i <= 5; i++) { const rx = 30 + i * 30, ry = 10 + i * 8, a = r() * Math.PI * 2;
          out.push(`<ellipse cx="${n(cx)}" cy="50" rx="${rx}" ry="${ry}" class="${i === 3 ? "g" : "l"}"/>`, circle(cx + Math.cos(a) * rx, 50 + Math.sin(a) * ry, 3 + r() * 2, i === 3 ? "gf" : "f")); }
        return out.join("") + circle(cx, 50, 7, "f");
      },
      (r) => { // field lines between two poles
        const out = [], a = 120 + r() * 20, b = 280 - r() * 20;
        for (let i = -4; i <= 4; i++) { if (!i) { out.push(line(a, 50, b, 50, "g")); continue; } const bulge = i * 14; out.push(path(`M${n(a)} 50 C${n(a + 40)} ${n(50 + bulge * 1.6)} ${n(b - 40)} ${n(50 + bulge * 1.6)} ${n(b)} 50`, Math.abs(i) % 2 ? "l" : "d")); }
        return out.join("") + circle(a, 50, 7, "gf") + circle(b, 50, 7, "f");
      },
    ],
    writing: [
      (r) => { // looping pen line
        let d = "M10 60", x = 10;
        while (x < W - 30) { const w = 14 + r() * 14, h = 18 + r() * 22; d += ` C${n(x + w)} 60 ${n(x + w)} ${n(60 - h)} ${n(x + w / 2)} ${n(60 - h)} C${n(x)} ${n(60 - h)} ${n(x + w * 0.4)} 60 ${n(x + w * 1.4)} 60`; x += w * 1.4; }
        return path(d, "l") + line(10, 74, 120 + r() * 120, 74, "g") + line(10, 86, W - 20, 86, "d");
      },
      (r) => { // lined pages
        const out = [];
        for (let p = 0; p < 3; p++) { const x = 30 + p * 120 + r() * 10, y = 10 + p * 4, w = 110, h = 82;
          out.push(rect(x, y, w, h, "f", 2), line(x + 18, y, x + 18, y + h, p === 1 ? "g" : "d"));
          for (let k = 1; k < 7; k++) out.push(line(x + 4, y + k * 11, x + w - 4, y + k * 11)); }
        return out.join("");
      },
      (r) => { // paragraph shapes
        const out = []; let y = 14;
        const g = 1 + Math.floor(r() * 5);
        for (let row = 0; row < 7; row++, y += 11) { let x = 20; const end = row % 3 === 2 ? 120 + r() * 120 : W - 20;
          while (x < end - 20) { const w = 14 + r() * 40; out.push(rect(x, y, Math.min(w, end - x), 5, row === g && x > 100 && x < 200 ? "gf" : "f", 2.5)); x += w + 6; } }
        return out.join("");
      },
    ],
    sports: [
      (r) => { // playing surface markings
        const out = [rect(16, 10, W - 32, 80, "l", 30), line(W / 2, 10, W / 2, 90), circle(W / 2, 50, 16, "g"), circle(W / 2, 50, 2.5, "gf")];
        for (const x of [110, W - 110]) out.push(line(x, 10, x, 90, "d"));
        for (const [x, y] of [[70, 32], [70, 68], [W - 70, 32], [W - 70, 68]]) out.push(circle(x, y, 11, "l"), circle(x, y, 1.8, "f"));
        out.push(path(`M16 40 H${30 + r() * 4} V60 H16`), path(`M${W - 16} 40 H${W - 30 - r() * 4} V60 H${W - 16}`));
        return out.join("");
      },
      (r) => { // trajectories
        const out = [], g = Math.floor(r() * 5);
        for (let i = 0; i < 5; i++) { const x0 = 20 + r() * 40, x1 = 200 + r() * 180, h = 20 + r() * 60;
          out.push(path(`M${n(x0)} 90 Q${n((x0 + x1) / 2)} ${n(90 - h * 2)} ${n(x1)} 90`, i === g ? "g" : "d"), circle(x1, 90, 3, i === g ? "gf" : "f")); }
        return out.join("") + line(0, 92, W, 92);
      },
      (r) => { // track lanes
        const out = [], g = 1 + Math.floor(r() * 4);
        for (let i = 0; i < 6; i++) out.push(rect(-60 + i * 10, 8 + i * 8, W + 120 - i * 20, 150, i === g ? "g" : "l", 70 - i * 8));
        return out.join("") + line(W / 2 + 40, 8, W / 2 + 40, 60, "d");
      },
    ],
    general: [
      (r) => { // dot field with a path
        const out = [], pts = [];
        for (let x = 14; x < W; x += 20) for (let y = 14; y < H; y += 18) pts.push([x + (r() - 0.5) * 4, y + (r() - 0.5) * 4]);
        const route = pts.filter(() => r() < 0.08).sort((a, b) => a[0] - b[0]);
        if (route.length > 1) out.push(path("M" + route.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L"), "g"));
        return out.join("") + pts.map(([x, y]) => circle(x, y, route.some((p) => p[0] === x) ? 3 : 1.6, route.some((p) => p[0] === x) ? "gf" : "f")).join("");
      },
      (r) => { // overlapping circles
        const out = [];
        for (let i = 0; i < 7; i++) out.push(circle(40 + i * 54 + (r() - 0.5) * 10, 50 + (r() - 0.5) * 20, 30 + r() * 14, i === 3 ? "g" : i % 2 ? "l" : "f"));
        return out.join("");
      },
      (r) => { // diagonal hatch with one band
        const out = [], g = Math.floor(r() * 10) + 5;
        for (let i = -6; i < 26; i++) out.push(line(i * 20, H, i * 20 + 60, 0, i === g ? "g" : i % 3 ? "d" : "l"));
        return out.join("");
      },
    ],
  };
  S.economics = S.micro; // older courses saved as "economics"

  // "computing/2" -> ["computing", 2]
  const parse = (art) => { const [s, v] = String(art || "").split("/"); return [S[s] ? s : "general", Number(v) || 0]; };
  L.coverSubjects = S;
  L.courseArt = (art, seed = "", { label = "" } = {}) => {
    const [subject, variant] = parse(art), fn = S[subject][variant % S[subject].length];
    let body = "";
    try { body = fn(rng(`${subject}/${variant}/${seed}`)); } catch { body = ""; }
    return `<svg class="course-art cover-${subject}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" ${label ? `role="img" aria-label="${L.esc(label)}"` : 'aria-hidden="true" focusable="false"'}>${body}</svg>`;
  };
})();
