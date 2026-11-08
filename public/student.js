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
          <div class="cc-head"><span class="cc-code">${esc(c.code)}</span>${c.source === "demo" ? `<span class="badge warn">Demo course</span>` : ""}</div>
          <h2><a href="#/course/${c.id}">${esc(c.name)}</a></h2>
          <p class="note">${esc(c.section_name)} · joined ${c.enrolled_by === "code" ? "with a code" : "through Canvas"}</p>
          <p class="cc-line">${c.active?.status === "live" ? `<span class="badge live">Live now</span>` : c.last ? `<span class="note">Last class ${when(c.last.ended_at)}${c.last.summary === "ready" ? " · summary ready" : ""}</span>` : `<span class="note">No classes yet</span>`}</p>
          ${c.stats.unresolved ? `<p class="note">${c.stats.unresolved} moment${c.stats.unresolved === 1 ? "" : "s"} still unresolved</p>` : ""}
          ${c.active?.status === "live" ? `<a class="button gold" href="#/live/${c.active.id}">Enter today's class</a>` : `<a class="button" href="#/course/${c.id}">Open course</a>`}
        </li>`).join("")}</ul>` : `<div class="empty-state"><p>You're not in any classes yet. Join with the code your professor shows, or link Canvas.</p></div>`}
      <section class="panel join-box">
        <h2>Join a class</h2>
        <form id="joinForm" class="row"><label for="code" class="visually-hidden">Class code</label><input id="code" class="code-input" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" required><button class="primary">Join</button></form>
        <p class="note">The code adds you to your section. You only do this once per course; after that the class shows up here.</p>
        <p id="joinErr" class="form-error" role="alert"></p>
      </section>
      <section class="panel">
        <h2>Canvas</h2>
        ${canvas ? `<p>Linked${canvas.mode === "demo" ? " to demo Canvas (sample data)" : ` to ${esc(canvas.host)}`}. Your Canvas sections are matched automatically.</p><button id="relink">Check Canvas again</button>`
          : `<p class="note">Linking Canvas puts you in the right sections without codes. Lost never asks for your Canvas password; you approve access on Canvas itself.</p>
            ${!st.institutionId ? `<p class="note">Your institution: ${esc(st.institutions[0].name)}.</p>` : ""}
            ${st.oauth.ready ? `<button id="oauth" class="primary">Link Canvas</button>` : `<p class="note">Canvas sign-in isn't set up on this server yet (it needs a developer key from the university). Use your class code instead.</p>`}
            ${st.demo ? `<button id="demoLink">Link demo Canvas (sample data)</button>` : ""}`}
      </section>`;
    $("#joinForm").onsubmit = (e) => { e.preventDefault(); location.hash = `#/join/${encodeURIComponent($("#code").value.trim().toUpperCase())}`; };
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
  async function liveClass(app, [sid]) {
    const st = { status: "", now: "", lines: [], since: 0, rev: -1, transcriptOpen: false, ai: true, clock: 0, lastIdx: null, gaps: [] };
    const H = { ev: null, phrases: [], picked: null, cards: [], busy: false, catchups: 0, retries: 0, seq: 0 };
    app.innerHTML = `
      <div class="room">
        <header class="room-top">
          <div><p class="crumb"><a href="#/">Your classes</a></p><h1 id="roomTitle">Class</h1></div>
          <span class="status"><span class="dot" id="dot"></span><span id="statusText">Connecting…</span></span>
        </header>
        <div class="room-main">
          <button class="lostbtn" id="lost" disabled><span class="lost-main">I'm lost</span><span class="lost-sub">Tap, then keep listening</span></button>
          <p id="ack" class="ack" aria-live="polite"></p>
          <div class="tools"><button id="listen" class="tool" disabled>Listen to class</button><button id="showT" class="tool" aria-expanded="false" aria-controls="tpanel">Show transcript</button></div>
          <p id="listenNote" class="note center"></p>
          <audio id="relayAudio"></audio>
        </div>
        <div class="room-side">
          <section id="help" class="help-card" hidden aria-labelledby="helpH"></section>
          <section id="tpanel" class="panel" hidden><h2>Transcript</h2><div id="tlines" class="tlines"></div></section>
        </div>
      </div>`;

    // ---------- tap ----------
    $("#lost").onclick = async () => {
      if (H.busy) return;
      navigator.vibrate?.(30);
      try {
        const r = await api(`/api/student/sessions/${sid}/lost`, { method: "POST" });
        const same = H.ev?.id === r.event.id;
        if (!same) { H.ev = r.event; H.phrases = r.phrases; H.now = r.now || null; H.cards = []; H.picked = null; H.catchups = 0; H.retries = 0; H.tries = {}; H.seq++; }
        st.ai = r.ai;
        $("#ack").textContent = `Marked at ${fmt(r.event.t)}.${r.others ? ` ${r.others} other${r.others === 1 ? "" : "s"} tapped in the last 90 seconds.` : ""} Your professor sees the moment, not your name.`;
        if (!same) showPicker(r.gaps);
        else $("#help").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) { toast(e.message, "error"); }
    };

    // Step 1: what lost you? One tap is enough; everything else is optional.
    function showPicker(gaps) {
      const box = $("#help"); box.hidden = false;
      box.innerHTML = `
        <div class="help-head"><h2 id="helpH">What lost you?</h2><button class="quiet" id="closeHelp">Just mark it</button></div>
        <p class="note">Your tap is saved. Pick a line or keep the default, and get a short explanation while class goes on.</p>
        ${gaps?.length ? `<p class="note warn">Part of the last minute wasn't transcribed (no audio reached Lost).</p>` : ""}
        <div class="phrase-list" role="group" aria-label="Recent lines from the lecture">
          ${H.phrases.map((p) => `<button class="phrase" data-line="${p.idx}"><time>${fmt(p.t)}</time>${esc(p.text)}</button>`).join("")}
          ${H.now ? `<button class="phrase phrase-now" data-now><span class="now-label">Being said when you tapped</span>${esc(H.now)}…</button>` : ""}
          ${!H.phrases.length && !H.now ? `<p class="note">Nothing has been transcribed yet.</p>` : ""}
        </div>
        <div class="row">
          <button class="primary" id="explainCurrent">${H.phrases.length ? "Explain the current topic" : "Get help"}</button>
          <button id="explainEarlier">It started earlier</button>
        </div>
        <details class="optional"><summary>Add detail (optional)</summary>
          <fieldset class="chips-field"><legend>What kind of confusion?</legend>
            ${[["term", "A term"], ["reasoning", "A reasoning step"], ["connection", "How it connects"], ["missed", "I missed what was said"]].map(([k, l]) => `<label class="chip"><input type="radio" name="cat" value="${k}"> ${l}</label>`).join("")}
          </fieldset>
          <label for="q">Your question</label><input id="q" maxlength="300" placeholder="What does … mean?">
        </details>`;
      $("#closeHelp").onclick = () => { box.hidden = true; $("#lost").focus(); };
      box.querySelectorAll(".phrase[data-line]").forEach((b) => b.addEventListener("click", () => explain("phrase", Number(b.dataset.line))));
      box.querySelector(".phrase[data-now]")?.addEventListener("click", () => explain("current", null, { text: H.now }));
      $("#explainCurrent").onclick = () => explain($("#q").value.trim() ? "question" : "current");
      $("#explainEarlier").onclick = () => explain("earlier");
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      $("#helpH").focus?.();
    }

    async function explain(anchor, line = null, picked = null) {
      const seq = H.seq;
      const body = { kind: "explain", anchor, line, category: $("input[name=cat]:checked")?.value || null, question: $("#q")?.value.trim() || null };
      H.picked = picked || (line != null ? H.phrases.find((p) => p.idx === line) : null);
      $("#help").innerHTML = `<div class="help-head"><h2 id="helpH">Getting help…</h2></div>${H.picked ? `<p class="note">You marked: "${esc(H.picked.text)}"</p>` : ""}<p class="note help-wait">Reading the lecture and course materials…</p>`;
      const r = await request(body);
      if (seq !== H.seq) return; // a newer tap replaced this one
      if (r) { H.cards = [r]; paintHelp(); }
    }
    async function request(body) {
      H.busy = true;
      try { return await api(`/api/student/events/${H.ev.id}/help`, { method: "POST", body }); }
      catch (e) { toast(e.message, "error"); return null; }
      finally { H.busy = false; }
    }

    // The card stays put while class continues; polling never redraws it.
    function paintHelp() {
      const box = $("#help"), first = H.cards[0]?.payload;
      const title = first?.v === 2 ? first.title : first?.topic;
      box.innerHTML = `<div class="help-head"><h2 id="helpH">${esc(title || "Here's help")}</h2><button class="quiet" id="closeHelp">Close</button></div>
        ${H.picked ? `<details class="marked-line"><summary>You marked ${H.picked.t != null ? fmt(H.picked.t) : "the line being said"} (as transcribed)</summary><p>"${esc(H.picked.text)}"</p></details>` : ""}
        ${H.cards.map((c, i) => cardHtml(c, i)).join("")}
        <div id="afterCards"></div>
        <div class="help-actions" id="helpActions">
          <button class="primary" data-h="helped">Got it</button>
          ${st.ai ? `<button data-h="retry">Explain differently</button><button data-h="steps">Show the steps</button>` : ""}
          <button data-h="still">Still confused</button>
          <button data-h="catchup">Catch me up</button>
          ${st.ai ? `<button class="quiet" data-h="check">Quiz me</button>` : ""}
        </div>
        <p class="note" id="sinceTap"></p>
        <div id="catchupBox" aria-live="polite"></div>`;
      $("#closeHelp").onclick = () => { box.hidden = true; $("#lost").focus(); };
      paintSince();
    }
    const KICKER = { retry: "Another way to see it", steps: "Step by step", simpler: "A simpler start", prereq: "The idea underneath" };
    function cardHtml(c, i) {
      const p = c.payload;
      const label = KICKER[c.kind] || "";
      if (!p) return `<p class="form-error">${esc(c.error || "No help came back.")}</p>`;
      if (p.ai === false) {
        return `<div class="card-block">${label ? `<h3>${label}</h3>` : ""}
          <p class="note">${esc(c.error || "The AI helper is off on this server.")} Here is what was said and what the course materials say.</p>
          ${p.excerpt?.length ? `<div class="excerpt"><span class="label">What your professor said</span>${p.excerpt.map((l) => `<p class="${l.mine ? "mine" : ""}"><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("")}</div>` : `<p class="note">Nothing was transcribed around your tap.</p>`}
          ${p.passages?.length ? `<div class="excerpt"><span class="label">From course materials</span>${p.passages.map((x) => `<p><b>${safeUrl(x.url) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</b>${x.location ? `, ${esc(x.location)}` : ""}<br>${esc(x.text)}</p>`).join("")}</div>` : `<p class="note">No matching course material.</p>`}
          ${p.gaps?.length ? `<p class="note warn">Some audio near your tap is missing from the transcript.</p>` : ""}</div>`;
      }
      return `<div class="card-block" data-i="${i}">${Lost.lesson(p, { kicker: label, showTitle: i > 0, headingLevel: 3 })}${p.diagnostic ? diagHtml(p.diagnostic) : ""}</div>`;
    }
    const diagHtml = (d) => `<form class="check" data-check="${d.id}" data-kind="diagnostic"><fieldset><legend><b>Quick check</b> (to find what to explain next): ${esc(d.question)}</legend>
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
        f.insertAdjacentHTML("beforeend", `<p class="note help-wait">That's useful to know: explaining ${esc(r.prerequisite || "the idea underneath")} first…</p>`);
        const c = await request({ kind: "prereq", attempt: 1 });
        if (c) { H.cards.push(c); paintHelp(); }
      }
    });

    async function action(kind, btn) {
      if (kind === "helped") {
        await api(`/api/student/events/${H.ev.id}/status`, { method: "POST", body: { status: "resolved" } });
        $("#helpActions").innerHTML = `<p class="note">Marked as resolved. Back to class: tap I'm lost again any time.</p><button data-h="catchup" class="primary">Catch me up to now</button>`;
        toast("Marked resolved.");
      }
      if (kind === "retry" || kind === "steps" || kind === "still") {
        const ask = kind === "still" ? "simpler" : kind;
        if (kind === "still") await api(`/api/student/events/${H.ev.id}/status`, { method: "POST", body: { status: "still" } });
        H.tries ||= {};
        if ((H.tries[ask] || 0) >= 3) { toast("That's three tries of this kind. This moment stays open, and it'll be in your review after class."); return; }
        const label = btn.textContent;
        btn.disabled = true; btn.textContent = kind === "steps" ? "Breaking it into steps…" : kind === "retry" ? "Finding another way…" : "Starting simpler…";
        H.tries[ask] = (H.tries[ask] || 0) + 1;
        const c = await request({ kind: ask, attempt: H.tries[ask] });
        if (c) { H.cards.push(c); paintHelp(); $$(".card-block").at(-1)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
        else { btn.disabled = false; btn.textContent = label; H.tries[ask]--; }
      }
      if (kind === "check") {
        btn.disabled = true; btn.textContent = "Writing a question…";
        try {
          const q = await api(`/api/student/events/${H.ev.id}/check`, { method: "POST" });
          $("#afterCards").innerHTML = `<form class="check" data-check="${q.id}" data-kind="comprehension"><fieldset><legend><b>Check your understanding</b> (new example, made by the AI): ${esc(q.question)}</legend>
            ${q.choices.map((ch, k) => `<label class="choice"><input type="radio" name="c-${q.id}" value="${k}"> ${esc(ch)}</label>`).join("")}</fieldset>
            <div class="row"><button class="primary">Answer</button><button type="button" class="quiet" data-skip>Skip</button></div><p class="check-result" aria-live="polite"></p></form>`;
        } catch (e) { toast(e.message, "error"); }
        btn.disabled = false; btn.textContent = "Quiz me";
      }
      if (kind === "catchup") {
        btn.disabled = true; btn.textContent = "Catching up…";
        const c = await request({ kind: "catchup", attempt: ++H.catchups });
        btn.disabled = false; btn.textContent = "Catch me up";
        if (!c) { H.catchups--; return; }
        const p = c.payload || {};
        $("#catchupBox").innerHTML = `<div class="catchup"><h3>While you were reading (${fmt(p.since)} to ${fmt(p.until)})</h3>
          ${p.gaps?.length ? `<p class="note warn">No audio reached Lost for ${p.gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)}`).join(", ")}, so that part is missing.</p>` : ""}
          ${p.empty ? `<p>Nothing new has been transcribed since your tap.</p>`
            : p.ai ? `<p>${esc(p.happened)}</p><p><b>Now:</b> ${esc(p.current_topic)}</p><p><b>How it connects:</b> ${esc(p.connection)}</p>${Lost.sources(p.sources, "From the transcript")}`
            : `<p class="note">${esc(c.error || "AI is off.")} The latest lines:</p><div class="excerpt">${(p.lines || []).map((l) => `<p><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("")}</div>`}</div>`;
        $("#catchupBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    function paintSince() {
      const el = $("#sinceTap"); if (!el || !H.ev) return;
      const n = st.lastIdx == null ? 0 : st.lastIdx - (H.ev.line_idx ?? -1);
      el.textContent = st.status === "live" ? `${Math.max(0, n)} new line${n === 1 ? "" : "s"} since your tap at ${fmt(H.ev.t)}. Class is at ${fmt(st.clock)}.` : st.status === "ended" ? "Class has ended. Your summary will cover this moment." : "";
    }

    // ---------- transcript (only fetched while open) ----------
    $("#showT").onclick = () => {
      st.transcriptOpen = !st.transcriptOpen;
      $("#tpanel").hidden = !st.transcriptOpen;
      $("#showT").textContent = st.transcriptOpen ? "Hide transcript" : "Show transcript";
      $("#showT").setAttribute("aria-expanded", st.transcriptOpen);
      $("#showT").classList.toggle("on", st.transcriptOpen);
      st.rev = -1;
    };
    function paintLines() {
      const box = $("#tlines");
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 50;
      const lines = st.lines.filter(Boolean).slice(-150).map((l) => `<p><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("");
      box.innerHTML = (lines + (st.now ? `<p class="saying"><time>now</time>${esc(st.now)}</p>` : "")) || `<p class="note">Nothing yet. Words show up as your professor talks.</p>`;
      if (atBottom) box.scrollTop = box.scrollHeight;
    }

    // ---------- poll ----------
    Lost.poll(async (signal) => {
      const d = await api(`/api/student/sessions/${sid}/live?lines=${st.transcriptOpen ? 1 : 0}&since=${st.since}&rev=${st.rev}`, { signal });
      if (d.status !== st.status) {
        st.status = d.status;
        $("#roomTitle").textContent = `${d.course.code} ${d.title || d.course.name}`;
        $("#dot").className = `dot ${d.status}`;
        $("#statusText").textContent = { ready: "Waiting for class to start", live: "Class is live", ending: "Class is ending", ended: "Class is over" }[d.status];
        $("#lost").disabled = d.status !== "live";
        if (d.status === "ended") $("#ack").innerHTML = `Class is over. <a href="#/session/${sid}">Your summary and review</a> will be ready here soon.`;
        else if (d.status === "live" && !$("#ack").textContent) $("#ack").textContent = "Nobody sees who tapped.";
      }
      st.clock = d.clock; st.lastIdx = d.lastIdx; st.ai = d.ai;
      if (d.lines) { if (d.full) st.lines = []; for (const l of d.lines) st.lines[l.idx] = l; st.since = st.lines.length; st.rev = d.rev; const nowChanged = (d.now || "") !== st.now; st.now = d.now || ""; if (d.lines.length || d.full || nowChanged) paintLines(); }
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
      $("#listen").textContent = wantSound && ok ? "Stop listening" : "Listen to class";
      $("#listenNote").textContent = st.status !== "live" ? "" : !lastAudio ? "Your professor's mic isn't shared right now." : wantSound ? "Listening, about 2 seconds behind the room." : "";
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
      if (s.status === "live") { location.hash = `#/live/${sid}`; return "live"; }
      const unresolved = d.events.filter((e) => e.status !== "resolved");
      app.innerHTML = `
        <p class="crumb"><a href="#/course/${s.course_id}">${esc(s.code)} ${esc(s.course)}</a></p>
        <h1>Class on ${when(s.started_at)}</h1>
        ${s.title ? `<p class="note">${esc(s.title)}</p>` : ""}
        ${unresolved.length ? `<button class="gold" data-scroll="review">Five-minute review (${unresolved.length} open)</button>` : ""}
        <section class="panel" aria-live="polite"><h2>Class summary</h2>${summaryBlock(d)}</section>
        <section class="panel" id="review"><h2>Your moments</h2><p class="note">Only you see this part.</p>
          ${d.events.length ? d.events.map((e) => eventBlock(e, d)).join("") : `<p class="empty-state">You didn't tap I'm lost in this class.</p>`}</section>
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
      const b = e.target.closest("button[data-ev]"); if (!b) return;
      const id = b.dataset.ev;
      if (b.dataset.do === "resolved" || b.dataset.do === "still") { await api(`/api/student/events/${id}/status`, { method: "POST", body: { status: b.dataset.do } }); toast(b.dataset.do === "resolved" ? "Marked resolved." : "Kept open."); draw(); }
      if (b.dataset.do === "oh") { const ta = $(`#oh-${id}`); await api(`/api/student/events/${id}/office-hours`, { method: "POST", body: { text: ta.value } }); toast("Saved. Lost doesn't send it anywhere."); }
      if (b.dataset.do === "copy") { const ta = $(`#oh-${id}`); try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch { ta.select(); toast("Select and copy the text."); } }
    };
    const onSubmit = async (e) => {
      const f = e.target.closest("form.check"); if (!f) return;
      e.preventDefault();
      const chosen = f.querySelector("input:checked"); if (!chosen) { f.querySelector(".check-result").textContent = "Pick an answer first."; return; }
      const r = await api(`/api/student/checks/${f.dataset.check}/answer`, { method: "POST", body: { chosen: Number(chosen.value) } }).catch((x) => ({ error: x.message }));
      if (r.error) { f.querySelector(".check-result").textContent = r.error; return; }
      f.querySelectorAll("input,button").forEach((x) => (x.disabled = true));
      f.querySelectorAll("label.choice").forEach((l, k) => { if (k === r.correctIndex) l.classList.add("right"); else if (l.contains(chosen)) l.classList.add("wrong"); });
      f.querySelector(".check-result").innerHTML = `${r.correct ? "<b>Right.</b>" : "<b>Not quite.</b>"} ${esc(r.why || "")}${r.correct ? " If it makes sense now, mark the moment resolved." : ""}`;
    };
    app.addEventListener("click", onClick); app.addEventListener("submit", onSubmit);
    Lost.onLeave(() => { app.removeEventListener("click", onClick); app.removeEventListener("submit", onSubmit); });
  }

  function summaryBlock(d) {
    if (d.summaryState === "not_ended") return `<p class="note">Class hasn't finished yet.</p>`;
    if (!d.summary) return d.summaryState === "failed" ? `<p><span class="badge bad">Not available</span> The summary couldn't be written. Your professor can retry it. Your own moments are below.</p>` : `<p><span class="badge">Being written</span> This page updates by itself, and you'll get a notification.</p>`;
    if (d.summary.status === "transcript_only") return `${d.summary.empty ? `<p class="note">Nothing was transcribed in this class.</p>` : `<p class="note">No AI summary for this class (the AI was off). Here is the transcript.</p><details><summary>Transcript</summary><div class="excerpt">${(d.transcript || []).map((l) => `<p><time>${fmt(l.t)}</time>${esc(l.text)}</p>`).join("")}</div></details>`}`;
    const s = d.summary.shared;
    return `<p class="note">Written by the AI from the lecture transcript and course materials. Tap a time or page next to a sentence to see its source.</p>${Lost.sharedSummary(s)}
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
      <h3><span class="at">${fmt(e.t)}</span>${esc(e.topic || "The part you marked")} <span class="badge ${e.status === "resolved" ? "good" : ""}">${e.status === "resolved" ? "Resolved" : "Open"}</span></h3>
      ${e.line ? `<p class="lost-at"><span>You got lost at</span>"${esc(e.line.text)}"</p>` : ""}
      ${e.question ? `<p class="note">Your question: ${esc(e.question)}</p>` : ""}
      ${card ? `<details><summary>The explanation you got</summary>${Lost.lesson(card, { headingLevel: 4 })}</details>` : ""}
      ${e.checks.filter((c) => c.chosen != null).map((c) => `<p class="note">${c.kind === "diagnostic" ? "Quick check" : c.kind === "review" ? "Review" : "Understanding check"}: ${c.correct ? "answered right" : "answered wrong"}.</p>`).join("")}
      ${e.review && e.review.chosen == null ? `<form class="check" data-check="${e.review.id}"><fieldset><legend><b>Review</b> (made by the AI from today's class): ${esc(e.review.question)}</legend>
        ${e.review.choices.map((ch, k) => `<label class="choice"><input type="radio" name="r-${e.review.id}" value="${k}"> ${esc(ch)}</label>`).join("")}</fieldset>
        <button class="primary">Answer</button><p class="check-result" aria-live="polite"></p></form>` : ""}
      <div class="row">${e.status === "resolved" ? `<button data-ev="${e.id}" data-do="still">Reopen</button>` : `<button data-ev="${e.id}" data-do="resolved">It makes sense now</button>`}</div>
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
