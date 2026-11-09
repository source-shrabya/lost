// Student portal: the class list, and one workspace per course with a section rail on the left:
// Overview, Live class, My lost moments, Practice, Class summary, Course materials.
(function () {
  const { $, $$, esc, fmt, when, api, toast, safeUrl } = Lost;
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "");
  const dayTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // Send a student straight into a class the moment it is live. Each live class is entered automatically
  // once per browser tab, so going back to "Your classes" doesn't bounce them in again.
  const entered = (() => { try { return new Set(JSON.parse(sessionStorage.getItem("lost-entered") || "[]")); } catch { return new Set(); } })();
  function enterLive(sid, cid) {
    if (!sid || entered.has(sid)) return false;
    entered.add(sid);
    try { sessionStorage.setItem("lost-entered", JSON.stringify([...entered])); } catch {}
    location.hash = cid ? `#/course/${cid}/live` : `#/live/${sid}`;
    return true;
  }

  // Small line icons for the section rail (decorative; every link has a text label).
  const ICON = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    moments: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    practice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
    summary: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
    materials: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H10l2 2.5h6.5c.8 0 1.5.7 1.5 1.5v10.5c0 .8-.7 1.5-1.5 1.5h-13C4.7 20 4 19.3 4 18.5z"/>',
  };
  const icon = (k) => `<svg class="ws-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[k]}</svg>`;

  // ================= home: every class =================
  async function home(app, _, params) {
    if (params.canvas) toast(params.canvas === "ok" ? "Canvas linked. Your classes are matched to your sections." : `Canvas: ${params.canvas}`, params.canvas === "ok" ? "" : "error");
    const { courses } = await api("/api/student/courses");
    const live = courses.filter((c) => c.active?.status === "live");
    if (live.length === 1 && enterLive(live[0].active.id, live[0].id)) return;
    Lost.poll(async (signal) => {
      const r = await api("/api/student/courses", { signal });
      const now = r.courses.filter((c) => c.active?.status === "live" && !entered.has(c.active.id));
      if (now.length === 1) enterLive(now[0].active.id, now[0].id);
      else if (now.length > 1 || r.courses.length !== courses.length || r.courses.filter((c) => c.active?.status === "live").length !== live.length) Lost.render();
    }, 3000);
    // Live classes first, then classes with open moments (most first), then the most recent class.
    const rank = (c) => (c.active?.status === "live" ? 0 : c.stats.unresolved ? 1 : 2);
    const sorted = [...courses].sort((a, b) => rank(a) - rank(b) || b.stats.unresolved - a.stats.unresolved
      || String(b.last?.ended_at || "").localeCompare(String(a.last?.ended_at || "")) || String(a.code).localeCompare(String(b.code)));
    const open = courses.reduce((n, c) => n + c.stats.unresolved, 0);
    const h = new Date().getHours();
    const hello = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    const first = String(Lost.me?.name || "").trim().split(/\s+/)[0];
    const topOpen = sorted.find((c) => c.stats.unresolved);
    const sub = live.length ? "" : open ? `${plural(open, "moment")} still open${topOpen ? `, most in ${esc(topOpen.code)}` : ""}.`
      : courses.length ? "Nothing open. You're caught up." : "";
    // The centre box: a live class if there is one, otherwise a class code field.
    const centre = live.length
      ? live.map((c) => `<a class="home-live" href="#/course/${c.id}/live"><span class="dot live" aria-hidden="true"></span><span class="hl-text"><b>${esc(c.code)} is live now</b><span>${esc(c.name)}</span></span><span class="button gold">Join class</span></a>`).join("")
      : `<form class="home-join" id="homeJoin"><label for="joinCode">Class code</label>
          <input id="joinCode" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="No Canvas yet? Enter a class code" maxlength="12">
          <button class="button primary" type="submit">Join</button></form>`;
    const side = courses.length ? `<nav class="ws-side home-side" aria-label="Your classes">
        <a class="hs-home on" href="#/" aria-current="page">Home</a>
        <p class="hs-head">Classes</p>
        <ul class="hs-list">${sorted.map((c) => {
          const isLive = c.active?.status === "live";
          return `<li><a class="hs-link${isLive ? " is-live" : ""}" href="${isLive ? `#/course/${c.id}/live` : `#/course/${c.id}`}">
            <span class="hs-art">${Lost.courseArt(c.art, c.id)}</span>
            <span class="hs-text"><span class="hs-code">${esc(c.code)}</span><span class="hs-name">${esc(c.name)}</span></span>
            ${isLive ? `<span class="hs-live"><span class="dot live" aria-hidden="true"></span><span class="visually-hidden">Live now</span></span>`
              : c.stats.unresolved ? `<span class="ws-count" title="${plural(c.stats.unresolved, "open moment")}">${c.stats.unresolved}</span>` : ""}</a></li>`;
        }).join("")}</ul></nav>` : "";
    app.innerHTML = `<div class="ws home-ws">${side}<div class="ws-main home home2">
      <div class="home-hero">
        <h1 class="home-hello">${esc(hello)}${first ? `, ${esc(first)}` : ""}</h1>
        ${centre}
        ${sub ? `<p class="home-sub">${sub}</p>` : ""}
        <aside class="home-hint" aria-label="How joining works with Canvas">
          <span class="hh-tag">With Canvas</span>
          <p>Once your university connects Lost to Canvas, your classes show up here on their own. No QR code and no class code. A class only opens while it is running, and only for students who are in the room.</p>
        </aside>
      </div>
      ${courses.length ? `<section class="home-classes" aria-labelledby="hcTitle">
          <div class="hc-head"><h2 id="hcTitle">Your classes</h2><span class="note">${plural(courses.length, "class", "classes")}</span></div>
          <ul class="mini-grid">${sorted.map(courseCard).join("")}</ul></section>`
        : `<p class="home-empty">Your classes show up here once your university connects them to Lost.</p>`}
    </div></div>`;
    $("#homeJoin")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = $("#joinCode").value.trim().toUpperCase();
      if (code) location.hash = `#/join/${encodeURIComponent(code)}`;
    });
  }
  // Small card: cover strip, code + status, name, last class in one short line.
  function courseCard(c) {
    const isLive = c.active?.status === "live";
    const href = isLive ? `#/course/${c.id}/live` : c.stats.unresolved ? `#/course/${c.id}/moments` : `#/course/${c.id}`;
    const status = isLive ? `<span class="mc-flag live"><span class="dot live" aria-hidden="true"></span>Live</span>`
      : c.stats.unresolved ? `<span class="mc-flag open">${c.stats.unresolved} open</span>` : "";
    const when = isLive ? "Class is on now" : c.last?.ended_at ? day(c.last.started_at || c.last.ended_at) : "No classes yet";
    return `<li><a class="mini-card${isLive ? " is-live" : ""}" href="${href}">
      <span class="mc-cover">${Lost.courseArt(c.art, c.id)}</span>
      <span class="mc-body">
        <span class="mc-top"><span class="cc-code">${esc(c.code)}</span>${status}</span>
        <span class="mc-title">${esc(c.name)}</span>
        ${c.recap?.idea ? `<span class="mc-recap">${esc(c.recap.idea)}</span>` : ""}
        <span class="mc-meta">${esc(when)}${c.source === "demo" ? " · Demo" : ""}</span>
      </span></a></li>`;
  }

  // ================= join =================
  async function join(app, [code]) {
    app.innerHTML = `<h1>Joining class ${esc(code)}</h1><p class="note">Checking the code…</p>`;
    let r;
    try { r = await api("/api/student/join", { method: "POST", body: { code } }); }
    catch (e) { app.innerHTML = `<h1>Couldn't join</h1><section class="panel"><p class="form-error">${esc(e.message)}</p><a class="button" href="#/">Back</a></section>`; return; }
    if (r.activeSession) { entered.add(r.activeSession); location.replace(`#/course/${r.course.id}/live`); return; }
    app.innerHTML = `<h1>You're in ${esc(r.course.code)}</h1>
      <section class="panel waiting">
        <p><span class="dot live" aria-hidden="true"></span> <b>Waiting for class to start.</b></p>
        <p class="note">Keep this page open. You'll go into ${esc(r.course.name)} by yourself as soon as your professor starts.</p>
      </section>`;
    Lost.poll(async (signal) => {
      const d = await api(`/api/student/courses/${r.course.id}`, { signal });
      if (d.active?.status === "live") { entered.add(d.active.id); location.replace(`#/course/${r.course.id}/live`); }
    }, 2500);
  }

  // Old links (notifications, bookmarks) still work: they land in the right workspace section.
  async function liveLink(app, [sid]) {
    const d = await api(`/api/student/sessions/${sid}/live`);
    location.replace(d.status === "live" || d.status === "ending" ? `#/course/${d.course.id}/live` : `#/course/${d.course.id}/summary?s=${sid}`);
  }
  async function sessionLink(app, [sid, ev]) {
    const d = await api(`/api/student/sessions/${sid}`);
    const cid = d.session.course_id;
    location.replace(d.session.status === "live" ? `#/course/${cid}/live` : ev ? `#/course/${cid}/moments/${ev}` : `#/course/${cid}/summary?s=${sid}`);
  }

  // ================= course workspace =================
  const LABEL = { overview: "Overview", live: "Live class", moments: "My lost moments", practice: "Practice", summary: "Class summary", materials: "Course materials" };
  const SHORT = { overview: "Overview", live: "Live", moments: "Moments", practice: "Practice", summary: "Summary", materials: "Materials" };
  const TABS = [["explain", "Explanation"], ["context", "Context & diagram"], ["check", "Check understanding"], ["sources", "Sources"]];
  const isResolved = (h) => h.self_status === "resolved" || h.status === "resolved";
  const stateOf = (h) => (h.checkPassed ? "check" : isResolved(h) ? "understood" : "open");
  const STATE = { open: ["Unresolved", "st-open"], understood: ["You said you got it", "st-ok"], check: ["Check passed", "st-check"] };
  const stateChip = (h) => { const [t, c] = STATE[stateOf(h)]; return `<span class="mm-state ${c}"><span class="st-mark" aria-hidden="true"></span>${t}</span>`; };

  async function workspace(app, args, params) {
    const W = { id: args[0], section: "", live: null, sc: null, sel: params.s || "", quiz: {}, drafts: {}, ev: new Map(), flash: null, mmFilter: "all", lastLine: "" };
    const load = async () => {
      const [d, { courses }] = await Promise.all([api(`/api/student/courses/${W.id}`), api("/api/student/courses")]);
      W.d = d; W.all = courses; W.me = courses.find((c) => c.id === W.id) || {};
    };
    await load();
    const c = W.d.course;
    app.innerHTML = `<div class="ws">
        <nav class="ws-side" id="wsNav" aria-label="${esc(c.code)} sections"></nav>
        <div class="ws-main">
          <div id="wsNow" class="classnow" hidden></div>
          <div id="wsLive" hidden></div>
          <div id="wsSection"></div>
        </div>
      </div>`;
    Lost.keep(W.id, (a, p) => show(a, p));
    Lost.onLeave(() => { W.sc?.dispose(); W.live?.destroy(); W.live = null; });

    // Keep counts and the live state fresh without redrawing the section the student is reading.
    let first = true;
    Lost.poll(async (signal) => {
      if (first) { first = false; return; }
      const before = W.d.active?.id || "";
      const d = await api(`/api/student/courses/${W.id}`, { signal });
      W.d = d;
      const now = d.active?.id || "";
      if (now !== before) {
        ensureLive();
        if (d.active?.status === "live" && enterLive(d.active.id, W.id)) return;
      }
      paintNav();
    }, 10000);

    const sections = () => {
      const d = W.d, hasEnded = d.sessions.some((s) => s.status === "ended");
      return ["overview", d.active || W.live ? "live" : "", d.history.length ? "moments" : "", d.history.length || hasEnded ? "practice" : "",
        hasEnded ? "summary" : "", d.materials.length || safeUrl(d.course.office_hours_url) || safeUrl(d.course.tutoring_url) ? "materials" : ""].filter(Boolean);
    };
    const endedSessions = () => W.d.sessions.filter((s) => s.status === "ended");
    const selSession = () => W.sel && W.d.sessions.some((s) => s.id === W.sel) ? W.sel : endedSessions()[0]?.id || "";
    const href = (k) => `#/course/${W.id}${k === "overview" ? "" : `/${k}`}${k === "summary" && selSession() ? `?s=${selSession()}` : ""}`;

    function paintNav() {
      const d = W.d, open = d.history.filter((h) => !isResolved(h)).length;
      const sub = {
        live: W.liveStatus === "ended" ? "Class ended" : d.active ? "Live now" : "",
        moments: d.history.length ? (open ? `${open} unresolved` : "All cleared") : "",
        summary: selSession() ? day(W.d.sessions.find((s) => s.id === selSession())?.started_at) : "",
        materials: d.materials.length ? plural(d.materials.length, "item") : "Help links",
      };
      $("#wsNav").innerHTML = `
        <a class="ws-back" href="#/"><span aria-hidden="true">←</span> All classes</a>
        <div class="ws-course">${Lost.courseArt(c.art, c.id)}<p><span class="cc-code">${esc(c.code)}</span><span class="ws-cname">${esc(c.name)}</span></p></div>
        <ul class="ws-links" style="--cols:${sections().length <= 4 ? sections().length : 3}">${sections().map((k) => `<li><a class="ws-link${k === W.section ? " on" : ""}${k === "live" && d.active ? " is-live" : ""}" href="${href(k)}"${k === W.section ? ' aria-current="page"' : ""}>
          ${icon(k)}<span class="ws-label"><span class="ws-long">${LABEL[k]}</span><span class="ws-short" aria-hidden="true">${SHORT[k]}</span>${sub[k] ? `<span class="ws-sub">${k === "live" && d.active ? '<span class="dot live" aria-hidden="true"></span> ' : ""}${esc(sub[k])}</span>` : ""}</span>
          ${k === "moments" && open ? `<span class="ws-count" aria-hidden="true">${open}</span>` : ""}</a></li>`).join("")}</ul>`;
    }

    // The live class is mounted once and only hidden while the student reads another section.
    function ensureLive() {
      const a = W.d.active;
      if (W.live && (!a || W.live.sid !== a.id) && W.liveStatus !== "ended") { /* keep an ended class on screen until they leave */ }
      if (!a || (W.live && W.live.sid === a.id)) return;
      W.live?.destroy();
      W.liveStatus = "";
      W.live = mountLive($("#wsLive"), a.id, { courseId: W.id, onUpdate: onLive });
    }
    let mineN = -1;
    function onLive(u) {
      W.lastLine = u.last; W.liveStatus = u.status;
      if (u.mine.length !== mineN) {
        if (mineN !== -1) load().then(paintNav).catch(() => {});
        mineN = u.mine.length;
      }
      paintNow();
    }
    // "Class now": while class is live and the student is in another section, the newest line and a way back.
    function paintNow() {
      const el = $("#wsNow"), on = !!W.live && W.liveStatus === "live" && W.section !== "live";
      el.hidden = !on;
      if (!on) return;
      el.innerHTML = `<span class="cn-k"><span class="dot live" aria-hidden="true"></span> Class now</span>
        <span class="cn-line">${W.lastLine ? esc(W.lastLine) : "Listening…"}</span>
        <a class="button gold cn-btn" href="#/course/${W.id}/live">Return to live</a>`;
    }

    async function show(a, params = {}) {
      let [, section = "overview", x, y] = a;
      if (params.s) W.sel = params.s;
      ensureLive();
      if (!sections().includes(section)) { location.replace(`#/course/${W.id}`); return; }
      // A live class is entered once per tab; after that, Overview is where the course opens.
      if (section === "overview" && W.d.active?.status === "live" && !W.section && enterLive(W.d.active.id, W.id)) return;
      const same = W.section === section;
      W.section = section;
      paintNav(); paintNow();
      $("#wsLive").hidden = section !== "live";
      $("#wsSection").hidden = section === "live";
      if (section === "live") { document.title = `${c.code} live · Lost`; W.live?.focus(); window.scrollTo(0, 0); return; }
      if (!(same && section === "moments")) { W.sc?.dispose(); W.sc = Lost.scope(); }
      // While class is live, help cards and topics arrive after the tap: reload before drawing a new section.
      if (W.live && !same) { try { await load(); W.ev.clear(); paintNav(); } catch {} }
      const el = $("#wsSection");
      await SECT[section](el, x, y, same);
      if (!(same && section === "moments")) {
        const h1 = el.querySelector("h1");
        if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); document.title = `${h1.textContent} · ${c.code} · Lost`; }
        window.scrollTo(0, 0);
      }
    }

    // ---------- overview ----------
    function overview(el) {
      const d = W.d, s = d.stats, open = d.history.filter((h) => !isResolved(h));
      const last = endedSessions()[0];
      el.innerHTML = `
        <header class="ov-head">
          <div class="ov-cover">${Lost.courseArt(c.art, c.id)}</div>
          <div class="ov-title"><p class="cc-code">${esc(c.code)}${c.section ? ` · ${esc(c.section)}` : ""}${c.term ? ` · ${esc(c.term)}` : ""}</p><h1>${esc(c.name)}</h1></div>
        </header>
        ${d.active ? `<a class="live-banner" href="#/course/${W.id}/live"><span class="dot live" aria-hidden="true"></span><span><b>Class is live now</b><span>Enter the live class</span></span></a>` : ""}
        <dl class="ov-stats">
          <div><dt>Unresolved moments</dt><dd>${open.length ? `<a href="#/course/${W.id}/moments">${open.length}</a>` : "0"}</dd></div>
          <div><dt>You said you got it</dt><dd>${s.resolved}</dd></div>
          <div><dt>Practice checks passed</dt><dd>${s.checksPassed}${s.checksAnswered ? `<span class="of"> of ${s.checksAnswered}</span>` : ""}</dd></div>
          <div><dt>Last class</dt><dd class="dd-date">${last ? esc(day(last.started_at)) : "None yet"}</dd></div>
        </dl>
        <div class="ov-grid">
          <section class="ov-block" aria-labelledby="ovOpen"><h2 id="ovOpen">Still open</h2>
            ${open.length ? `<ul class="ov-open">${open.slice(0, 4).map((h) => `<li><a href="#/course/${W.id}/moments/${h.id}"><span class="ov-o-t">${esc(h.topic || h.line || "Your moment")}</span><span class="note">${esc(day(h.started_at))} at ${fmt(h.t)}</span></a></li>`).join("")}</ul>
              ${open.length > 4 ? `<p><a href="#/course/${W.id}/moments">All ${open.length} open moments</a></p>` : ""}`
              : `<p class="empty-line">${d.history.length ? "Nothing open. Every moment you marked is cleared." : "No lost moments yet. When a line loses you in class, tap it and it lands here."}</p>`}
          </section>
          <section class="ov-block" aria-labelledby="ovLast"><h2 id="ovLast">Last time</h2>
            ${W.me.recap?.idea ? `<p class="ov-recap">${esc(W.me.recap.idea)}</p><p><a href="#/course/${W.id}/summary?s=${last?.id || ""}">Read the class summary</a></p>`
              : `<p class="empty-line">${last ? "The summary for the last class isn't published yet." : "No class has finished yet."}</p>`}
          </section>
        </div>
        <section class="ov-block" aria-labelledby="ovClasses"><h2 id="ovClasses">Classes</h2>
          ${d.sessions.length ? `<ol class="sess-list">${d.sessions.map((x) => sessRow(x)).join("")}</ol>` : `<p class="empty-line">No classes yet. When your professor starts one, it shows here and you go in by yourself.</p>`}
        </section>`;
    }
    const sumWord = (x) => x.summary === "ready" && x.published ? "Summary ready" : x.summary === "ready" ? "Summary not shared yet" : x.summary === "transcript_only" ? "Transcript only" : x.summary === "failed" ? "No summary" : "Summary being written";
    const sessRow = (x) => {
      const live = x.status === "live" || x.status === "ending";
      return `<li class="${live ? "is-live" : ""}"><a href="${live ? `#/course/${W.id}/live` : `#/course/${W.id}/summary?s=${x.id}`}">
        <span class="sess-date">${esc(dayTime(x.started_at))}</span>
        <span class="sess-st">${live ? `<span class="badge live">Live now</span>` : esc(sumWord(x))}</span>
        <span class="sess-me note">${x.my_taps ? `You marked ${x.my_taps}` : ""}</span></a></li>`;
    };

    // ---------- my lost moments: list + one moment's detail ----------
    async function moments(el, evId, tab = "explain", same = false) {
      const d = W.d;
      if (!TABS.some(([k]) => k === tab)) tab = "explain";
      const list = [...d.history].sort((a, b) => (isResolved(a) - isResolved(b)) || String(b.started_at).localeCompare(String(a.started_at)) || b.t - a.t);
      const shown = list.filter((h) => W.mmFilter === "all" || (W.mmFilter === "open" ? !isResolved(h) : isResolved(h)));
      const open = list.filter((h) => !isResolved(h)).length;
      const countText = `${open ? `${plural(open, "unresolved moment")} · ` : ""}${plural(list.length, "moment")} in total. Only you see these.`;
      const item = (h) => `<li><a class="mm-item${h.id === evId ? " on" : ""}" href="#/course/${W.id}/moments/${h.id}"${h.id === evId ? ' aria-current="true"' : ""}>
          <span class="mm-top">${stateChip(h)}<time>${esc(day(h.started_at))} · ${fmt(h.t)}</time></span>
          <span class="mm-topic">${esc(h.topic || h.line || h.interim_text || "Your moment")}</span>
          <span class="mm-prev">${esc(preview(h))}</span></a></li>`;
      if (!same || !$("#mmList")) {
        el.innerHTML = `<div class="mm-headrow"><h1>My lost moments</h1>
            <p class="note" id="mmCount">${countText}</p></div>
          <div class="mm-filter" role="group" aria-label="Show">${[["all", "All"], ["open", "Unresolved"], ["done", "Understood"]].map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${W.mmFilter === k}">${t}</button>`).join("")}</div>
          <div class="mm${evId ? " has-detail" : ""}">
            <ol class="mm-list" id="mmList" aria-label="Your moments">${shown.map(item).join("") || `<li class="empty-line">Nothing here.</li>`}</ol>
            <section class="mm-detail" id="mmDetail" aria-label="Moment detail"></section>
          </div>`;
        el.querySelector(".mm-filter").addEventListener("click", (e) => {
          const b = e.target.closest("button[data-f]"); if (!b) return;
          W.mmFilter = b.dataset.f; moments(el, evId, tab, false);
        });
      } else {
        // Same section: redraw only the list (states may have changed) and keep its scroll position.
        const ol = $("#mmList"), top = ol.scrollTop;
        ol.innerHTML = shown.map(item).join("") || `<li class="empty-line">Nothing here.</li>`;
        ol.scrollTop = top;
        $("#mmCount").textContent = countText;
        el.querySelector(".mm").classList.toggle("has-detail", !!evId);
      }
      const box = $("#mmDetail");
      if (!evId) { box.innerHTML = `<p class="mm-pick">Pick a moment to see its explanation, the context it came from, a practice question and its sources.</p>`; return; }
      const h = list.find((x) => x.id === evId);
      if (!h) { box.innerHTML = `<p class="empty-line">That moment isn't in this course.</p>`; return; }
      const prevTab = box.dataset.ev === evId ? box.dataset.tab : "";
      if (!W.ev.has(evId)) { box.innerHTML = `<p class="note loading">Loading…</p>`; W.ev.set(evId, await api(`/api/student/events/${evId}`)); }
      paintDetail(box, h, W.ev.get(evId), tab);
      box.dataset.ev = evId; box.dataset.tab = tab;
      if (prevTab && prevTab !== tab) $(`#tab-${tab}`)?.focus();
      else { $("#mmH")?.focus({ preventScroll: matchMedia("(min-width: 1000px)").matches }); if (!matchMedia("(min-width: 1000px)").matches) box.scrollIntoView({ block: "start" }); }
      document.title = `${h.topic || "Your moment"} · ${c.code} · Lost`;
    }
    const preview = (h) => {
      const p = h.card?.payload;
      return p?.takeaway?.text || p?.explanation?.text || (h.topic ? h.line || "" : "No explanation yet");
    };

    function paintDetail(box, h, dt, tab) {
      const base = `#/course/${W.id}/moments/${h.id}`;
      const cards = dt.cards.filter((k) => k.payload);
      const main = cards.find((k) => k.kind === "explain") || cards[0] || null;
      const parts = main && main.payload.ai !== false ? Lost.lessonParts(main.payload, { helpId: main.id, headingLevel: 3, showTitle: false }) : null;
      box.innerHTML = `
        <a class="mm-back" href="#/course/${W.id}/moments">All moments</a>
        <div class="mm-sticky">
          <p class="mm-meta">${stateChip({ ...h, self_status: dt.event.status, checkPassed: dt.checkPassed })}<span>Class on ${esc(day(dt.session?.started_at))} at ${fmt(dt.event.t)}</span></p>
          <h2 id="mmH" tabindex="-1">${esc(dt.event.topic || "Your moment")}</h2>
          <div class="mm-tabs" role="tablist" aria-label="Review this moment">${TABS.map(([k, t]) => `<a role="tab" id="tab-${k}" href="${base}/${k}" aria-selected="${k === tab}" aria-controls="mmPanel" tabindex="${k === tab ? 0 : -1}">${t}</a>`).join("")}</div>
        </div>
        ${dt.line ? `<blockquote class="lost-line"><span class="visually-hidden">The line you marked: </span>"${esc(dt.line.text)}"</blockquote>` : dt.event.interim ? `<blockquote class="lost-line">"${esc(dt.event.interim)}…" <span class="note">(half-heard)</span></blockquote>` : ""}
        <div class="mm-panel" role="tabpanel" id="mmPanel" aria-labelledby="tab-${tab}" tabindex="0">${PANEL[tab](h, dt, main, parts, cards)}</div>`;
      // Tabs: arrow keys move between them (and open them), like any tab list.
      box.querySelector(".mm-tabs").addEventListener("keydown", (e) => {
        const tabs = $$('.mm-tabs [role="tab"]'), i = tabs.indexOf(document.activeElement);
        const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
        if (j == null || i < 0) return;
        e.preventDefault();
        const t = tabs[(j + tabs.length) % tabs.length];
        location.replace(t.getAttribute("href"));
      });
      box.querySelectorAll('.mm-tabs [role="tab"]').forEach((t) => t.addEventListener("click", (e) => { e.preventDefault(); location.replace(t.getAttribute("href")); }));
      wireDetail(box, h, dt);
    }

    const PANEL = {
      explain: (h, dt, main, parts, cards) => {
        if (!main) return `<p>No explanation was made for this moment yet.</p><button class="primary" data-do="explain">Get an explanation</button><p class="note">It uses what was said around your tap and the course notes.</p>`;
        if (!parts) return `<p class="note">${esc(main.payload.reason === "off" ? "The AI helper was off for this one." : "The AI helper couldn't answer this one.")} Here's what was transcribed and what the notes say.</p>
          ${main.payload.passages?.length ? `<div class="excerpt"><span class="label">From course materials</span>${main.payload.passages.map((x) => `<p><b>${esc(x.title)}</b>${x.location ? `, ${esc(x.location)}` : ""}<br>${esc(x.text)}</p>`).join("")}</div>` : ""}`;
        const others = cards.filter((k) => k !== main && k.payload.ai !== false);
        const KIND = { retry: "Another way you saw it", simpler: "The simpler version", prereq: "The idea underneath", steps: "The steps" };
        return `<div class="lesson tab-lesson">${parts.explain}${parts.rule}${parts.example}
            ${parts.more ? `<details class="lesson-more"><summary>Explain more</summary><div class="lesson-more-body">${parts.more}</div></details>` : ""}</div>
          ${others.map((k) => `<details class="mm-other"><summary>${KIND[k.kind] || "Another explanation"}</summary>${Lost.lesson(k.payload, { headingLevel: 4, helpId: k.id })}</details>`).join("")}
          <p class="mm-next"><a href="#/course/${W.id}/moments/${h.id}/check">Check you've got it</a></p>`;
      },
      context: (h, dt, main, parts) => `
        ${dt.context.length ? `<figure class="ctx"><figcaption>What was said around your moment</figcaption><ol class="ctx-lines">${dt.context.map((l) => `<li class="${l.idx === dt.line?.idx ? "mine" : ""}"><time>${fmt(l.t)}</time><span>${esc(l.text)}</span>${l.idx === dt.line?.idx ? '<span class="visually-hidden"> (the line you marked)</span>' : ""}</li>`).join("")}</ol></figure>`
          : `<p class="note">No transcript was caught near this moment.</p>`}
        ${parts?.connection || ""}
        ${parts?.visual || ""}
        ${parts ? (parts.p.illustration ? parts.illustration() : `<p class="note illo-none">${parts.visual ? "No AI picture for this one: the diagram shows it better than a drawing would." : "No diagram or picture for this one: the explanation covers it in words."}</p>`) : ""}`,
      check: (h, dt) => {
        const st = dt.event.status;
        const done = dt.checks.filter((k) => k.chosen != null || k.skipped);
        const pending = dt.checks.filter((k) => k.chosen == null && !k.skipped);
        const draft = W.drafts[h.id] ?? dt.officeHours ?? ohDraft(h, dt);
        return `<section class="chk-status" aria-labelledby="chkS"><h3 id="chkS">Where you are</h3>
            <p>${st === "resolved" ? "You said you've got this one." : st === "still" ? "You said you're still unsure." : "You haven't said yet whether this makes sense."} ${dt.checkPassed ? "You also answered a practice question on it correctly." : ""}</p>
            <p class="note">Only these buttons change it. Reading, closing or switching tabs never marks a moment understood.</p>
            <div class="row">${st === "resolved" ? `<button data-do="still">I'm unsure again</button>` : `<button class="primary" data-do="resolved">I get it now</button>${st !== "still" ? `<button data-do="still">Still unsure</button>` : ""}`}</div>
          </section>
          <section aria-labelledby="chkQ"><h3 id="chkQ">Practice question</h3>
            ${done.map((k) => checkDone(k)).join("")}
            ${pending.map((k) => checkForm(k)).join("")}
            ${dt.checks.filter((k) => k.kind === "comprehension").length < 3 ? `<button data-do="newcheck">${done.length || pending.length ? "Another question" : "Try a question"}</button><p class="note">A new example on the same idea, written by the AI. Not graded.</p>` : `<p class="note">That's three questions for this moment.</p>`}
          </section>
          ${!isResolved({ self_status: st }) ? `<details class="oh"${W.drafts[h.id] != null ? " open" : ""}><summary>Prepare an office-hours question</summary>
            <label for="oh-${h.id}">Edit it before you use it. Lost doesn't send it to anyone.</label><textarea id="oh-${h.id}" rows="5">${esc(draft)}</textarea>
            <div class="row"><button data-do="oh">Save</button><button data-do="copy">Copy</button></div></details>` : ""}`;
      },
      sources: (h, dt, main, parts, cards) => `
        ${cards.filter((k) => k.payload.ai !== false).map((k, i) => { const x = Lost.lessonParts(k.payload, { helpId: k.id }); return `${cards.length > 1 ? `<h3>${i === 0 ? "First explanation" : `Explanation ${i + 1}`}</h3>` : ""}${x.sourcesHtml}`; }).join("") || `<p class="note">No explanation, so no sources yet.</p>`}
        ${dt.session ? `<p><a href="#/course/${W.id}/summary?s=${dt.session.id}">The class summary for ${esc(day(dt.session.started_at))}</a></p>` : ""}`,
    };
    const checkDone = (k) => `<div class="chk-done"><p class="chk-q">${esc(k.question)}</p>${k.skipped ? `<p class="note">Skipped.</p>` : `<p><span class="badge ${k.correct ? "good" : "warn"}">${k.correct ? "Right" : "Not quite"}</span> You chose "${esc(k.choices[k.chosen])}". ${k.correct ? "" : `The answer: "${esc(k.choices[k.correctIndex])}".`} ${esc(k.why || "")}</p>`}</div>`;
    const checkForm = (k) => `<form class="check" data-check="${k.id}"><fieldset><legend>${k.kind === "diagnostic" ? "Quick check on the idea underneath: " : ""}${esc(k.question)}</legend>
        ${k.choices.map((ch, i) => `<label class="choice"><input type="radio" name="c-${k.id}" value="${i}"> ${esc(ch)}</label>`).join("")}</fieldset>
        <div class="row"><button class="primary">Answer</button></div><p class="check-result" aria-live="polite"></p></form>`;
    function ohDraft(h, dt) {
      const card = dt.cards.find((k) => k.payload?.v === 2)?.payload;
      const src = card ? [card.takeaway, card.explanation, card.connection].filter(Boolean).flatMap((x) => x.sources || []).find((x) => x.type === "passage") : null;
      return `I got lost at ${fmt(dt.event.t)} in the ${when(dt.session?.started_at)} class${dt.event.topic ? `, on ${dt.event.topic}` : ""}.${dt.line ? ` You said: "${dt.line.text}"` : ""}${src ? ` The related material is ${src.title}${src.location ? `, ${src.location}` : ""}.` : ""}${dt.event.question ? ` My question: ${dt.event.question}` : " What I still don't get is: "}`;
    }
    function wireDetail(box, h, dt) {
      const refresh = async () => { W.ev.set(h.id, await api(`/api/student/events/${h.id}`)); await load(); paintNav(); };
      box.querySelector(`#oh-${h.id}`)?.addEventListener("input", (e) => { W.drafts[h.id] = e.target.value; });
      box.onclick = async (e) => {
        const b = e.target.closest("button[data-do]"); if (!b) return;
        const act = b.dataset.do;
        if (act === "resolved" || act === "still") {
          b.disabled = true;
          try { await api(`/api/student/events/${h.id}/status`, { method: "POST", body: { status: act } }); await refresh(); toast(act === "resolved" ? "Marked as understood." : "Kept open."); }
          catch (x) { toast(x.message, "error"); }
          return moments($("#wsSection"), h.id, "check", true);
        }
        if (act === "newcheck") {
          b.disabled = true; b.textContent = "Writing a question…";
          try { await api(`/api/student/events/${h.id}/check`, { method: "POST" }); await refresh(); } catch (x) { toast(x.message, "error"); }
          return moments($("#wsSection"), h.id, "check", true);
        }
        if (act === "explain") {
          b.disabled = true; b.textContent = "Explaining…";
          try { await api(`/api/student/events/${h.id}/help`, { method: "POST", body: { kind: "explain", anchor: "current" } }); await refresh(); } catch (x) { toast(x.message, "error"); }
          return moments($("#wsSection"), h.id, "explain", true);
        }
        if (act === "oh") { const ta = $(`#oh-${h.id}`); try { await api(`/api/student/events/${h.id}/office-hours`, { method: "POST", body: { text: ta.value } }); dt.officeHours = ta.value; toast("Saved. Lost doesn't send it anywhere."); } catch (x) { toast(x.message, "error"); } }
        if (act === "copy") { const ta = $(`#oh-${h.id}`); try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch { ta.select(); toast("Select and copy the text."); } }
      };
      box.onsubmit = async (e) => {
        const f = e.target.closest("form.check"); if (!f) return;
        e.preventDefault();
        const chosen = f.querySelector("input:checked"); if (!chosen) { f.querySelector(".check-result").textContent = "Pick an answer first."; return; }
        try { await api(`/api/student/checks/${f.dataset.check}/answer`, { method: "POST", body: { chosen: Number(chosen.value) } }); await refresh(); }
        catch (x) { f.querySelector(".check-result").textContent = x.message; return; }
        moments($("#wsSection"), h.id, "check", true);
      };
    }

    // ---------- practice: a quiz per class, and this course's flash cards ----------
    async function practice(el) {
      const withTaps = W.d.sessions.filter((s) => s.my_taps && s.status !== "ready");
      const sid = withTaps.some((s) => s.id === W.sel) ? W.sel : withTaps[0]?.id || "";
      el.innerHTML = `<h1>Practice</h1>
        <div class="pr-grid">
          <section class="panel" aria-labelledby="qzH"><h2 id="qzH">Quiz on your lost moments</h2>
            ${withTaps.length ? `<div class="pick-row"><label for="qzS">Class</label><select id="qzS">${withTaps.map((s) => `<option value="${s.id}"${s.id === sid ? " selected" : ""}>${esc(dayTime(s.started_at))} (${plural(s.my_taps, "moment")})</option>`).join("")}</select></div>
              <div id="quizBox"></div>` : `<p class="empty-line">No moments to practise yet. After you tap a line in class, questions on it show up here.</p>`}
          </section>
          <section class="panel" aria-labelledby="fcH"><h2 id="fcH">Flash cards</h2><div id="fcBox"><p class="note loading">Loading…</p></div></section>
        </div>`;
      if (sid) {
        const paintQuiz = (sidNow) => {
          const q = W.quiz[sidNow], box = $("#quizBox");
          if (!q) {
            box.innerHTML = `<p class="note">Up to 3 questions on the spots you marked in this class, each with a new example. Not a grade, and it doesn't change what you marked as understood.</p><button class="primary" id="startQuiz">Start the quiz</button>`;
            $("#startQuiz").onclick = async (e) => {
              e.target.disabled = true; e.target.textContent = "Writing questions…";
              const s = await api(`/api/student/sessions/${sidNow}`);
              const pick = [...s.events.filter((x) => x.status !== "resolved"), ...s.events.filter((x) => x.status === "resolved")].slice(0, 3);
              const qs = [];
              for (const ev of pick) { try { qs.push({ ev, q: await api(`/api/student/events/${ev.id}/check`, { method: "POST" }) }); } catch (x) { qs.push({ ev, err: x.message }); } }
              W.quiz[sidNow] = { qs, results: {} };
              if (W.section === "practice") paintQuiz(sidNow);
            };
            return;
          }
          box.innerHTML = q.qs.map(({ ev, q: k, err }, i) => err ? `<p class="note">Question ${i + 1} (${esc(ev.topic || fmt(ev.t))}): ${esc(err)}</p>` : quizForm(k, ev, i, q.results[k.id])).join("") + `<p class="note">New examples written by the AI.</p>`;
        };
        const quizForm = (k, ev, i, r) => `<form class="check" data-check="${k.id}"><fieldset${r ? " disabled" : ""}><legend><span class="lesson-label">${i + 1} · ${esc(ev.topic || `the spot at ${fmt(ev.t)}`)}</span><br>${esc(k.question)}</legend>
            ${k.choices.map((ch, j) => `<label class="choice${r ? (j === r.correctIndex ? " right" : j === r.chosen ? " wrong" : "") : ""}"><input type="radio" name="q-${k.id}" value="${j}"${r?.chosen === j ? " checked" : ""}> ${esc(ch)}</label>`).join("")}</fieldset>
            ${r ? "" : `<button class="primary">Answer</button>`}<p class="check-result" aria-live="polite">${r ? `<b>${r.correct ? "Right." : "Not quite."}</b> ${esc(r.why || "")}` : ""}</p></form>`;
        paintQuiz(sid);
        $("#qzS").onchange = (e) => { W.sel = e.target.value; paintQuiz(W.sel); };
        $("#quizBox").addEventListener("submit", async (e) => {
          const f = e.target.closest("form.check"); if (!f) return;
          e.preventDefault();
          const chosen = f.querySelector("input:checked"); if (!chosen) { f.querySelector(".check-result").textContent = "Pick an answer first."; return; }
          const s = $("#qzS").value;
          try { const r = await api(`/api/student/checks/${f.dataset.check}/answer`, { method: "POST", body: { chosen: Number(chosen.value) } }); W.quiz[s].results[f.dataset.check] = { ...r, chosen: Number(chosen.value) }; load().then(paintNav).catch(() => {}); paintQuiz(s); }
          catch (x) { f.querySelector(".check-result").textContent = x.message; }
        });
      }
      if (!W.flashData) W.flashData = await api("/api/student/flashcards");
      if (W.section !== "practice") return;
      const deck = W.flashData.decks.find((x) => x.course.id === W.id);
      W.flash = W.flash || { cards: (deck?.cards || []).map((k) => ({ ...k, code: c.code })), i: 0, flipped: false, known: new Set() };
      flashDeck($("#fcBox"), W.flash, W.sc);
    }

    // ---------- class summary for one finished class ----------
    async function summary(el) {
      const ended = endedSessions(), sid = selSession();
      el.innerHTML = `<div class="page-head"><h1>Class summary</h1>
          ${ended.length > 1 ? `<div class="pick-row"><label for="sumS">Class</label><select id="sumS">${ended.map((s) => `<option value="${s.id}"${s.id === sid ? " selected" : ""}>${esc(dayTime(s.started_at))}</option>`).join("")}</select></div>` : ""}</div>
        <div id="sumBody"><p class="note loading">Loading…</p></div>`;
      $("#sumS")?.addEventListener("change", (e) => { location.hash = `#/course/${W.id}/summary?s=${e.target.value}`; });
      const draw = async () => {
        const d = await api(`/api/student/sessions/${sid}`);
        if (W.section !== "summary" || selSession() !== sid) return d.summaryState;
        $("#sumBody").innerHTML = `
          <p class="note sum-when">${esc(dayTime(d.session.started_at))}${d.session.title ? ` · ${esc(d.session.title)}` : ""}</p>
          <section class="panel sum-panel" aria-live="polite">${summaryBlock(d)}</section>
          ${d.events.length ? `<section class="panel"><h2>Your moments in this class</h2><ul class="sum-moments">${d.events.map((e) => `<li><a href="#/course/${W.id}/moments/${e.id}">${stateChip(e)}<span><time>${fmt(e.t)}</time> ${esc(e.topic || "Your moment")}</span></a></li>`).join("")}</ul></section>` : ""}`;
        return d.summaryState;
      };
      const st = await draw();
      if (st === "pending" || st === "not_ended") Lost.poll(async () => { const s = await draw(); if (s !== "pending" && s !== "not_ended") W.sc.dispose(); }, 5000, W.sc);
    }

    // ---------- course materials ----------
    function materials(el) {
      const d = W.d, groups = new Map();
      for (const m of d.materials) { const k = m.module || "Other"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
      const oh = safeUrl(d.course.office_hours_url), tut = safeUrl(d.course.tutoring_url);
      el.innerHTML = `<h1>Course materials</h1>
        ${oh || tut ? `<section class="panel"><h2>Help from people</h2><ul class="plain">${oh ? `<li><a href="${esc(oh)}" target="_blank" rel="noopener">Office hours</a></li>` : ""}${tut ? `<li><a href="${esc(tut)}" target="_blank" rel="noopener">Tutoring</a></li>` : ""}</ul></section>` : ""}
        ${d.materials.length ? `<p class="note">Only what your professor shared with students. Lost quotes these in explanations.</p>
          ${[...groups].map(([g, ms]) => `<section class="mat-group"><h2>${esc(g)}</h2><ul class="mat-list">${ms.map((m) => `<li>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : `<span>${esc(m.title)}</span>`}${m.kind ? ` <span class="tag">${esc(m.kind)}</span>` : ""}${m.source === "demo" ? ` <span class="tag">demo</span>` : ""}</li>`).join("")}</ul></section>`).join("")}`
          : `<p class="empty-line">Your professor hasn't shared any materials with students yet.</p>`}`;
    }

    const SECT = { overview, moments, practice, summary, materials };
    await show(args, params);
  }

  // ================= flash cards =================
  // One deck on one element. st holds the order and position, so leaving and coming back keeps the place.
  function flashDeck(el, st, scope) {
    const KIND = { lost: "You got lost here", idea: "Big idea", term: "Term" };
    el.innerHTML = st.cards.length ? `<div class="fc-wrap">
        <div class="fc-progress" aria-hidden="true"><i id="fcBar"></i></div>
        <div id="fcStage"></div>
        <div class="fc-controls">
          <button type="button" id="fcPrev">Back</button>
          <button type="button" id="fcAgain">Show again later</button>
          <button type="button" class="primary" id="fcKnow">I know this</button>
          <button type="button" id="fcNext">Next</button>
        </div>
        <p class="fc-foot"><span id="fcCount" aria-live="polite"></span><button type="button" class="quiet" id="fcShuffle">Shuffle</button></p>
      </div>` : `<p class="empty-line">No cards yet. They come from published class summaries and the lines you tap.</p>`;
    if (!st.cards.length) return;
    const draw = () => {
      const c = st.cards[st.i];
      $("#fcStage").innerHTML = `
        <button type="button" class="fc ${st.flipped ? "flipped" : ""} kind-${c.kind}" id="fcCard" aria-label="${st.flipped ? "Answer side. Press to see the question" : "Question side. Press to see the answer"}">
          <span class="fc-face fc-front">
            <span class="fc-top"><span class="fc-kind">${KIND[c.kind]}</span><span class="fc-code">${esc(c.code)}</span></span>
            <span class="fc-q">${esc(c.front)}</span>
            <span class="fc-hint">Tap to flip</span>
          </span>
          <span class="fc-face fc-back">
            <span class="fc-top"><span class="fc-kind">${esc(c.front)}</span><span class="fc-code">${esc(c.code)}</span></span>
            <span class="fc-a">${esc(c.back)}</span>
            ${c.visual ? `<span class="fc-vis">${Lost.visual(c.visual)}</span>` : ""}
          </span>
        </button>`;
      $("#fcCount").textContent = `${st.i + 1} of ${st.cards.length}${st.known.size ? ` · ${st.known.size} known` : ""}`;
      $("#fcBar").style.width = `${(100 * (st.i + 1)) / st.cards.length}%`;
      $("#fcCard").addEventListener("click", () => { st.flipped = !st.flipped; draw(); $("#fcCard").focus(); });
    };
    const go = (n) => { st.i = (st.i + n + st.cards.length) % st.cards.length; st.flipped = false; draw(); };
    $("#fcPrev").onclick = () => go(-1);
    $("#fcNext").onclick = () => go(1);
    $("#fcKnow").onclick = () => { st.known.add(st.cards[st.i].front); go(1); };
    $("#fcAgain").onclick = () => { const c = st.cards.splice(st.i, 1)[0]; st.cards.push(c); st.i %= st.cards.length; st.flipped = false; draw(); };
    $("#fcShuffle").onclick = () => { for (let k = st.cards.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [st.cards[k], st.cards[j]] = [st.cards[j], st.cards[k]]; } st.i = 0; st.flipped = false; draw(); };
    const onKey = (e) => {
      if (!el.isConnected || el.closest("[hidden]") || e.target.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    (scope ? scope.add : Lost.onLeave)(() => document.removeEventListener("keydown", onKey));
    draw();
  }
  async function flashPage(app) {
    const { decks } = await api("/api/student/flashcards");
    const st = { cards: decks.flatMap((d) => d.cards.map((c) => ({ ...c, code: d.course.code }))), i: 0, flipped: false, known: new Set() };
    app.innerHTML = `<p class="crumb"><a href="#/">Your classes</a></p><h1>Flash cards from every class</h1><div id="fcAll"></div>`;
    flashDeck($("#fcAll"), st, null);
  }

  // ================= live class =================
  // Mounted once per workspace and kept while the student moves between sections, so the transcript
  // poll, the audio relay and any open help stay as they are. sc holds everything to stop on destroy.
  function mountLive(app, sid, opts = {}) {
    const sc = Lost.scope();
    const st = { status: "", now: "", lines: [], since: 0, rev: -1, ai: true, clock: 0, lastIdx: null, mine: [], rendered: 0, unseen: 0 };
    const H = { ev: null, phrases: [], picked: null, cards: [], busy: false, catchups: 0, tries: {}, seq: 0, state: "closed", title: "" };
    const helpW = (() => { try { return Number(localStorage.getItem("lost-help-w")) || 420; } catch { return 420; } })();
    app.innerHTML = `
      <div class="live2" id="live2" data-help="closed" style="--help-w:${helpW}px">
        <header class="live-top">
          <div class="live-title"><h1 id="roomTitle" tabindex="-1">Class</h1></div>
          <div class="live-status" role="status"><span class="dot" id="dot"></span><span id="statusText">Connecting…</span><b id="clock" class="clock"></b></div>
          <div class="live-tools">
            <button id="momentsBtn" class="tool" aria-haspopup="dialog" aria-label="My moments"><span class="mlabel">My moments</span> <span id="momentsN" class="count" hidden></span></button>
            <button id="listen" class="tool" disabled>Listen</button>
            <button id="skeys" class="tool" aria-haspopup="dialog" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button>
          </div>
        </header>
        <section class="tcol" aria-labelledby="tH">
          <h2 id="tH" class="visually-hidden">Live transcript</h2>
          <div id="tlines" class="tlines2" tabindex="0" aria-label="Live transcript. Tap a line that lost you."></div>
          <button id="jump" class="jump" hidden>Return to live</button>
          <div class="lostbar">
            <button class="lostbtn2" id="lost" disabled aria-describedby="ack"><span class="lost-main">I'm lost</span></button>
            <p id="ack" class="ack" aria-live="polite">Anonymous. Class keeps going.</p>
          </div>
        </section>
        <aside class="hcol" id="hcol" aria-labelledby="helpH" hidden>
          <div class="resizer" id="resizer" role="separator" aria-orientation="vertical" aria-label="Resize help panel" tabindex="0" aria-valuemin="300" aria-valuemax="760" aria-valuenow="${helpW}"></div>
          <div class="sheet-head">
            <h2 id="helpH" tabindex="-1">Help</h2>
            <button class="quiet" id="minHelp" aria-label="Minimize help (Esc)">Minimize</button>
            <button class="quiet" id="closeHelp" aria-label="Close help without marking it understood">Close</button>
          </div>
          <div id="help" class="help-body"></div>
        </aside>
        <button id="helpPill" class="help-pill" hidden></button>
        <div id="snack" class="snack" role="status" hidden></div>
        <audio id="relayAudio"></audio>
        <p id="listenNote" class="visually-hidden" aria-live="polite"></p>
      </div>`;
    const live2 = $("#live2"), box = $("#tlines");

    // ---------- help panel states: open, minimized, closed ----------
    const setHelp = (state) => {
      H.state = state;
      live2.dataset.help = state;
      $("#hcol").hidden = state !== "open";
      $("#helpPill").hidden = state !== "min";
      if (state === "min") $("#helpPill").innerHTML = `<span class="pill-dot" aria-hidden="true"></span><span>Help: ${esc(H.title || "your moment")}</span><b>Open</b>`;
    };
    $("#minHelp").onclick = () => { setHelp("min"); $("#helpPill").focus(); };
    $("#closeHelp").onclick = () => { setHelp("closed"); $("#lost").focus(); }; // stays open in My moments; not resolved
    $("#helpPill").onclick = () => { setHelp("open"); $("#helpH").focus(); };

    // resizable panel (pointer drag, or arrow keys on the handle)
    const setW = (w) => { w = Math.max(300, Math.min(760, Math.round(w))); live2.style.setProperty("--help-w", `${w}px`); $("#resizer").setAttribute("aria-valuenow", w); try { localStorage.setItem("lost-help-w", w); } catch {} };
    $("#resizer").addEventListener("pointerdown", (e) => {
      const r = $("#resizer"); r.setPointerCapture(e.pointerId);
      const move = (m) => setW(live2.getBoundingClientRect().right - m.clientX);
      const up = () => { r.removeEventListener("pointermove", move); r.removeEventListener("pointerup", up); };
      r.addEventListener("pointermove", move); r.addEventListener("pointerup", up);
    });
    $("#resizer").addEventListener("keydown", (e) => {
      const w = Number($("#resizer").getAttribute("aria-valuenow"));
      if (e.key === "ArrowLeft") { setW(w + 40); e.preventDefault(); }
      if (e.key === "ArrowRight") { setW(w - 40); e.preventDefault(); }
    });

    // ---------- transcript: append only, never steal the scroll ----------
    const nearBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const lineHtml = (l) => `<p class="tline${H.ev && (H.picked?.idx === l.idx) ? " picked" : ""}" data-idx="${l.idx}"><time>${fmt(l.t)}</time><span>${esc(l.text)}</span></p>`;
    // A time that repeats the line above it says nothing new; keep it for screen readers only.
    function markRepeatTimes() {
      let prev = "";
      box.querySelectorAll(".tline time").forEach((t) => { const v = t.textContent; t.classList.toggle("same", v === prev && v !== "now"); prev = v; });
    }
    function paintLines(full) {
      const stick = nearBottom();
      const lines = st.lines.filter(Boolean);
      if (full) { box.innerHTML = ""; st.rendered = 0; }
      const fresh = lines.filter((l) => l.idx >= st.rendered);
      $("#saying")?.remove();
      if (!lines.length && !st.now) { box.innerHTML = `<p class="note empty-t" id="emptyT">${st.status === "live" ? "Listening… words show up here as your professor talks." : "Waiting for class to start."}</p>`; return; }
      $("#emptyT")?.remove();
      if (fresh.length) { box.insertAdjacentHTML("beforeend", fresh.map(lineHtml).join("")); st.rendered = Math.max(...lines.map((l) => l.idx)) + 1; }
      if (st.now) box.insertAdjacentHTML("beforeend", `<p class="tline saying" id="saying"><time>now</time><span>${esc(st.now)}</span></p>`);
      markRepeatTimes();
      if (stick || full) { box.scrollTop = box.scrollHeight; st.unseen = 0; }
      else if (fresh.length) st.unseen += fresh.length;
      paintJump();
    }
    // "Return to live" shows whenever the student has scrolled away from the newest line.
    const paintJump = () => {
      const away = !nearBottom() && box.scrollHeight > box.clientHeight;
      $("#jump").hidden = !away;
      $("#jump").textContent = st.unseen ? `${st.unseen} new line${st.unseen === 1 ? "" : "s"} · Return to live` : "Return to live";
    };
    box.addEventListener("scroll", () => { if (nearBottom()) st.unseen = 0; paintJump(); }, { passive: true });
    const jumpLive = () => { box.scrollTo({ top: box.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); st.unseen = 0; $("#jump").hidden = true; };
    $("#jump").onclick = jumpLive;
    // Tapping a line marks it: "this is where I got lost".
    box.addEventListener("click", async (e) => {
      const p = e.target.closest(".tline[data-idx]"); if (!p || st.status !== "live" || H.busy) return;
      if (window.getSelection()?.toString()) return; // they were selecting text
      const ok = await tap(); if (!ok) return;
      const idx = Number(p.dataset.idx);
      H.phrases = H.phrases.some((x) => x.idx === idx) ? H.phrases : [...H.phrases, st.lines[idx]].filter(Boolean);
      explain("phrase", idx);
    });

    // ---------- tap ----------
    async function tap() {
      if (H.busy) return false;
      navigator.vibrate?.(30);
      try {
        const r = await api(`/api/student/sessions/${sid}/lost`, { method: "POST" });
        const same = H.ev?.id === r.event.id;
        if (!same) Object.assign(H, { ev: r.event, phrases: r.phrases, now: r.now || null, cards: [], picked: null, catchups: 0, tries: {}, seq: H.seq + 1, title: "" });
        H.gaps = r.gaps; st.ai = r.ai;
        $("#ack").textContent = `Marked at ${fmt(r.event.t)}${r.others ? ` · ${r.others} other${r.others === 1 ? "" : "s"} too` : ""}`;
        return true;
      } catch (e) { toast(e.message, "error"); return false; }
    }
    $("#lost").onclick = async () => { if (await tap()) showPicker(); };

    // Step 1: what lost you? One tap is enough; everything else is optional.
    function showPicker() {
      H.title = "Which line lost you?";
      $("#helpH").textContent = H.title;
      $("#help").innerHTML = `
        ${H.gaps?.length ? `<p class="note warn">Some audio is missing from the last minute.</p>` : ""}
        <div class="phrase-list" role="group" aria-label="Recent lines from the lecture">
          ${H.phrases.map((p) => `<button class="phrase" data-line="${p.idx}"><time>${fmt(p.t)}</time>${esc(p.text)}</button>`).join("")}
          ${H.now ? `<button class="phrase phrase-now" data-now><span class="now-label">Right now</span>${esc(H.now)}…</button>` : ""}
          ${!H.phrases.length && !H.now ? `<p class="note">Nothing has been transcribed yet.</p>` : ""}
        </div>
        <div class="row">
          <button class="primary" id="explainCurrent">${H.phrases.length ? "Explain the current topic" : "Get help"}</button>
          <button id="explainEarlier">It started earlier</button>
        </div>
        <details class="optional"><summary>Ask your own question</summary>
          <label for="q" class="visually-hidden">Your question</label><input id="q" maxlength="300" placeholder="What does … mean?">
        </details>`;
      setHelp("open"); $("#helpH").focus();
      $("#help").querySelectorAll(".phrase[data-line]").forEach((b) => b.addEventListener("click", () => explain("phrase", Number(b.dataset.line))));
      $("#help").querySelector(".phrase[data-now]")?.addEventListener("click", () => explain("current", null, { text: H.now }));
      $("#explainCurrent").onclick = () => explain($("#q").value.trim() ? "question" : "current");
      $("#explainEarlier").onclick = () => explain("earlier");
    }

    async function explain(anchor, line = null, picked = null) {
      const seq = H.seq;
      const body = { kind: "explain", anchor, line, question: $("#q")?.value.trim() || null };
      H.picked = picked || (line != null ? H.phrases.find((p) => p.idx === line) || st.lines[line] : null);
      box.querySelectorAll(".tline.picked").forEach((p) => p.classList.remove("picked"));
      if (line != null) box.querySelector(`.tline[data-idx="${line}"]`)?.classList.add("picked");
      H.title = "Getting help…"; $("#helpH").textContent = H.title;
      $("#help").innerHTML = `${H.picked ? `<p class="picked-quote">"${esc(H.picked.text)}"</p>` : ""}<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div><p class="note help-wait">Reading the lecture and notes…</p>`;
      setHelp("open");
      const r = await request(body);
      if (seq !== H.seq) return; // a newer tap replaced this one
      if (r) { H.cards = [r]; paintHelp(); } else { $("#help").innerHTML = `<p class="form-error">No help came back.</p><button data-h="again">Try again</button>`; }
    }
    async function request(body) {
      H.busy = true;
      try { return await api(`/api/student/events/${H.ev.id}/help`, { method: "POST", body }); }
      catch (e) { toast(e.message, "error"); return null; }
      finally { H.busy = false; }
    }

    // The card stays put while class continues; polling never redraws it.
    function paintHelp() {
      const first = H.cards[0]?.payload;
      H.title = (first?.v === 2 ? first.title : first?.topic) || "Here's help";
      $("#helpH").textContent = H.title;
      $("#help").innerHTML = `${H.cards.map((c, i) => cardHtml(c, i)).join("")}
        <div class="help-actions" id="helpActions">
          <button class="primary" data-h="helped">Got it</button>
          <div class="more-help" role="group" aria-label="More help">
            <button data-h="still">Still confused</button>
            ${st.ai ? `<button data-h="retry">Another way</button>` : ""}
            <button data-h="catchup">Catch me up</button>
          </div>
        </div>
        <div id="catchupBox" aria-live="polite"></div>
        <p class="note since" id="sinceTap"></p>
        <button class="quiet back-live" data-h="backlive">Back to live</button>`;
      paintSince();
    }
    const KICKER = { retry: "Another way to see it", simpler: "A simpler start", prereq: "The idea underneath" };
    function cardHtml(c, i) {
      const p = c.payload;
      const label = KICKER[c.kind] || "";
      if (!p) return `<p class="form-error">${esc(c.error || "No help came back.")}</p>`;
      if (p.ai === false) {
        return `<div class="card-block">${label ? `<p class="lesson-kicker">${label}</p>` : ""}
          <p class="note">${esc(c.error || "The AI helper is off on this server.")} Here is what the course notes say, and what was transcribed.</p>
          ${p.passages?.length ? `<div class="excerpt"><span class="label">From course materials</span>${p.passages.map((x) => `<p><b>${safeUrl(x.url) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</b>${x.location ? `, ${esc(x.location)}` : ""}<br>${esc(x.text)}</p>`).join("")}</div>` : `<p class="note">No matching course material.</p>`}
          ${p.excerpt?.length ? `<details class="excerpt-d"><summary>What was transcribed (may contain errors)</summary><div class="excerpt">${p.excerpt.map((l) => `<p class="${l.mine ? "mine" : ""}"><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("")}</div></details>` : ""}
          ${p.gaps?.length ? `<p class="note warn">Some audio near your tap is missing from the transcript.</p>` : ""}</div>`;
      }
      return `<div class="card-block" data-i="${i}">${Lost.lesson(p, { kicker: label, showTitle: i > 0, headingLevel: 3, helpId: c.id })}
        ${p.visualIssue ? `<p class="note vis-fail">The picture for this one didn't pass Lost's checks, so it's left out. <button class="linkish" data-h="retry">Try another explanation</button></p>` : ""}
        ${p.diagnostic ? `<details class="diag-d"><summary>Quick check: is it the idea underneath?</summary>${diagHtml(p.diagnostic)}</details>` : ""}</div>`;
    }
    const diagHtml = (d) => `<form class="check" data-check="${d.id}" data-kind="diagnostic"><fieldset><legend>${esc(d.question)}</legend>
      ${d.choices.map((ch, k) => `<label class="choice"><input type="radio" name="d-${d.id}" value="${k}"> ${esc(ch)}</label>`).join("")}</fieldset>
      <div class="row"><button class="primary">Answer</button><button type="button" class="quiet" data-skip>Skip</button></div><p class="check-result" aria-live="polite"></p></form>`;

    $("#help").addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-h]");
      if (b) return action(b.dataset.h, b);
      if (e.target.matches("button[data-skip]")) {
        const f = e.target.closest("form.check");
        await api(`/api/student/checks/${f.dataset.check}/answer`, { method: "POST", body: { skip: true } });
        f.innerHTML = `<p class="note">Skipped.</p>`;
      }
    });
    $("#help").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target.closest("form.check"); if (!f) return;
      const chosen = f.querySelector("input:checked"); if (!chosen) { f.querySelector(".check-result").textContent = "Pick an answer first."; return; }
      const r = await api(`/api/student/checks/${f.dataset.check}/answer`, { method: "POST", body: { chosen: Number(chosen.value) } }).catch((x) => ({ error: x.message }));
      if (r.error) { f.querySelector(".check-result").textContent = r.error; return; }
      f.querySelectorAll("input,button").forEach((x) => (x.disabled = true));
      f.querySelectorAll("label.choice").forEach((l, k) => { if (k === r.correctIndex) l.classList.add("right"); else if (l.contains(chosen)) l.classList.add("wrong"); });
      f.querySelector(".check-result").innerHTML = r.correct ? `<b>Right.</b> ${esc(r.why || "")}` : `<b>Not quite.</b> ${esc(r.why || "")}`;
      if (f.dataset.kind === "diagnostic" && !r.correct) {
        f.insertAdjacentHTML("beforeend", `<p class="note help-wait">Explaining ${esc(r.prerequisite || "the idea underneath")} first…</p>`);
        const c = await request({ kind: "prereq", attempt: 1 });
        if (c) { H.cards.push(c); paintHelp(); }
      }
    });

    // "Got it": the student says they understand. Save it, close the panel, give the transcript its room
    // back, and offer Undo for a few seconds. The moment and its help stay in My moments and the review.
    async function gotIt() {
      const ev = H.ev, cards = H.cards, title = H.title, picked = H.picked;
      let r;
      try { r = await api(`/api/student/events/${ev.id}/status`, { method: "POST", body: { status: "resolved" } }); }
      catch (e) { toast(e.message, "error"); return; }
      setHelp("closed");
      box.querySelectorAll(".tline.picked").forEach((p) => p.classList.remove("picked"));
      $("#lost").focus({ preventScroll: true });
      snack(`Saved to My moments as understood.`, "Undo", async () => {
        await api(`/api/student/events/${ev.id}/status`, { method: "POST", body: { status: r.previous || "open" } });
        Object.assign(H, { ev, cards, title, picked }); paintHelp(); setHelp("open"); $("#helpH").focus();
      });
    }
    let snackT = null;
    function snack(msg, label, fn) {
      const s = $("#snack");
      s.innerHTML = `<span>${esc(msg)}</span>${label ? `<button class="linkish" id="snackBtn">${esc(label)}</button>` : ""}`;
      s.hidden = false; clearTimeout(snackT);
      $("#snackBtn")?.addEventListener("click", () => { s.hidden = true; fn(); }, { once: true });
      snackT = setTimeout(() => (s.hidden = true), 8000);
    }

    async function action(kind, btn) {
      if (kind === "helped") return gotIt();
      if (kind === "backlive") { setHelp("min"); jumpLive(); return; }
      if (kind === "again") return explain("current");
      if (kind === "retry" || kind === "still") {
        const ask = kind === "still" ? "simpler" : kind;
        if (kind === "still") await api(`/api/student/events/${H.ev.id}/status`, { method: "POST", body: { status: "still" } });
        if ((H.tries[ask] || 0) >= 3) { toast("That's three tries. This moment stays open, and it'll be in your review after class."); return; }
        const label = btn.textContent;
        btn.disabled = true; btn.textContent = kind === "retry" ? "Finding another way…" : "Starting simpler…";
        H.tries[ask] = (H.tries[ask] || 0) + 1;
        const c = await request({ kind: ask, attempt: H.tries[ask] });
        if (c) { H.cards.push(c); paintHelp(); $$("#help .card-block").at(-1)?.scrollIntoView({ block: "start" }); }
        else { btn.disabled = false; btn.textContent = label; H.tries[ask]--; }
      }
      if (kind === "catchup") {
        btn.disabled = true; btn.textContent = "Catching up…";
        const c = await request({ kind: "catchup", attempt: ++H.catchups });
        btn.disabled = false; btn.textContent = "Catch me up";
        if (!c) { H.catchups--; return; }
        const p = c.payload || {};
        $("#catchupBox").innerHTML = `<div class="catchup"><h3>Since you tapped (${fmt(p.since)} to ${fmt(p.until)})</h3>
          ${p.gaps?.length ? `<p class="note warn">No audio reached Lost for ${p.gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)}`).join(", ")}, so that part is missing.</p>` : ""}
          ${p.empty ? `<p>Nothing new has been said since your tap.</p>`
            : p.ai ? `<p>${esc(p.happened)}</p><p><b>Now:</b> ${esc(p.current_topic)}</p><p class="note">${esc(p.connection)}</p>`
            : `<p class="note">${p.thin ? "Only a little has been said since your tap, so here it is word for word:" : `${esc(c.error || "AI is off.")} The latest lines:`}</p><div class="excerpt">${(p.lines || []).map((l) => `<p><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("")}</div>`}</div>`;
      }
    }
    function paintSince() {
      const el = $("#sinceTap"); if (!el || !H.ev) return;
      const n = st.lastIdx == null ? 0 : st.lastIdx - (H.ev.line_idx ?? -1);
      el.textContent = st.status === "live" ? (n > 0 ? `${n} new line${n === 1 ? "" : "s"} since your tap` : "") : st.status === "ended" ? "Class has ended. This moment is in your review." : "";
    }

    // ---------- My moments (this class) ----------
    $("#momentsBtn").onclick = async () => {
      const v = await Lost.dialog({ opener: $("#momentsBtn"), title: "My moments in this class",
        body: st.mine.length ? `<p class="note">Only you see these. Open one to read its help again.</p><ul class="moments">${st.mine.map((m) => `<li><button value="${esc(m.id)}" class="moment-btn" form="dlgForm"><time>${fmt(m.t)}</time><span>${esc(m.topic || "Your moment")}</span><span class="badge ${m.self_status === "resolved" ? "good" : ""}">${m.self_status === "resolved" ? "Understood" : m.self_status === "still" ? "Still confused" : "Open"}</span></button></li>`).join("")}</ul>`
          : `<p>No moments yet. Tap I'm lost, or a line in the transcript, when something loses you.</p>`,
        buttons: [{ value: "", label: "Close", kind: "primary", focus: !st.mine.length }] });
      if (v) openMoment(v);
    };
    async function openMoment(id) {
      try {
        const d = await api(`/api/student/events/${id}`);
        Object.assign(H, { ev: d.event, cards: d.cards, picked: d.line, phrases: d.line ? [d.line] : [], tries: {}, catchups: 0, seq: H.seq + 1 });
        if (d.cards.length) paintHelp(); else { H.title = d.event.topic || "Your moment"; $("#helpH").textContent = H.title; $("#help").innerHTML = `${d.line ? `<p class="picked-quote">"${esc(d.line.text)}"</p>` : ""}<p class="note">You marked this moment but didn't ask for help yet.</p><button class="primary" data-h="again">Explain it</button>`; }
        setHelp("open"); $("#helpH").focus();
      } catch (e) { toast(e.message, "error"); }
    }

    // ---------- keyboard ----------
    const onKey = (e) => {
      if (app.hidden) return; // shortcuts only while the live class is on screen
      const act = LostKeys.shortcutFor(e, { dialogOpen: !!document.querySelector("dialog[open]"), map: { l: "lost", j: "jump", escape: "min", "?": "keys" } });
      if (!act) return;
      if (act === "lost" && !$("#lost").disabled) { e.preventDefault(); $("#lost").click(); }
      if (act === "jump") { e.preventDefault(); jumpLive(); }
      if (act === "min" && H.state === "open") { e.preventDefault(); setHelp("min"); $("#helpPill").focus(); }
      if (act === "keys") { e.preventDefault(); keysDialog(); }
    };
    const keysDialog = () => Lost.dialog({ opener: $("#skeys"), title: "Keyboard shortcuts",
      body: `<dl class="keys-list"><div><dt><kbd>L</kbd></dt><dd>I'm lost</dd></div><div><dt><kbd>J</kbd></dt><dd>Jump to the newest line</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Minimize help</dd></div><div><dt><kbd>?</kbd></dt><dd>This list</dd></div></dl><p class="note">They pause while you type. Every one has a button too.</p>`,
      buttons: [{ value: "", label: "Close", kind: "primary", focus: true }] });
    $("#skeys").onclick = keysDialog;
    document.addEventListener("keydown", onKey);
    sc.add(() => document.removeEventListener("keydown", onKey));

    // ---------- poll ----------
    Lost.poll(async (signal) => {
      const d = await api(`/api/student/sessions/${sid}/live?lines=1&since=${st.since}&rev=${st.rev}`, { signal });
      if (d.status !== st.status) {
        st.status = d.status;
        $("#roomTitle").textContent = `${d.course.code} ${d.title || d.course.name}`;
        $("#dot").className = `dot ${d.status}`;
        $("#statusText").textContent = { ready: "Waiting to start", live: "Live", ending: "Ending", ended: "Class is over" }[d.status];
        $("#lost").disabled = d.status !== "live";
        if (d.status === "ended") $("#ack").innerHTML = `Class is over. <a href="#/course/${opts.courseId}/summary?s=${sid}">Your summary</a> will be ready soon, and your moments are in My lost moments.`;
      }
      st.clock = d.clock; st.lastIdx = d.lastIdx; st.ai = d.ai; st.mine = d.mine || [];
      $("#clock").textContent = d.status === "live" ? fmt(d.clock) : "";
      const mN = $("#momentsN"), grew = st.mine.length > Number(mN.textContent || 0);
      mN.textContent = st.mine.length; mN.hidden = !st.mine.length;
      if (grew) { mN.classList.remove("bump"); void mN.offsetWidth; mN.classList.add("bump"); }
      Lost.clearBackdrop?.(); // the live class stays plain so the transcript has the student's full attention
      if (d.lines) {
        const full = d.full && st.rev !== -1 && d.rev !== st.rev; // the professor fixed a line: redraw, keep position
        const keep = box.scrollTop;
        if (d.full) st.lines = [];
        for (const l of d.lines) st.lines[l.idx] = l;
        st.since = st.lines.length; st.rev = d.rev;
        const nowChanged = (d.now || "") !== st.now; st.now = d.now || "";
        if (d.lines.length || full || nowChanged || !st.rendered) { paintLines(full || !st.rendered); if (full) box.scrollTop = keep; }
      }
      paintSince();
      handleAudio(d);
      opts.onUpdate?.({ status: st.status, mine: st.mine, last: st.now || st.lines.filter(Boolean).at(-1)?.text || "" });
    }, 1000, sc);

    // ---------- listen (professor's audio through the server) ----------
    let wantSound = false, player = null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let lastAudio = null;
    $("#listen").onclick = () => { wantSound = !wantSound; if (!wantSound) stopPlayer(); else if (lastAudio) startPlayer(lastAudio); paintListen(); };
    function paintListen() {
      const ok = st.status === "live" && !!lastAudio;
      $("#listen").disabled = !ok;
      $("#listen").classList.toggle("on", wantSound && ok);
      $("#listen").setAttribute("aria-pressed", String(wantSound && ok));
      $("#listen").textContent = wantSound && ok ? "Listening" : "Listen";
      $("#listen").title = st.status !== "live" ? "" : !lastAudio ? "Your professor's microphone is off" : "Hear the class, about 2 seconds behind";
      $("#listenNote").textContent = $("#listen").title;
    }
    function handleAudio(d) {
      lastAudio = d.audio;
      if (d.status !== "live" || !d.audio) stopPlayer();
      else if (wantSound) { if (!player || player.id !== d.audio.id) startPlayer(d.audio); else player.latest = d.audio.seq; }
      paintListen();
    }
    function startPlayer(a) {
      stopPlayer();
      if (!window.MediaSource || !MediaSource.isTypeSupported('audio/webm; codecs="opus"')) { $("#listenNote").textContent = "This browser can't play the class audio. Try Chrome."; return; }
      const el = $("#relayAudio"), ms = new MediaSource();
      const p = { id: a.id, latest: a.seq, next: 1, sb: null, el, url: URL.createObjectURL(ms) };
      player = p; el.src = p.url;
      ms.addEventListener("sourceopen", async () => {
        p.sb = ms.addSourceBuffer('audio/webm; codecs="opus"'); p.sb.mode = "sequence";
        if (!(await append(p, 0))) return;
        p.next = Math.max(1, p.latest); pump(p);
      }, { once: true });
      el.play().catch(() => {});
    }
    async function append(p, n) {
      try {
        const r = await fetch(`/api/student/sessions/${sid}/audio?seq=${n}`, { cache: "no-store" });
        if (!r.ok || p !== player) return false;
        const buf = await r.arrayBuffer(); if (p !== player) return false;
        await new Promise((ok, no) => { p.sb.addEventListener("updateend", ok, { once: true }); p.sb.addEventListener("error", no, { once: true }); p.sb.appendBuffer(buf); });
        return true;
      } catch { return false; }
    }
    async function pump(p) {
      while (p === player) {
        if (p.next < p.latest - 20) p.next = p.latest;
        if (p.next <= p.latest) { await append(p, p.next); p.next++; } else await sleep(250);
        const b = p.el.buffered;
        if (b.length && b.end(b.length - 1) - p.el.currentTime > 3.5) p.el.currentTime = b.end(b.length - 1) - 0.8;
        if (p.el.paused && b.length) p.el.play().catch(() => {});
      }
    }
    function stopPlayer() { if (!player) return; const p = player; player = null; p.el.pause(); p.el.removeAttribute("src"); p.el.load(); URL.revokeObjectURL(p.url); }
    sc.add(stopPlayer);
    sc.add(() => { setHelp("closed"); $("#snack") && ($("#snack").hidden = true); });
    return { sid, destroy: sc.dispose, focus: () => $("#roomTitle")?.focus({ preventScroll: true }) };
  }
  function summaryBlock(d) {
    if (d.summaryState === "not_ended") return `<p class="note">Class hasn't finished yet.</p>`;
    if (!d.summary) return d.summaryState === "failed" ? `<p><span class="badge bad">Not available</span> The summary couldn't be written. Your professor can retry it. Your own moments are below.</p>` : `<p><span class="badge">Being written</span> This page updates by itself, and you'll get a notification.</p>`;
    if (d.summary.status === "transcript_only") return `${d.summary.empty ? `<p class="note">Nothing was transcribed in this class.</p>` : `<p class="note">No AI summary for this class (the AI was off). Here is the transcript.</p><details><summary>Transcript</summary><div class="excerpt">${(d.transcript || []).map((l) => `<p><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("")}</div></details>`}`;
    const s = d.summary.shared;
    return `<p class="note">Written by AI from today's lecture and notes. Each topic has its sources under Sources.</p>${Lost.sharedSummary(s)}
      ${d.summary.materials?.length ? `<h3>Course materials used</h3><ul>${[...new Map(d.summary.materials.map((m) => [m.title + "|" + (m.location === m.title ? "" : m.location), { ...m, location: m.location === m.title ? "" : m.location }])).values()].map((m) => `<li>${safeUrl(m.url) ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : esc(m.title)}${m.location ? `, ${esc(m.location)}` : ""}</li>`).join("")}</ul>` : ""}
      ${d.summary.gaps?.length ? `<p class="note warn">Parts of class weren't recorded: ${d.summary.gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "end" : fmt(g.to_t)}`).join(", ")}.</p>` : ""}`;
  }

  // shared summary renderer (same as the professor's preview)
  Lost.sharedSummary = (s) => !s ? "" : s.v === 2 ? Lost.summaryV2(s) : `<div class="summary">
    ${s.main_topics.map((x) => `<article><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p>${Lost.sources(x.sources)}</article>`).join("")}
    ${Lost.steps(s.flow)}
    ${s.concepts.length ? `<h3>Concepts</h3><dl class="terms">${s.concepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.definition)}</dd>`).join("")}</dl>` : ""}
    ${s.examples.length ? `<h3>Examples</h3>${s.examples.map((x) => `<p><span class="origin">${x.origin === "ai" ? "Written by the AI" : x.origin === "materials" ? "From course materials" : "From the lecture"}</span> ${esc(x.text)}</p>`).join("")}` : ""}
    ${s.deadlines.length ? `<h3>Deadlines mentioned</h3><ul>${s.deadlines.map((x) => `<li>${esc(x.text)}${Lost.sources(x.sources, "Source")}</li>`).join("")}</ul>` : ""}
  </div>`;

  const COURSE = /^\/course\/([\w-]+)(?:\/(live|moments|practice|summary|materials))?(?:\/([\w-]+))?(?:\/(explain|context|check|sources))?$/;
  Lost.boot("student", [
    [/^\/$/, home],
    [/^\/join\/([A-Za-z0-9]{4,10})$/, join],
    [COURSE, (app, [id, section, x, y], params) => workspace(app, [id, section || "overview", x, y], params), { key: (a) => a[0] }],
    [/^\/flashcards$/, flashPage],
    [/^\/live\/([\w-]+)$/, liveLink],
    [/^\/session\/([\w-]+)(?:#ev-([\w-]+))?$/, sessionLink],
  ]);
})();
