// Faint line drawings behind the lecture, chosen by the server from what the class is about
// (lib/theme.js). Drawings are fixed here; the server only sends icon ids and course words.
(function () {
  const L = window.Lost;
  const P = { // 48x48 line art, stroke only
    cpu: '<rect x="12" y="12" width="24" height="24" rx="3"/><rect x="19" y="19" width="10" height="10"/><path d="M18 12V6M24 12V6M30 12V6M18 42v-6M24 42v-6M30 42v-6M12 18H6M12 24H6M12 30H6M42 18h-6M42 24h-6M42 30h-6"/>',
    memory: '<rect x="4" y="16" width="40" height="14" rx="2"/><path d="M10 30v6M16 30v6M22 30v6M28 30v6M34 30v6M40 30v6"/><rect x="9" y="20" width="7" height="6"/><rect x="20" y="20" width="7" height="6"/><rect x="31" y="20" width="7" height="6"/>',
    binary: '<text x="24" y="21" text-anchor="middle" font-size="12" font-family="monospace" stroke="none" fill="currentColor">1011</text><text x="24" y="37" text-anchor="middle" font-size="12" font-family="monospace" stroke="none" fill="currentColor">0110</text>',
    code: '<path d="M17 14 7 24l10 10M31 14l10 10-10 10M27 10l-6 28"/>',
    loop: '<path d="M38 24a14 14 0 1 1-4-9.9"/><path d="M35 8v7h-7"/>',
    search: '<circle cx="20" cy="20" r="11"/><path d="m28 28 12 12"/>',
    tree: '<circle cx="24" cy="9" r="4"/><circle cx="12" cy="25" r="4"/><circle cx="36" cy="25" r="4"/><circle cx="6" cy="40" r="3.5"/><circle cx="18" cy="40" r="3.5"/><path d="M21 12l-6 10M27 12l6 10M10 28l-3 9M14 28l3 9"/>',
    bug: '<ellipse cx="24" cy="27" rx="9" ry="12"/><path d="M24 15v24M18 13l-4-5M30 13l4-5M15 22H7M15 30H7M33 22h8M33 30h8M16 37l-6 4M32 37l6 4"/>',
    monitor: '<rect x="5" y="8" width="38" height="25" rx="2"/><path d="M18 40h12M24 33v7"/><path d="M11 26l7-8 6 5 6-8 7 11"/>',
    letters: '<text x="24" y="32" text-anchor="middle" font-size="22" font-family="Georgia,serif" stroke="none" fill="currentColor">Aa</text>',
    network: '<circle cx="24" cy="10" r="4"/><circle cx="9" cy="36" r="4"/><circle cx="39" cy="36" r="4"/><circle cx="24" cy="27" r="3"/><path d="M24 14v10M21.5 29 12 34M26.5 29l9.5 5M13 36h22"/>',
    sigma: '<path d="M36 10H12l13 14-13 14h24"/>',
    axes: '<path d="M8 6v34h36"/><path d="M10 36c8-2 12-24 20-26s10 8 12 8"/>',
    pi: '<path d="M8 14h32M17 14c0 10-2 20-6 24M31 14v20c0 3 2 4 5 3"/>',
    chart: '<path d="M6 42h36"/><rect x="10" y="26" width="6" height="16"/><rect x="21" y="16" width="6" height="26"/><rect x="32" y="8" width="6" height="34"/>',
    market: '<path d="M8 6v34h36"/><path d="M12 12l26 24M12 36l26-24"/>',
    coin: '<circle cx="24" cy="24" r="16"/><path d="M29 17c-2-2-10-2-10 3s10 3 10 8-8 5-10 3M24 12v24"/>',
    atom: '<circle cx="24" cy="24" r="3"/><ellipse cx="24" cy="24" rx="18" ry="7"/><ellipse cx="24" cy="24" rx="18" ry="7" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="18" ry="7" transform="rotate(120 24 24)"/>',
    wave: '<path d="M4 24c4-12 8-12 12 0s8 12 12 0 8-12 12 0 6 8 6 8"/>',
    flask: '<path d="M19 6h10M20 6v12L9 38a3 3 0 0 0 3 4h24a3 3 0 0 0 3-4L28 18V6"/><path d="M14 30h20"/>',
    molecule: '<circle cx="12" cy="14" r="5"/><circle cx="34" cy="12" r="4"/><circle cx="24" cy="30" r="6"/><circle cx="38" cy="38" r="4"/><path d="m16 18 4 7M31 15l-4 10M29 33l6 3"/>',
    dna: '<path d="M14 4c0 10 20 10 20 20s-20 10-20 20M34 4c0 10-20 10-20 20s20 10 20 20"/><path d="M17 10h14M16 18h16M16 30h16M17 38h14"/>',
    leaf: '<path d="M10 38C8 20 20 8 40 8c0 20-12 32-30 30z"/><path d="M10 38 30 18"/>',
    globe: '<circle cx="24" cy="24" r="17"/><ellipse cx="24" cy="24" rx="7" ry="17"/><path d="M7 24h34M10 15h28M10 33h28"/>',
    column: '<path d="M6 14 24 5l18 9zM8 42h32M10 38h28M12 18v20M20 18v20M28 18v20M36 18v20M8 14h32"/>',
    book: '<path d="M24 12c-5-4-12-4-18-3v28c6-1 13-1 18 3 5-4 12-4 18-3V9c-6-1-13-1-18 3zM24 12v28"/>',
    puck: '<path d="M30 6 18 36h-7"/><path d="M18 36h-8a3 3 0 0 0 0 4h9"/><ellipse cx="35" cy="38" rx="8" ry="3"/><path d="M27 38v2c0 2 4 3 8 3s8-1 8-3v-2"/>',
    whistle: '<circle cx="18" cy="28" r="10"/><path d="M24 20h18v8H27"/><circle cx="18" cy="28" r="3"/><path d="M8 18 4 14"/>',
    goal: '<path d="M6 40V12h36v28"/><path d="M6 12l6 6h24l6-6M12 18v22M36 18v22M12 26h24M12 33h24M18 18v22M24 18v22M30 18v22"/>',
    trophy: '<path d="M15 6h18v10a9 9 0 0 1-18 0zM15 10H8c0 6 3 9 8 9M33 10h7c0 6-3 9-8 9M24 25v8M16 42h16M19 33h10v9H19z"/>',
    clock: '<circle cx="24" cy="24" r="17"/><path d="M24 13v11l7 5"/>',
    gear: '<circle cx="24" cy="24" r="6"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/><circle cx="24" cy="24" r="12"/>',
    bulb: '<path d="M17 30c-4-3-6-7-6-11a13 13 0 0 1 26 0c0 4-2 8-6 11v5H17z"/><path d="M18 40h12M20 44h8"/>',
    pencil: '<path d="M8 40l4-12L32 8l8 8-20 20zM12 28l8 8M28 12l8 8"/>',
  };
  // small seeded random, so the layout stays put while the theme stays the same
  const rng = (seed) => { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489917)) >>> 0) / 4294967296; };
  let el = null, key = "";
  L.backdrop = (theme) => {
    if (!theme || !theme.icons?.length) return;
    const k = JSON.stringify(theme);
    if (k === key) return; key = k;
    if (!el) { el = document.createElement("div"); el.className = "backdrop"; el.setAttribute("aria-hidden", "true"); document.body.prepend(el); }
    const r = rng(k), items = [];
    const cols = 4, rows = 7;
    // a mix of drawings and words, one per cell, jittered and tilted; the middle column stays light so text over it reads
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      if (r() < 0.3) continue;
      const word = theme.words.length && r() < 0.28;
      const x = (col + 0.15 + r() * 0.7) * (100 / cols), y = (row + 0.15 + r() * 0.7) * (100 / rows), rot = Math.round((r() - 0.5) * 30);
      const gold = r() < 0.25 ? " gold" : "";
      if (word) items.push(`<span class="bd-word${gold}" style="left:${x}%;top:${y}%;transform:translate(-50%,-50%) rotate(${rot}deg)">${L.esc(theme.words[Math.floor(r() * theme.words.length)])}</span>`);
      else { const ic = theme.icons[Math.floor(r() * theme.icons.length)], size = 44 + Math.round(r() * 40); if (P[ic]) items.push(`<svg class="bd-icon${gold}" viewBox="0 0 48 48" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;transform:translate(-50%,-50%) rotate(${rot}deg)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[ic]}</svg>`); }
    }
    const layer = document.createElement("div");
    layer.className = "bd-layer"; layer.innerHTML = items.join("");
    el.append(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("on")));
    [...el.children].slice(0, -1).forEach((old) => { old.classList.remove("on"); setTimeout(() => old.remove(), 1200); });
  };
  L.clearBackdrop = () => { if (el) { el.remove(); el = null; key = ""; } };
})();
