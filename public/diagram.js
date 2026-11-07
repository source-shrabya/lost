// Draws the small diagrams Claude describes. Claude never writes drawing code: it picks one of
// three shapes and fills in short labels, and this file draws them in Lost's own style, so every
// diagram renders and looks the same on a phone or a projector.
//
//   steps:   { kind: "steps", title, items: [{ label, note }] }            a chain, left to right
//   compare: { kind: "compare", title, columns: [{ heading, points: [] }] } two or three side by side
//   parts:   { kind: "parts", title, center, items: [{ label, note }] }     one idea and what it is made of
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const short = (s, n = 80) => { s = String(s ?? "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const list = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);

  function draw(d) {
    if (!d || typeof d !== "object") return "";
    const title = d.title ? `<p class="dg-title">${esc(short(d.title, 90))}</p>` : "";
    if (d.kind === "steps") {
      const items = list(d.items, 7).filter((i) => i && i.label);
      if (items.length < 2) return "";
      const boxes = items.map((i) => `<div class="dg-box"><b>${esc(short(i.label, 40))}</b>${i.note ? `<span>${esc(short(i.note))}</span>` : ""}</div>`);
      return `<figure class="dg dg-steps">${title}<div class="dg-row">${boxes.join(`<span class="dg-arrow" aria-hidden="true">→</span>`)}</div></figure>`;
    }
    if (d.kind === "compare") {
      const cols = list(d.columns, 3).filter((c) => c && c.heading);
      if (cols.length < 2) return "";
      return `<figure class="dg dg-compare">${title}<div class="dg-cols">${cols.map((c) =>
        `<div class="dg-col"><b>${esc(short(c.heading, 40))}</b><ul>${list(c.points, 5).map((p) => `<li>${esc(short(p))}</li>`).join("")}</ul></div>`).join("")}</div></figure>`;
    }
    if (d.kind === "parts") {
      const items = list(d.items, 6).filter((i) => i && i.label);
      if (!d.center || items.length < 2) return "";
      return `<figure class="dg dg-parts">${title}<div class="dg-center">${esc(short(d.center, 50))}</div><div class="dg-grid">${items.map((i) =>
        `<div class="dg-box"><b>${esc(short(i.label, 40))}</b>${i.note ? `<span>${esc(short(i.note))}</span>` : ""}</div>`).join("")}</div></figure>`;
    }
    return "";
  }
  window.drawDiagram = draw;
})();
