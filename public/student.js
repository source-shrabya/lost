// Student portal: classes, joining, the live "I'm lost" flow, and after-class summaries.
(function () {
  const { $, $$, esc, fmt, when, ago, api, toast, safeUrl } = Lost;

  // Send a student straight into a class the moment it is live. Each live class is entered automatically
  // once per browser tab, so pressing back to "Your classes" doesn't bounce them in again.
  const entered = (() => { try { return new Set(JSON.parse(sessionStorage.getItem("lost-entered") || "[]")); } catch { return new Set(); } })();
  function enterLive(sid) {
    if (!sid || entered.has(sid)) return false;
    entered.add(sid);
    try { sessionStorage.setItem("lost-entered", JSON.stringify([...entered])); } catch {}
    location.hash = `#/live/${sid}`;
    return true;
  }

  // ================= home =================
  async function home(app, _, params) {
    if (params.canvas) toast(params.canvas === "ok" ? "Canvas linked. Your classes are matched to your sections." : `Canvas: ${params.canvas}`, params.canvas === "ok" ? "" : "error");
    const [{ courses, canvas }, st] = await Promise.all([api("/api/student/courses"), api("/api/canvas/status")]);
    const live = courses.filter((c) => c.active?.status === "live");
    if (live.length === 1 && enterLive(live[0].active.id)) return;
    Lost.poll(async (signal) => {
      const r = await api("/api/student/courses", { signal });
      const now = r.courses.filter((c) => c.active?.status === "live" && !entered.has(c.active.id));
      if (now.length === 1) enterLive(now[0].active.id);
      else if (now.length > 1 || r.courses.length !== courses.length) Lost.render();
    }, 3000);
    app.innerHTML = `
      <h1>Your classes</h1>
      ${live.map((c) => `<a class="live-banner" href="#/live/${c.active.id}"><span class="dot live" aria-hidden="true"></span><span><b>${esc(c.code)} is live now</b><span>${esc(c.section_name)} · tap to enter today's class</span></span></a>`).join("")}
      ${courses.length ? `<ul class="course-grid">${courses.map((c) => `
        <li class="course-card">
          ${Lost.courseArt ? Lost.courseArt(c.art, c.id) : ""}
          <div class="cc-head"><span class="cc-code">${esc(c.code)}</span>${c.source === "demo" ? `<span class="badge warn">Demo course</span>` : ""}</div>
          <h2><a href="#/course/${c.id}">${esc(c.name)}</a></h2>
          <p class="note">${esc(c.section_name)}</p>
          <p class="cc-line">${c.active?.status === "live" ? `<span class="badge live">Live now</span>` : c.last ? `<span class="note">Last class ${when(c.last.ended_at)}${c.last.summary === "ready" ? " · summary ready" : ""}</span>` : `<span class="note">No lectures yet</span>`}</p>
          ${c.stats.unresolved ? `<p class="note">${c.stats.unresolved} moment${c.stats.unresolved === 1 ? "" : "s"} still unresolved</p>` : ""}
          ${c.active?.status === "live" ? `<a class="button gold" href="#/live/${c.active.id}">Enter today's class</a>` : `<a class="button" href="#/course/${c.id}">Open course</a>`}
        </li>`).join("")}</ul>` : `<div class="empty-state"><p>No classes yet. They show up here once your university connects them.</p></div>`}
`;
    const link = async (mode) => {
      if (!st.institutionId) await api("/api/canvas/institution", { method: "POST", body: { institutionId: st.institutions[0].id } });
      const r = await api("/api/canvas/connect", { method: "POST", body: { mode } });
      if (r.redirect) { location.href = r.redirect; return; }
      toast(r.added ? `Added you to ${r.added} section${r.added === 1 ? "" : "s"}.` : "No new sections matched. Your professor may not have added the course to Lost yet.");
      Lost.render();
    };
    $("#oauth")?.addEventListener("click", () => link("oauth"));
    $("#demoLink")?.addEventListener("click", () => link("demo"));
    $("#relink")?.addEventListener("click", () => link(canvas.mode));
  }

  // ================= join =================
  async function join(app, [code]) {
    app.innerHTML = `<h1>Joining class ${esc(code)}</h1><p class="note">Checking the code…</p>`;
    let r;
    try { r = await api("/api/student/join", { method: "POST", body: { code } }); }
    catch (e) { app.innerHTML = `<h1>Couldn't join</h1><section class="panel"><p class="form-error">${esc(e.message)}</p><a class="button" href="#/">Back</a></section>`; return; }
    if (r.activeSession) { entered.add(r.activeSession); location.replace(`#/live/${r.activeSession}`); return; }
    app.innerHTML = `<h1>You're in ${esc(r.course.code)}</h1>
      <section class="panel waiting">
        <p><span class="dot live" aria-hidden="true"></span> <b>Waiting for class to start.</b></p>
        <p class="note">Keep this page open. You'll go into ${esc(r.course.name)} by yourself as soon as your professor starts.</p>
      </section>`;
    Lost.poll(async (signal) => {
      const d = await api(`/api/student/courses/${r.course.id}`, { signal });
      if (d.active?.status === "live") { entered.add(d.active.id); location.replace(`#/live/${d.active.id}`); }
    }, 2500);
  }

  // ================= course =================
  const catName = (k) => ({ term: "A term", reasoning: "A reasoning step", connection: "A connection", missed: "Missed what was said" }[k] || "");
  async function course(app, [id]) {
    const d = await api(`/api/student/courses/${id}`);
    if (d.active?.status === "live" && enterLive(d.active.id)) return;
    if (!d.active) Lost.poll(async (signal) => {
      const n = await api(`/api/student/courses/${id}`, { signal });
      if (n.active?.status === "live") enterLive(n.active.id) || Lost.render();
    }, 3000);
    const c = d.course, s = d.stats;
    app.innerHTML = `
      <p class="crumb"><a href="#/">Your classes</a></p>
      <h1>${esc(c.code)} ${esc(c.name)}</h1>
      <p class="note">${esc(c.section)}${c.term ? ` · ${esc(c.term)}` : ""}</p>
      ${d.active ? `<a class="live-banner" href="#/live/${d.active.id}"><span class="dot live" aria-hidden="true"></span><span><b>Class is live</b><span>Enter today's class</span></span></a>` : ""}
      <section class="panel">
        <h2>Your progress in this course</h2>
        <dl class="stat-row">
          <div><dt>I'm lost moments</dt><dd>${s.total}</dd><p class="note">Times you tapped I'm lost.</p></div>
          <div><dt>Marked resolved</dt><dd>${s.resolved}</dd><p class="note">You pressed "That helped". Opening or closing a card doesn't count.</p></div>
          <div><dt>Still open</dt><dd>${s.unresolved}</dd><p class="note">Not marked resolved yet.</p></div>
          <div><dt>Checks answered right</dt><dd>${s.checksPassed}${s.checksAnswered ? ` <span class="note">of ${s.checksAnswered}</span>` : ""}</dd><p class="note">Understanding and review questions you got right.</p></div>
        </dl>
        <p class="note">These are for you, not grades. They count taps and answers; they don't measure how good you are at the subject.</p>
        ${s.unresolvedTopics.length ? `<h3>Topics still open</h3><ul class="chips">${s.unresolvedTopics.map((t) => `<li>${esc(t.topic)}${t.n > 1 ? ` ×${t.n}` : ""}</li>`).join("")}</ul>` : ""}
      </section>
      <section class="panel"><h2>Past classes</h2>
        ${d.sessions.filter((x) => x.status === "ended").length ? `<ul class="plain list-rows">${d.sessions.filter((x) => x.status === "ended").map((x) => `
          <li><a href="#/session/${x.id}"><b>${when(x.started_at)}</b>${x.title ? ` · ${esc(x.title)}` : ""}</a>
          <span class="note">${x.published ? (x.summary === "ready" ? "Summary ready" : "Transcript available") : "Summary not ready yet"}${x.my_taps ? ` · you tapped ${x.my_taps} time${x.my_taps === 1 ? "" : "s"}` : ""}</span></li>`).join("")}</ul>` : `<p class="empty-state">No finished classes yet.</p>`}
      </section>
      ${d.history.length ? `<section class="panel"><h2>Your I'm lost history</h2><ul class="plain list-rows">${d.history.map((h) => `
        <li><a href="#/session/${h.session_id}#ev-${h.id}">${when(h.started_at)} at ${fmt(h.t)}</a> <span class="note">${h.topic ? esc(h.topic) : "Topic not labelled"}${h.category ? ` · ${catName(h.category)}` : ""} · ${h.self_status === "resolved" ? "resolved" : "open"}</span></li>`).join("")}</ul></section>` : ""}
      ${c.office_hours_url || c.tutoring_url ? `<section class="panel"><h2>Help outside class</h2><p class="note">Links added by your professor.</p><ul class="plain">${safeUrl(c.office_hours_url) ? `<li><a href="${esc(c.office_hours_url)}" target="_blank" rel="noopener">Office hours</a></li>` : ""}${safeUrl(c.tutoring_url) ? `<li><a href="${esc(c.tutoring_url)}" target="_blank" rel="noopener">Tutoring</a></li>` : ""}</ul></section>` : ""}`;
  }

  // ================= live class =================
  // The transcript is the main reading surface and always stays on screen. Help opens beside it on a
  // wide screen (resizable, can be minimized) and as a bottom sheet on a phone. New lines never move
  // the student's scroll position; a "Jump to live" button appears instead.
  async function liveClass(app, [sid]) {
    const st = { status: "", now: "", lines: [], since: 0, rev: -1, ai: true, clock: 0, lastIdx: null, mine: [], rendered: 0, unseen: 0 };
    const H = { ev: null, phrases: [], picked: null, cards: [], busy: false, catchups: 0, tries: {}, seq: 0, state: "closed", title: "" };
    const helpW = (() => { try { return Number(localStorage.getItem("lost-help-w")) || 420; } catch { return 420; } })();
    app.innerHTML = `
      <div class="live2" id="live2" data-help="closed" style="--help-w:${helpW}px">
        <header class="live-top">
          <div class="live-title"><p class="crumb"><a href="#/">Your classes</a></p><h1 id="roomTitle">Class</h1></div>
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
          <button id="jump" class="jump" hidden>New lines below · Jump to live</button>
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
      $("#jump").hidden = !st.unseen;
    }
    box.addEventListener("scroll", () => { if (nearBottom()) { st.unseen = 0; $("#jump").hidden = true; } }, { passive: true });
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
    Lost.onLeave(() => document.removeEventListener("keydown", onKey));

    // ---------- poll ----------
    Lost.poll(async (signal) => {
      const d = await api(`/api/student/sessions/${sid}/live?lines=1&since=${st.since}&rev=${st.rev}`, { signal });
      if (d.status !== st.status) {
        st.status = d.status;
        $("#roomTitle").textContent = `${d.course.code} ${d.title || d.course.name}`;
        $("#dot").className = `dot ${d.status}`;
        $("#statusText").textContent = { ready: "Waiting to start", live: "Live", ending: "Ending", ended: "Class is over" }[d.status];
        $("#lost").disabled = d.status !== "live";
        if (d.status === "ended") $("#ack").innerHTML = `Class is over. <a href="#/session/${sid}">Your summary and review</a> will be ready here soon.`;
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
    });

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
    Lost.onLeave(stopPlayer);
  }

  // ================= after class =================
  async function sessionPage(app, [sid]) {
    const draw = async () => {
      const d = await api(`/api/student/sessions/${sid}`);
      const s = d.session;
      Lost.backdrop(d.theme);
      if (s.status === "live") { location.hash = `#/live/${sid}`; return "live"; }
      const unresolved = d.events.filter((e) => e.status !== "resolved");
      app.innerHTML = `
        <p class="crumb"><a href="#/course/${s.course_id}">${esc(s.code)} ${esc(s.course)}</a></p>
        <h1>Class on ${when(s.started_at)}</h1>
        ${s.title ? `<p class="note">${esc(s.title)}</p>` : ""}
        ${d.events.length ? `<button class="gold" data-scroll="review">Your learning moments (${d.events.length}${unresolved.length ? `, ${unresolved.length} still open` : ""})</button>` : ""}
        <section class="panel" aria-live="polite"><h2>Class summary</h2>${summaryBlock(d)}</section>
        <section class="panel" id="review"><h2>Your learning moments</h2><p class="note">Private: only you see this. Every spot you marked is here, including the ones you later understood.</p>
          ${d.events.length ? `<ol class="moment-strip">${d.events.map((e) => `<li class="${e.status === "resolved" ? "ok" : "open"}"><a href="#ev-${e.id}" data-jump="ev-${e.id}"><time>${fmt(e.t)}</time> ${esc(e.topic || "Your moment")}</a><span class="badge ${e.status === "resolved" ? "good" : "warn"}">${e.status === "resolved" ? "You said you got it" : "Still open"}</span></li>`).join("")}</ol>
            <div class="quiz-box" id="quizBox"><h3>Optional quiz</h3><p class="note">Up to 3 questions on the spots you marked, each with a new example. Not a grade, and it doesn't change what you marked as understood.</p><button class="primary" id="startQuiz">Start the quiz</button></div>
            ${d.events.map((e) => eventBlock(e, d)).join("")}` : `<p class="empty-state">You didn't tap I'm lost in this class.</p>`}</section>
        ${d.support.officeHours || d.support.tutoring ? `<section class="panel"><h2>More help</h2><p class="note">Links added by your professor.</p><ul class="plain">${safeUrl(d.support.officeHours) ? `<li><a href="${esc(d.support.officeHours)}" target="_blank" rel="noopener">Office hours</a></li>` : ""}${safeUrl(d.support.tutoring) ? `<li><a href="${esc(d.support.tutoring)}" target="_blank" rel="noopener">Tutoring</a></li>` : ""}</ul></section>` : ""}`;
      const target = location.hash.match(/#ev-([\w-]+)$/)?.[1];
      if (target) document.getElementById(`ev-${target}`)?.scrollIntoView();
      return d.summaryState;
    };
    const first = await draw();
    if (first === "pending" || first === "not_ended") Lost.poll(async () => { const s = await draw(); if (s !== "pending" && s !== "not_ended") Lost.render(); }, 4000);
    const onClick = async (e) => {
      const sc = e.target.closest("button[data-scroll]");
      if (sc) { const t = document.getElementById(sc.dataset.scroll); t.scrollIntoView({ behavior: "smooth" }); t.querySelector("input,button")?.focus({ preventScroll: true }); return; }
      const j = e.target.closest("a[data-jump]");
      if (j) { e.preventDefault(); document.getElementById(j.dataset.jump)?.scrollIntoView({ block: "start" }); return; }
      if (e.target.id === "startQuiz") return startQuiz(e.target);
      const b = e.target.closest("button[data-ev]"); if (!b) return;
      const id = b.dataset.ev;
      if (b.dataset.do === "resolved" || b.dataset.do === "still") { await api(`/api/student/events/${id}/status`, { method: "POST", body: { status: b.dataset.do } }); toast(b.dataset.do === "resolved" ? "Marked resolved." : "Kept open."); draw(); }
      if (b.dataset.do === "oh") { const ta = $(`#oh-${id}`); await api(`/api/student/events/${id}/office-hours`, { method: "POST", body: { text: ta.value } }); toast("Saved. Lost doesn't send it anywhere."); }
      if (b.dataset.do === "copy") { const ta = $(`#oh-${id}`); try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch { ta.select(); toast("Select and copy the text."); } }
    };
    // The quiz: unresolved moments first, then the ones the student said they understood.
    async function startQuiz(btn) {
      const d = await api(`/api/student/sessions/${sid}`);
      const pick = [...d.events.filter((e) => e.status !== "resolved"), ...d.events.filter((e) => e.status === "resolved")].slice(0, 3);
      btn.disabled = true; btn.textContent = "Writing questions…";
      const qs = [];
      for (const ev of pick) { try { qs.push({ ev, q: await api(`/api/student/events/${ev.id}/check`, { method: "POST" }) }); } catch (x) { qs.push({ ev, err: x.message }); } }
      $("#quizBox").innerHTML = `<h3>Optional quiz</h3><p class="note">Not a grade. New examples, written by the AI.</p>${qs.map(({ ev, q, err }, i) => err ? `<p class="note">Question ${i + 1} (${esc(ev.topic || fmt(ev.t))}): ${esc(err)}</p>`
        : `<form class="check" data-check="${q.id}" data-quiz="1"><fieldset><legend><span class="lesson-label">${i + 1} · ${esc(ev.topic || `the spot at ${fmt(ev.t)}`)}</span><br>${esc(q.question)}</legend>
          ${q.choices.map((ch, k) => `<label class="choice"><input type="radio" name="q-${q.id}" value="${k}"> ${esc(ch)}</label>`).join("")}</fieldset>
          <button class="primary">Answer</button><p class="check-result" aria-live="polite"></p></form>`).join("")}`;
    }
    const onSubmit = async (e) => {
      const f = e.target.closest("form.check"); if (!f) return;
      e.preventDefault();
      const chosen = f.querySelector("input:checked"); if (!chosen) { f.querySelector(".check-result").textContent = "Pick an answer first."; return; }
      const r = await api(`/api/student/checks/${f.dataset.check}/answer`, { method: "POST", body: { chosen: Number(chosen.value) } }).catch((x) => ({ error: x.message }));
      if (r.error) { f.querySelector(".check-result").textContent = r.error; return; }
      f.querySelectorAll("input,button").forEach((x) => (x.disabled = true));
      f.querySelectorAll("label.choice").forEach((l, k) => { if (k === r.correctIndex) l.classList.add("right"); else if (l.contains(chosen)) l.classList.add("wrong"); });
      f.querySelector(".check-result").innerHTML = `${r.correct ? "<b>Right.</b>" : "<b>Not quite.</b>"} ${esc(r.why || "")}`;
    };
    app.addEventListener("click", onClick); app.addEventListener("submit", onSubmit);
    Lost.onLeave(() => { app.removeEventListener("click", onClick); app.removeEventListener("submit", onSubmit); });
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

  function eventBlock(e, d) {
    const card = e.card && e.card.ai !== false ? e.card : null;
    const tried = [card ? "read Lost's explanation" : "", e.checks.some((c) => c.kind === "comprehension" && c.chosen != null) ? "tried a practice question" : ""].filter(Boolean).join(" and ");
    const cardSources = card ? (card.v === 2 ? [card.takeaway, card.explanation, card.connection].filter(Boolean).flatMap((c) => c.sources || []) : card.context?.sources || []) : [];
    const source = cardSources.find((x) => x.type === "passage");
    const draft = e.officeHours || `I got lost at ${fmt(e.t)} in the ${when(d.session.started_at)} class${e.topic ? `, on ${e.topic}` : ""}.${e.line ? ` You said: "${e.line.text}"` : ""}${source ? ` The related material is ${source.title}${source.location ? `, ${source.location}` : ""}.` : ""}${tried ? ` I ${tried}.` : ""}${e.question ? ` My question: ${e.question}` : " What I still don't get is: "}`;
    return `<article class="ev" id="ev-${e.id}">
      <h3><span class="at">${fmt(e.t)}</span>${esc(e.topic || "The part you marked")} <span class="badge ${e.status === "resolved" ? "good" : "warn"}">${e.status === "resolved" ? "You said you got it" : "Still open"}</span></h3>
      ${e.line ? `<p class="lost-at"><span>You got lost at</span>"${esc(e.line.text)}"</p>` : ""}
      ${e.question ? `<p class="note">Your question: ${esc(e.question)}</p>` : ""}
      ${card ? `<details><summary>The explanation you got</summary>${Lost.lesson(card, { headingLevel: 4 })}</details>` : ""}
      ${e.checks.filter((c) => c.chosen != null).map((c) => `<p class="note">${c.kind === "diagnostic" ? "Quick check" : c.kind === "review" ? "Review question" : "Quiz"}: ${c.correct ? "answered right" : "answered wrong"} (separate from what you marked).</p>`).join("")}
      ${e.review && e.review.chosen == null ? `<form class="check" data-check="${e.review.id}"><fieldset><legend><b>Review</b> (made by the AI from today's class): ${esc(e.review.question)}</legend>
        ${e.review.choices.map((ch, k) => `<label class="choice"><input type="radio" name="r-${e.review.id}" value="${k}"> ${esc(ch)}</label>`).join("")}</fieldset>
        <button class="primary">Answer</button><p class="check-result" aria-live="polite"></p></form>` : ""}
      <div class="row">${e.status === "resolved" ? `<button data-ev="${e.id}" data-do="still">Reopen</button>` : `<button data-ev="${e.id}" data-do="resolved">I get it now</button>`}</div>
      ${e.status !== "resolved" ? `<details class="oh"><summary>Prepare an office-hours question</summary>
        <label for="oh-${e.id}">Edit it before you use it. Lost doesn't send it to anyone.</label><textarea id="oh-${e.id}" rows="5">${esc(draft)}</textarea>
        <div class="row"><button data-ev="${e.id}" data-do="oh">Save</button><button data-ev="${e.id}" data-do="copy">Copy</button></div></details>` : ""}
    </article>`;
  }

  // shared summary renderer (same as the professor's preview)
  Lost.sharedSummary = (s) => !s ? "" : s.v === 2 ? Lost.summaryV2(s) : `<div class="summary">
    ${s.main_topics.map((x) => `<article><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p>${Lost.sources(x.sources)}</article>`).join("")}
    ${Lost.steps(s.flow)}
    ${s.concepts.length ? `<h3>Concepts</h3><dl class="terms">${s.concepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.definition)}</dd>`).join("")}</dl>` : ""}
    ${s.examples.length ? `<h3>Examples</h3>${s.examples.map((x) => `<p><span class="origin">${x.origin === "ai" ? "Written by the AI" : x.origin === "materials" ? "From course materials" : "From the lecture"}</span> ${esc(x.text)}</p>`).join("")}` : ""}
    ${s.deadlines.length ? `<h3>Deadlines mentioned</h3><ul>${s.deadlines.map((x) => `<li>${esc(x.text)}${Lost.sources(x.sources, "Source")}</li>`).join("")}</ul>` : ""}
  </div>`;

  Lost.boot("student", [
    [/^\/$/, home],
    [/^\/join\/([A-Za-z0-9]{4,10})$/, join],
    [/^\/course\/([\w-]+)$/, course],
    [/^\/live\/([\w-]+)$/, liveClass],
    [/^\/session\/([\w-]+)(?:#.*)?$/, sessionPage],
  ]);
})();
