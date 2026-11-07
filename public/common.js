// Shared front-end code for the professor and student portals: API calls, routing, header,
// announcements, and the vector visuals (flow diagram, tap chart). No framework.
(function () {
  const L = (window.Lost = {});
  let csrf = "";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (t) => { const s = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const when = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const ago = (iso) => { if (!iso) return "never"; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : when(iso); };
  const safeUrl = (u) => (/^https:\/\//.test(String(u || "")) ? String(u) : "");
  Object.assign(L, { $, $$, esc, fmt, when, ago, safeUrl });

  // ---------- API ----------
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  L.api = async (path, { method = "GET", body, raw, headers = {}, signal } = {}) => {
    const opts = { method, headers: { ...headers }, cache: "no-store", signal };
    if (method !== "GET") opts.headers["x-lost-csrf"] = csrf;
    if (raw) opts.body = raw;
    else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opts); }
    catch (e) { if (e.name === "AbortError") throw e; throw new ApiError(0, "No connection to Lost. Check your Wi-Fi."); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && !path.startsWith("/api/auth")) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new ApiError(401, "Signed out."); }
    if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
    return data;
  };

  // ---------- announcements (one polite, one assertive region per page) ----------
  L.announce = (msg, urgent = false) => {
    const r = $(urgent ? "#announce-urgent" : "#announce");
    if (!r) return;
    r.textContent = "";
    setTimeout(() => (r.textContent = msg), 60);
  };
  L.toast = (msg, kind = "") => {
    const t = $("#toast");
    t.textContent = msg; t.className = `toast show ${kind}`;
    clearTimeout(L._toastT); L._toastT = setTimeout(() => (t.className = "toast"), 4500);
    L.announce(msg, kind === "error");
  };

  // ---------- shell ----------
  L.boot = async (role, routes) => {
    const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    if (!me.user) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; return; }
    if (me.user.role !== role) { location.href = me.user.role === "professor" ? "/prof" : "/student"; return; }
    csrf = me.csrf; L.me = me.user;
    renderHeader(me);
    L.routes = routes;
    window.addEventListener("hashchange", () => L.render());
    L.render();
    setInterval(refreshBell, 20000);
  };

  function renderHeader(me) {
    const u = me.user;
    $("#top").innerHTML = `
      <a class="skip" href="#app">Skip to content</a>
      <a class="brand" href="#/" aria-label="Lost home">Lost</a>
      <span class="role-tag">${u.role === "professor" ? "Professor" : "Student"}${u.demo ? " · demo account" : ""}</span>
      <nav aria-label="Account" class="top-actions">
        <details class="bell" id="bell"><summary aria-label="Notifications"><span>Notifications</span> <b id="bellCount" class="count" ${me.unread ? "" : "hidden"}>${me.unread}</b></summary><div class="bell-list" id="bellList"><p class="note">Loading…</p></div></details>
        <span class="who">${esc(u.name)}</span>
        <button class="quiet" id="logout">Sign out</button>
      </nav>`;
    $("#logout").onclick = async () => { await L.api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/login"; };
    $("#bell").addEventListener("toggle", async (e) => {
      if (!e.target.open) return;
      const { items } = await L.api("/api/notifications");
      $("#bellList").innerHTML = items.length ? items.map((n) => `<a href="${esc(n.link)}" data-n="${esc(n.id)}" class="${n.read_at ? "" : "unread"}">${esc(n.title)}<span class="note">${ago(n.created_at)}</span></a>`).join("") + `<button class="quiet" id="readAll">Mark all read</button>` : `<p class="note">Nothing yet. When a class summary is ready it shows up here.</p>`;
      $("#readAll")?.addEventListener("click", async () => { await L.api("/api/notifications/read", { method: "POST", body: {} }); refreshBell(); $("#bell").open = false; });
    });
    $("#bellList").addEventListener("click", (e) => {
      const a = e.target.closest("a[data-n]"); if (!a) return;
      L.api("/api/notifications/read", { method: "POST", body: { id: a.dataset.n } }).then(refreshBell).catch(() => {});
      $("#bell").open = false;
    });
  }
  async function refreshBell() {
    try {
      const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json());
      const c = $("#bellCount"); if (!c || !me.user) return;
      if (me.unread > Number(c.textContent || 0)) L.toast("New notification: a class summary is ready.");
      c.textContent = me.unread; c.hidden = !me.unread;
    } catch {}
  }

  // ---------- router ----------
  // Each route returns nothing; it may register cleanup with L.onLeave(fn) (polls, recorders).
  let leaving = [];
  L.onLeave = (fn) => leaving.push(fn);
  L.render = async () => {
    for (const fn of leaving.splice(0)) { try { fn(); } catch {} }
    const hash = location.hash.replace(/^#/, "") || "/";
    const [pathPart, query = ""] = hash.split("?");
    const params = Object.fromEntries(new URLSearchParams(query));
    const app = $("#app");
    for (const [pattern, fn] of L.routes) {
      const m = pathPart.match(pattern);
      if (!m) continue;
      app.innerHTML = `<p class="note loading">Loading…</p>`;
      try { await fn(app, m.slice(1).map((x) => (x == null ? undefined : decodeURIComponent(x))), params); }
      catch (e) { if (e.name !== "AbortError" && e.status !== 401) app.innerHTML = L.errorBox(e.message); $("#retryView")?.addEventListener("click", () => L.render()); }
      const h1 = $("#app h1");
      if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); document.title = `${h1.textContent} · Lost`; }
      window.scrollTo(0, 0);
      return;
    }
    app.innerHTML = `<h1>Not found</h1><p><a href="#/">Back to the start</a></p>`;
  };
  L.errorBox = (msg) => `<div class="error-box" role="alert"><p>${esc(msg)}</p><button id="retryView">Try again</button></div>`;

  // Poll every ms while the route is open. fn receives an AbortSignal.
  L.poll = (fn, ms = 1000) => {
    let stop = false, ctrl = null, t = null;
    const tick = async () => {
      if (stop) return;
      ctrl = new AbortController();
      try { await fn(ctrl.signal); L.online(true); } catch (e) { if (e.name !== "AbortError") L.online(false, e.message); }
      if (!stop) t = setTimeout(tick, document.hidden ? Math.max(ms, 4000) : ms);
    };
    tick();
    L.onLeave(() => { stop = true; clearTimeout(t); ctrl?.abort(); });
  };
  L.online = (ok, msg) => {
    const b = $("#offline"); if (!b) return;
    if (ok === !b.hidden) return;
    b.hidden = ok; if (!ok) b.textContent = `Reconnecting… ${msg || ""}`;
  };

  // ---------- visuals ----------
  // Sources: transcript lines (with timestamps) and course passages (title, location, link).
  L.sources = (list, label = "Sources") => {
    if (!list?.length) return "";
    return `<div class="sources"><span class="label">${esc(label)}</span><ul>${list.map((s) => s.type === "line"
      ? `<li><span class="src-kind">Lecture ${fmt(s.t)}</span> "${esc(s.text)}"</li>`
      : `<li><span class="src-kind">${esc(s.source === "demo" ? "Course material (demo)" : "Course material")}</span> ${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}${s.location && s.location !== s.title ? `, ${esc(s.location)}` : ""}</li>`).join("")}</ul></div>`;
  };
  L.origin = (ex) => ex.origin === "lecture" ? `Example from your professor${ex.source ? ` at ${fmt(ex.source.t)}` : ""}`
    : ex.origin === "materials" ? `Example from course materials${ex.source ? `: ${esc(ex.source.title)}${ex.source.location ? `, ${esc(ex.source.location)}` : ""}` : ""}`
    : "Example written by the AI (not from your professor)";

  // previous idea -> confusing concept -> next idea. Missing parts say so; nothing is guessed.
  L.flow = (f, { caption = true } = {}) => {
    if (!f) return "";
    const box = (cls, kicker, item, empty) => item
      ? `<li class="fl-box ${cls}"><span class="fl-kicker">${kicker}</span><b>${esc(item.label)}</b>${item.source ? `<span class="fl-at">said at ${fmt(item.source.t)}</span>` : ""}</li>`
      : `<li class="fl-box fl-unknown"><span class="fl-kicker">${kicker}</span><b>${empty}</b></li>`;
    const alt = `Before: ${f.previous?.label || "not in the transcript"}. You were lost at: ${f.current.label}. After: ${f.next?.label || "not discussed yet"}.`;
    return `<figure class="flow"><figcaption${caption ? "" : ' class="visually-hidden"'}>Flow of the discussion</figcaption>
      <ol class="fl-row" aria-label="${esc(alt)}">
        ${box("", "Before", f.previous, "Not in the transcript")}
        <li class="fl-arrow" aria-hidden="true">→</li>
        ${box("fl-now", "You were lost at", f.current)}
        <li class="fl-arrow" aria-hidden="true">→</li>
        ${box("", "After", f.next, "Not discussed yet")}
      </ol></figure>`;
  };
  // A concept map for summaries: ordered steps with where each was discussed.
  L.steps = (flow) => {
    if (!flow?.steps?.length) return "";
    return `<figure class="flow"><figcaption>${esc(flow.title || "How today's ideas connect")}</figcaption>
      <ol class="fl-row" aria-label="${esc(flow.steps.map((s, i) => `${i + 1}. ${s.label}`).join(" "))}">${flow.steps.map((s, i) =>
        `${i ? `<li class="fl-arrow" aria-hidden="true">→</li>` : ""}<li class="fl-box"><span class="fl-kicker">Step ${i + 1}</span><b>${esc(s.label)}</b>${s.source ? `<span class="fl-at">${fmt(s.source.t)}</span>` : ""}</li>`).join("")}</ol></figure>`;
  };

  // Measured data only: taps per bin. Bars plus a text table for screen readers.
  L.tapChart = (bins, binSeconds, { title = "When students tapped I'm lost", showStudents = true } = {}) => {
    if (!bins?.length) return "";
    const W = 640, H = 200, padL = 40, padB = 36, padT = 12, w = Math.min(80, (W - padL - 8) / bins.length);
    const max = Math.max(2, ...bins.map((b) => b.taps));
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const ticks = [0, Math.ceil(max / 2), max];
    const every = Math.max(1, Math.ceil(bins.length / 10));
    const bars = bins.map((b, i) => `<g><rect x="${padL + i * w + 1}" y="${y(b.taps)}" width="${Math.max(1, w - 2)}" height="${H - padB - y(b.taps)}" class="bar"><title>${fmt(b.from)}-${fmt(b.from + binSeconds)}: ${b.taps} tap${b.taps === 1 ? "" : "s"}${showStudents ? `, ${b.students} student${b.students === 1 ? "" : "s"}` : ""}</title></rect>
      ${showStudents && b.students ? `<circle cx="${padL + i * w + w / 2}" cy="${y(b.students)}" r="3.5" class="dot-students"/>` : ""}</g>`).join("");
    const xl = bins.map((b, i) => (i % every === 0 ? `<text x="${padL + i * w + w / 2}" y="${H - padB + 16}" class="tick" text-anchor="middle">${Math.round(b.from / 60)}</text>` : "")).join("");
    const yl = ticks.map((v) => `<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`).join("");
    return `<figure class="chart"><figcaption>${esc(title)}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: bar chart of taps per ${binSeconds} seconds of class. The data table below has the same numbers.">
        ${yl}${bars}${xl}
        <text x="${(W + padL) / 2}" y="${H - 4}" class="axis" text-anchor="middle">Time into class (m:ss)</text>
        <text x="12" y="${(H - padB) / 2}" class="axis" text-anchor="middle" transform="rotate(-90 12 ${(H - padB) / 2})">Count</text>
      </svg>
      <p class="legend"><span class="key key-bar"></span> Taps (one student can tap more than once)${showStudents ? ` <span class="key key-dot"></span> Different students` : ""}. Measured from taps in this class.</p>
      <details class="data-table"><summary>Show the numbers as a table</summary><table><caption>${esc(title)}</caption><thead><tr><th scope="col">Time</th><th scope="col">Taps</th>${showStudents ? `<th scope="col">Students</th>` : ""}</tr></thead>
        <tbody>${bins.map((b) => `<tr><td>${fmt(b.from)}-${fmt(b.from + binSeconds)}</td><td>${b.taps}</td>${showStudents ? `<td>${b.students}</td>` : ""}</tr>`).join("")}</tbody></table></details>
    </figure>`;
  };

  // Two-step confirm without browser dialogs.
  L.confirmButton = (btn, label = "Click again to confirm") => {
    if (btn.dataset.sure) return true;
    btn.dataset.sure = "1"; const old = btn.textContent; btn.textContent = label;
    setTimeout(() => { delete btn.dataset.sure; btn.textContent = old; }, 4000);
    return false;
  };
})();
