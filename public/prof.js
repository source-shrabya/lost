// Professor portal: dashboard, onboarding (institution -> Canvas -> courses -> confirm), course
// pages, the live teaching screen, and the after-class report.
(function () {
  const { $, $$, esc, fmt, when, ago, api, toast, safeUrl } = Lost;

  const sourceBadge = (src) => src === "demo" ? `<span class="badge warn" title="Sample data, not from a real Canvas account">Demo Canvas (sample data)</span>`
    : src === "canvas" ? `<span class="badge">Canvas</span>` : src === "upload" ? `<span class="badge">Uploaded</span>` : src === "notes" ? `<span class="badge">Pasted notes</span>` : `<span class="badge">Set up by hand</span>`;
  const syncBadge = (sync) => !sync ? `<span class="badge">Not synced</span>`
    : sync.status === "running" ? `<span class="badge">Syncing…</span>`
    : sync.status === "failed" ? `<span class="badge bad">Sync failed</span>`
    : sync.status === "partial" ? `<span class="badge warn">Synced with problems</span>` : `<span class="badge good">Synced</span>`;
  const sessionLabel = (s) => s.status === "live" ? "Live now" : s.status === "ready" ? "Not started" : s.status === "ending" ? "Ending…" : `Ended ${when(s.ended_at)}`;

  // ================= dashboard =================
  async function dashboard(app) {
    const { courses } = await api("/api/prof/courses");
    if (!courses.length && !Lost.me.onboarded) { location.hash = "#/onboarding"; return; }
    app.innerHTML = `
      <div class="page-head"><h1>Your courses</h1><a class="button" href="#/onboarding">Add courses</a></div>
      ${courses.length ? `<ul class="course-grid">${courses.map((c) => `
        <li class="course-card">
          ${Lost.courseArt(c.art, c.id)}
          <div class="cc-head"><span class="cc-code">${esc(c.code)}</span>${c.source === "demo" ? sourceBadge(c.source) : ["failed", "partial"].includes(c.sync?.status) ? syncBadge(c.sync) : ""}</div>
          <h2><a href="#/course/${c.id}">${esc(c.name)}</a></h2>
          <p class="note">${c.sections.map((s) => `${esc(s.name)} · ${s.students} student${s.students === 1 ? "" : "s"}`).join("<br>")}</p>
          ${c.active ? `<p class="cc-line"><span class="badge ${c.active.status === "live" ? "live" : ""}">${sessionLabel(c.active)}</span></p>` : c.recent?.taps ? `<p class="cc-line note">${c.recent.taps} tap${c.recent.taps === 1 ? "" : "s"} last class</p>` : ""}
          ${c.counts.total ? "" : `<p class="cc-line note">No materials yet</p>`}
          <a class="button primary" href="#/course/${c.id}">${c.active?.status === "live" ? "Return to class" : "Open class"}</a>
        </li>`).join("")}</ul>` : `<div class="empty-state"><p>No courses yet.</p><a class="button primary" href="#/onboarding">Set up your first course</a></div>`}`;
  }

  // ================= onboarding =================
  async function onboarding(app, _, params) {
    if (params.canvas) toast(params.canvas === "ok" ? "Canvas connected." : `Canvas: ${params.canvas}`, params.canvas === "ok" ? "" : "error");
    const st = await api("/api/canvas/status");
    const step = !st.institutionId ? 1 : !st.connection ? 2 : 3;
    const steps = ["Your institution", "Connect Canvas", "Pick courses and sections", "Confirm"];
    app.innerHTML = `
      <h1>Set up Lost</h1>
      <ol class="stepper">${steps.map((s, i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "current" : ""}" ${i + 1 === step ? 'aria-current="step"' : ""}>${s}</li>`).join("")}</ol>
      <div id="stepBody"></div>`;
    const body = $("#stepBody");
    if (step === 1) {
      body.innerHTML = `<section class="panel"><h2>Which institution do you teach at?</h2>
        <fieldset><legend class="visually-hidden">Institution</legend>${st.institutions.map((i) => `<label class="choice-card"><input type="radio" name="inst" value="${esc(i.id)}" ${i.id === "usm" ? "checked" : ""}><span><b>${esc(i.name)}</b><span class="note">Canvas at ${esc(i.canvas_host)}. ${esc(i.verified_note)}</span></span></label>`).join("")}</fieldset>
        <p class="note">Only institutions whose Canvas address has been checked are listed.</p>
        <button class="primary" id="instNext">Continue</button></section>`;
      $("#instNext").onclick = async () => { await api("/api/canvas/institution", { method: "POST", body: { institutionId: $("input[name=inst]:checked").value } }); Lost.render(); };
      return;
    }
    if (step === 2) {
      const inst = st.institutions.find((i) => i.id === st.institutionId);
      body.innerHTML = `<section class="panel">
        <h2>Connect Canvas</h2>
        <div class="three-steps">
          <p><b>1. Signing into Lost</b> is done. That's your Lost account.</p>
          <p><b>2. Authorizing Lost to read Canvas</b> is this step. You sign in on ${esc(inst.canvas_host)} itself and approve read access. Lost never sees your Canvas password.</p>
          <p><b>3. Linking courses and sections</b> comes next: you choose which ones Lost uses.</p>
        </div>
        <div class="connect-options">
          <div class="option">
            <h3>Sign in with Canvas</h3>
            ${st.oauth.ready ? `<p class="note">Opens ${esc(inst.canvas_host)} to approve access.</p><button class="primary" id="oauth">Continue to Canvas</button>`
              : `<p><span class="badge warn">Not available yet</span></p><p class="note">Canvas only lets an app request access with a developer key (client ID and secret) issued by the institution's Canvas administrator. This server doesn't have one, so the button is off. Missing: ${st.oauth.missing.map((m) => `<code>${esc(m)}</code>`).join(", ")}. The redirect address to give USM's Canvas admins: <code>${esc(st.oauth.redirectUri)}</code>.</p>`}
          </div>
          ${st.demo ? `<div class="option"><h3>Try it with demo data</h3><p class="note">Loads sample courses and materials. Everything made from it is labelled "Demo Canvas (sample data)" and never presented as your real Canvas.</p><button id="demo">Use demo Canvas data</button></div>` : ""}
          ${st.devToken ? `<div class="option"><h3>Developer token (testing only)</h3><p class="note">Uses the CANVAS_DEV_TOKEN set on this server: the developer's own Canvas account. Canvas's API policy doesn't allow asking other users for tokens.</p><button id="dev">Use the developer token</button></div>` : ""}
          <div class="option"><h3>No Canvas for now</h3><p class="note">Create a course by hand and upload slides or notes yourself.</p>
            <form id="manual" class="stack"><label for="mname">Course name</label><input id="mname" required placeholder="Computer Networks"><label for="mcode">Course code</label><input id="mcode" placeholder="CSC 311"><label for="msec">Section</label><input id="msec" placeholder="Section 001"><button>Create course</button></form></div>
        </div></section>`;
      $("#oauth")?.addEventListener("click", async () => { const r = await api("/api/canvas/connect", { method: "POST", body: { mode: "oauth" } }); location.href = r.redirect; });
      $("#demo")?.addEventListener("click", async () => { await api("/api/canvas/connect", { method: "POST", body: { mode: "demo" } }); Lost.render(); });
      $("#dev")?.addEventListener("click", async () => { try { await api("/api/canvas/connect", { method: "POST", body: { mode: "devtoken" } }); Lost.render(); } catch (e) { toast(e.message, "error"); } });
      $("#manual").onsubmit = async (e) => { e.preventDefault(); const r = await api("/api/prof/courses", { method: "POST", body: { name: $("#mname").value, code: $("#mcode").value, section: $("#msec").value || "Section 1" } }); location.hash = `#/course/${r.id}/materials`; };
      return;
    }
    // step 3 and 4: pick, then import and confirm
    body.innerHTML = `<section class="panel"><p class="note">Loading your Canvas courses…</p></section>`;
    let list;
    try { list = await api("/api/prof/canvas/courses"); }
    catch (e) { body.innerHTML = `<section class="panel">${Lost.errorBox(e.message)}<p><a href="#/canvas">Canvas connection settings</a></p></section>`; $("#retryView").onclick = () => Lost.render(); return; }
    body.innerHTML = `<section class="panel">
      <h2>Which courses and sections should use Lost?</h2>
      <p class="note">From ${esc(list.label)}${st.connection.canvasUser ? `, signed in as ${esc(st.connection.canvasUser)}` : ""}. Only courses where you are a teacher are listed.</p>
      <form id="pick">${list.courses.map((c) => `
        <fieldset class="pick-course"><legend><b>${esc(c.code)}</b> ${esc(c.name)} <span class="note">${esc(c.term)}</span>${c.linked ? ` <span class="badge good">Already in Lost</span>` : ""}</legend>
          ${c.sections.map((s) => `<label class="inline"><input type="checkbox" name="sec" data-course="${esc(c.id)}" value="${esc(s.id)}" ${s.linked ? "checked disabled" : ""}> ${esc(s.name)}${s.linked ? " (linked)" : ""}</label>`).join("") || `<p class="note">No sections found.</p>`}
        </fieldset>`).join("") || `<p>No teaching courses were found in Canvas.</p>`}
        <button class="primary" id="importBtn">Import selected and sync materials</button>
        <a class="button quiet" href="#/">Skip for now</a>
      </form>
      <div id="importResult" aria-live="polite"></div></section>`;
    $("#pick").onsubmit = async (e) => {
      e.preventDefault();
      const byCourse = {};
      for (const cb of $$("input[name=sec]:checked:not(:disabled)")) (byCourse[cb.dataset.course] ||= []).push(cb.value);
      const selections = Object.entries(byCourse).map(([canvasCourseId, sectionIds]) => ({ canvasCourseId, sectionIds }));
      if (!selections.length) { toast("Pick at least one section that isn't linked yet.", "error"); return; }
      $("#importBtn").disabled = true; $("#importBtn").textContent = "Importing and syncing…";
      try {
        const r = await api("/api/prof/canvas/import", { method: "POST", body: { selections } });
        const { courses } = await api("/api/prof/courses");
        $(".stepper li:nth-child(3)").className = "done"; $(".stepper li:nth-child(4)").className = "current";
        $("#importResult").innerHTML = `<h2>Imported</h2><ul class="plain">${r.results.map((x) => { const c = courses.find((y) => y.id === x.id); return `<li><b>${esc(c.code)} ${esc(c.name)}</b>: ${x.status === "failed" ? `<span class="badge bad">sync failed</span> ${esc(x.errors?.[0]?.error || "")}` : `${x.added} new, ${x.updated} updated, ${x.unchanged} unchanged. ${c.counts.students} visible to students, ${c.counts.staff} professor-only.`}</li>`; }).join("")}</ul>
          <a class="button primary" href="#/">Go to your courses</a>`;
        $("#importBtn").hidden = true;
      } catch (err) { toast(err.message, "error"); $("#importBtn").disabled = false; $("#importBtn").textContent = "Import selected and sync materials"; }
    };
  }

  // ================= Canvas connection =================
  async function canvasPage(app) {
    const st = await api("/api/canvas/status");
    const c = st.connection;
    app.innerHTML = `<h1>Canvas connection</h1>
      <section class="panel">${c ? `
        <p><b>${c.mode === "demo" ? "Demo Canvas (sample data)" : c.mode === "devtoken" ? "Developer token (testing only)" : "Connected with Canvas sign-in"}</b> · ${esc(c.institution)} (${esc(c.host)})${c.canvasUser ? ` · as ${esc(c.canvasUser)}` : ""}</p>
        ${c.status !== "ok" ? `<p class="form-error">${esc(c.error || "Canvas needs you to reconnect.")}</p>` : ""}
        <p class="note">Connected ${when(c.since)}.</p>
        <label class="inline"><input type="checkbox" id="rm"> Also remove materials imported from Canvas (uploads stay)</label>
        <div class="row"><button id="disc">Disconnect Canvas</button><a class="button" href="#/onboarding">Import more courses</a></div>`
        : `<p>Canvas isn't connected.</p><a class="button primary" href="#/onboarding">Connect Canvas</a>`}</section>`;
    $("#disc")?.addEventListener("click", async (e) => {
      if (!Lost.confirmButton(e.target, "Click again to disconnect")) return;
      await api("/api/canvas/disconnect", { method: "POST", body: { removeMaterials: $("#rm").checked } });
      toast("Canvas disconnected."); Lost.render();
    });
  }

  // ================= course =================
  async function coursePage(app, [id, view = "class"]) {
    const d = await api(`/api/prof/courses/${id}`);
    const c = d.course;
    const views = [["class", "Class"], ["materials", `Materials (${d.counts.total})`], ["history", "Past classes"], ["settings", "Settings"]];
    app.innerHTML = `
      <p class="crumb"><a href="#/">Your courses</a></p>
      <div class="page-head"><h1>${esc(c.code)} ${esc(c.name)}</h1>${sourceBadge(c.source)}</div>
      <nav class="subnav" aria-label="Course">${views.map(([k, label]) => `<a href="#/course/${id}/${k}" ${k === view ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
      <div id="view"></div>`;
    const v = $("#view");
    if (view === "class") return classView(v, d);
    if (view === "materials") return materialsView(v, d);
    if (view === "history") return historyView(v, d);
    if (view === "settings") return settingsView(v, d);
  }

  function classView(v, d) {
    const open = d.sessions.find((s) => ["ready", "live", "ending"].includes(s.status));
    const usable = d.materials.filter((m) => m.status === "ok");
    v.innerHTML = `
      ${open ? `<section class="panel highlight"><h2>${open.status === "live" ? "Class is live" : "A class is set up"}</h2>
        <p>${esc(d.sections.find((s) => s.id === open.section_id)?.name || "")}${open.title ? ` · ${esc(open.title)}` : ""} · ${sessionLabel(open)}</p>
        <a class="button primary big" href="#/live/${open.id}">${open.status === "live" ? "Return to the live class" : "Open the class screen"}</a></section>` : ""}
      <section class="panel">
        <h2>${open ? "Set up another section" : "Start a class"}</h2>
        <form id="newSession" class="stack">
          <label for="sec">Section</label>
          <select id="sec">${d.sections.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.students} students)</option>`).join("")}</select>
          <label for="ltitle">Today's topic (optional)</label><input id="ltitle" placeholder="For example: the basic rules">
          <details><summary>Lecture materials for the AI to use (${usable.length} available)</summary>
            <p class="note">Picked materials rank first when Lost explains something. Professor-only materials are never quoted to students.</p>
            ${usable.map((m) => `<label class="inline mat-pick"><input type="checkbox" name="mat" value="${m.id}"> ${esc(m.title)} ${m.visibility === "staff" ? `<span class="badge">Professor only</span>` : ""}</label>`).join("") || `<p class="note">No materials yet. <a href="#/course/${d.course.id}/materials">Add some</a>.</p>`}
          </details>
          <button class="primary big">Set up class</button>
        </form>
        <p class="note">Setting up doesn't start recording. Press Start when you're ready.</p>
      </section>`;
    $("#newSession").onsubmit = async (e) => {
      e.preventDefault();
      const r = await api(`/api/prof/courses/${d.course.id}/sessions`, { method: "POST", body: { sectionId: $("#sec").value, title: $("#ltitle").value, materialIds: $$("input[name=mat]:checked").map((x) => x.value) } });
      if (r.resumed) toast("That section already has an open class, so Lost opened it instead of making a duplicate.");
      location.hash = `#/live/${r.id}`;
    };
  }

  function materialsView(v, d) {
    const s = d.sync;
    const canvasCourse = d.course.source !== "manual";
    v.innerHTML = `
      ${canvasCourse ? `<section class="panel">
        <div class="page-head"><h2>${d.course.source === "demo" ? "Demo Canvas (sample data)" : "Canvas"} sync</h2><button id="syncNow" ${d.canvasConnected ? "" : "disabled"}>Sync now</button></div>
        ${!d.canvasConnected ? `<p class="form-error">Canvas isn't connected, so this course can't sync. <a href="#/canvas">Connect Canvas</a></p>` : ""}
        ${s ? `<p>${syncBadge(s)} Last attempt ${when(s.startedAt)}. Last successful sync: ${s.lastSuccess ? when(s.lastSuccess) : "none yet"}.</p>
          <p class="note">Last run: ${s.added} new, ${s.updated} updated, ${s.unchanged} unchanged, ${s.removed} removed. Unchanged items are not downloaded again.</p>
          ${s.errors?.length ? `<details ${s.status === "failed" ? "open" : ""}><summary>${s.errors.length} problem${s.errors.length === 1 ? "" : "s"}</summary><ul class="plain">${s.errors.map((e) => `<li><b>${esc(e.title)}</b>: ${esc(e.error)}</li>`).join("")}</ul></details>` : ""}` : `<p class="note">Not synced yet.</p>`}
        <p class="note">Who can see what follows Canvas: unpublished, hidden or locked items are kept professor-only and never quoted to students. You can make an item stricter here, not looser.</p>
      </section>` : ""}
      <section class="panel">
        <h2>Add your own</h2>
        <div class="row">
          <label class="button filebtn">Upload PDF, PPTX, DOCX or TXT<input type="file" id="files" accept=".pdf,.pptx,.docx,.txt" multiple hidden></label>
          <label class="inline"><input type="checkbox" id="upStaff"> Professor only</label>
        </div>
        <p class="note" id="upNote" role="status"></p>
        <details><summary>Paste notes</summary><form id="notesForm" class="stack"><label for="ntitle">Title</label><input id="ntitle" value="Lecture notes"><label for="ntext">Text</label><textarea id="ntext" rows="6"></textarea><button>Add notes</button></form></details>
      </section>
      <section class="panel">
        <h2>Materials</h2>
        ${d.materials.length ? `<ul class="mat-list">${d.materials.map((m) => `
          <li class="mat ${m.status === "removed" ? "removed" : ""}" data-id="${m.id}">
            <div class="mat-main"><b>${safeUrl(m.url) ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : esc(m.title)}</b>
              <span class="note">${sourceBadge(m.source)} ${m.module ? `${esc(m.module)} · ` : ""}${m.passages} passage${m.passages === 1 ? "" : "s"}${m.synced_at ? ` · updated ${ago(m.synced_at)}` : ""}</span>
              <span class="note">${m.status === "removed" ? `<span class="badge">Removed from Canvas</span>` : m.visibility === "students" ? `<span class="badge good">Students can see</span>` : `<span class="badge">Professor only</span>`} ${esc(m.visibility_reason)}</span>
              ${m.warning ? `<span class="note warn">${esc(m.warning)}</span>` : ""}</div>
            ${m.status !== "removed" ? `<div class="mat-actions">
              <label class="inline"><input type="checkbox" class="use" ${m.use_in_class ? "checked" : ""}> Use in class</label>
              ${m.visibility === "students" ? `<button class="quiet hide">Make professor-only</button>` : (m.source === "upload" || m.source === "notes") ? `<button class="quiet show">Let students see</button>` : ""}
              ${m.source === "upload" || m.source === "notes" ? `<button class="quiet del">Delete</button>` : ""}</div>` : ""}
          </li>`).join("")}</ul>` : `<p class="empty-state">No materials yet.</p>`}
      </section>`;
    const id = d.course.id;
    $("#syncNow")?.addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Syncing…";
      try { const r = await api(`/api/prof/courses/${id}/sync`, { method: "POST" }); toast(r.status === "failed" ? `Sync failed: ${r.errors?.[0]?.error || ""}` : `Sync done: ${r.added} new, ${r.updated} updated, ${r.removed} removed.`, r.status === "failed" ? "error" : ""); }
      catch (err) { toast(err.message, "error"); }
      Lost.render();
    });
    $("#files").onchange = async () => {
      for (const f of $("#files").files) {
        $("#upNote").textContent = `Reading ${f.name}…`;
        try {
          const r = await api(`/api/prof/courses/${id}/materials?visibility=${$("#upStaff").checked ? "staff" : "students"}`, { method: "POST", raw: f, headers: { "x-filename": encodeURIComponent(f.name) } });
          $("#upNote").textContent = r.status === "ok" ? `Added ${f.name} (${r.passages} passages).` : `${f.name}: ${r.warning}`;
        } catch (e) { $("#upNote").textContent = `${f.name}: ${e.message}`; }
      }
      Lost.render();
    };
    $("#notesForm").onsubmit = async (e) => { e.preventDefault(); await api(`/api/prof/courses/${id}/notes`, { method: "POST", body: { title: $("#ntitle").value, text: $("#ntext").value, visibility: $("#upStaff").checked ? "staff" : "students" } }); toast("Notes added."); Lost.render(); };
    v.addEventListener("change", async (e) => {
      const li = e.target.closest(".mat"); if (!li || !e.target.classList.contains("use")) return;
      await api(`/api/prof/materials/${li.dataset.id}`, { method: "POST", body: { use_in_class: e.target.checked } });
    });
    v.addEventListener("click", async (e) => {
      const li = e.target.closest(".mat"); if (!li) return;
      if (e.target.classList.contains("hide")) { await api(`/api/prof/materials/${li.dataset.id}`, { method: "POST", body: { visibility: "staff" } }); Lost.render(); }
      if (e.target.classList.contains("show")) { await api(`/api/prof/materials/${li.dataset.id}`, { method: "POST", body: { visibility: "students" } }); Lost.render(); }
      if (e.target.classList.contains("del") && Lost.confirmButton(e.target, "Click again to delete")) { await api(`/api/prof/materials/${li.dataset.id}/delete`, { method: "POST" }); Lost.render(); }
    });
  }

  function historyView(v, d) {
    const done = d.sessions.filter((s) => s.status === "ended");
    v.innerHTML = `<section class="panel"><h2>Past classes</h2>${done.length ? `<ul class="plain list-rows">${done.map((s) => `
      <li><a href="#/session/${s.id}"><b>${when(s.started_at)}</b>${s.title ? ` · ${esc(s.title)}` : ""}</a>
        <span class="note">${esc(d.sections.find((x) => x.id === s.section_id)?.name || "")} · ${s.taps} tap${s.taps === 1 ? "" : "s"} · summary: ${summaryWord(s)}</span></li>`).join("")}</ul>`
      : `<p class="empty-state">No finished classes yet.</p>`}</section>`;
  }
  const summaryWord = (s) => s.summary === "ready" ? "published" : s.summary === "transcript_only" ? "transcript only" : s.summary === "failed" ? "failed" : "being written";

  function settingsView(v, d) {
    const c = d.course;
    v.innerHTML = `
      <section class="panel"><h2>Join codes</h2><ul class="plain">${d.sections.map((s) => `<li><b>${esc(s.name)}</b>: <code class="joincode">${esc(s.join_code)}</code> · ${s.students} students</li>`).join("")}</ul>
        <p class="note">Students who use this code join that section. ${c.source !== "manual" ? "Students who link their Canvas account are matched to their Canvas section automatically." : ""}</p></section>
      <section class="panel"><h2>Support links for students</h2>
        <form id="settings" class="stack">
          <label for="oh">Office hours link (https)</label><input id="oh" type="url" value="${esc(c.office_hours_url)}" placeholder="https://">
          <label for="tut">Tutoring link (https)</label><input id="tut" type="url" value="${esc(c.tutoring_url)}" placeholder="https://">
          <label for="terms">Course terms for the speech engine, one per line</label><textarea id="terms" rows="5">${esc(c.terms)}</textarea>
          <p class="note">Terms help the transcript spell course words. Only the terms are sent to the speech engine, not your files.</p>
          <fieldset class="art-pick"><legend>Course card drawing</legend>
            <label class="art-opt"><input type="radio" name="art" value=""${!c.artChosen ? " checked" : ""}> <span>Pick for me <span class="note">(now: ${esc((d.artChoices.find((a) => a.id === c.art) || {}).label || "General")})</span></span></label>
            ${d.artChoices.map((a) => `<label class="art-opt"><input type="radio" name="art" value="${a.id}"${c.artChosen === a.id ? " checked" : ""}> <span class="art-icons">${a.icons.slice(0, 3).map(Lost.artIcon).join("")}</span><span>${esc(a.label)}</span></label>`).join("")}
            <p class="note">Line drawings made for Lost. Students see them on their course card.</p>
          </fieldset>
          <button class="primary">Save</button></form></section>`;
    $("#settings").onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/api/prof/courses/${c.id}/settings`, { method: "POST", body: { office_hours_url: $("#oh").value, tutoring_url: $("#tut").value, terms: $("#terms").value, art: document.querySelector("input[name=art]:checked")?.value || "" } }); toast("Saved."); }
      catch (err) { toast(err.message, "error"); }
    };
  }

  // ================= live teaching screen =================
  async function liveScreen(app, [sid]) {
    const info = await api(`/api/prof/sessions/${sid}`);
    if (info.session.status === "ended") { location.hash = `#/session/${sid}`; return; }
    const S = { lines: [], rev: -1, since: 0, status: info.session.status, marks: {} };
    app.innerHTML = `
      <div class="live-head">
        <div><p class="crumb"><a href="#/course/${info.course.id}">${esc(info.course.code)} ${esc(info.course.name)}</a></p><h1>${esc(info.section.name)}</h1></div>
        <div class="live-stats" aria-live="off">
          <span id="phase" class="badge"></span>
          <span><b id="clock">0:00</b> <span class="note">elapsed</span></span>
          <span><b id="present">0</b> <span class="note">connected</span></span>
          <span id="lostNow" class="lost-now"><b>0</b> lost in the last 90 s</span>
        </div>
      </div>
      <section class="join-panel" id="joinPanel">
        <div><p class="sign-label">Students sign in at</p><p class="sign-code site-url">${esc(info.site.replace(/^https?:\/\//, ""))}</p>
          <p class="note">${info.section.students} student${info.section.students === 1 ? "" : "s"} in ${esc(info.section.name)}. They sign in with their school email and land in this class when you press Start. No codes.</p>
          <div class="row"><button class="primary big" id="startBtn">Start class</button><button id="discard" class="quiet">Discard</button></div>
          <p class="note">Start turns on your mic. Your words become the transcript.</p></div>
      </section>
      <div class="teach" id="teach">
        <section class="panel transcript-panel">
          <div class="mic-bar">
            <button id="mic" class="micbtn" aria-pressed="false" aria-describedby="micHint" title="Turn microphone on or off (Space or M)">
              <svg class="mic-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/><path class="mic-slash" d="M4 4l16 16"/></svg>
              <span class="mic-state" id="micState">Microphone off</span>
            </button>
            <p class="mic-hint" id="micHint"><kbd>Space</kbd> or <kbd>M</kbd> turns it on or off. Only this microphone is recorded, not computer audio.</p>
            <div class="mic-side">
              <button id="keysBtn" class="tool" aria-haspopup="dialog" title="Keyboard shortcuts (?)">Shortcuts <kbd>?</kbd></button>
              <button id="showCode" class="tool" aria-haspopup="dialog">Sign-in link</button>
              <button id="endBtn" class="danger" aria-haspopup="dialog">End class…</button>
            </div>
          </div>
          <p class="note warn" id="micErr" role="status"></p>
          <div class="row spread"><h2>Transcript</h2></div>
          <div id="transcript" class="transcript" tabindex="0" aria-label="Transcript"></div>
          <p id="interim" class="interim"></p>
          <form id="typeForm" class="row"><label for="typed" class="visually-hidden">Type a line</label><input id="typed" placeholder="Mic not picking you up? Type a line and press Enter"><button>Add</button></form>
        </section>
        <section class="panel"><h2>Taps so far</h2><div id="strip"></div></section>
      </div>
      <details class="panel diag"><summary>Setup and diagnostics</summary><div id="diag"></div>
        ${info.demo ? `<div class="demo-tools"><h3>Demo tools <span class="badge warn">sample text</span></h3><p class="note">Types a short sample lecture into the transcript. Those lines are stored as "sample", and the AI and the summary are told so. Say out loud that you're using it.</p><button id="sample">Play sample lecture</button></div>` : ""}
      </details>
      <dialog id="codeDlg" class="code-dlg" aria-labelledby="codeDlgH"><h2 id="codeDlgH">Students sign in at</h2><p class="sign-code site-url">${esc(info.site.replace(/^https?:\/\//, ""))}</p><p>With their school email. No codes.</p><form method="dialog"><button class="primary">Close</button></form></dialog>
      <dialog id="endDlg" class="confirm-dlg" aria-labelledby="endDlgH" aria-describedby="endDlgP"><h2 id="endDlgH">End class for everyone?</h2>
        <p id="endDlgP">Recording stops, students leave the live view, and Lost writes the class summary. To pause instead, turn the microphone off.</p>
        <form method="dialog" class="row"><button value="stay" class="primary" autofocus>Keep teaching</button><button value="end" class="danger">End class</button></form></dialog>
      <dialog id="keysDlg" class="confirm-dlg" aria-labelledby="keysDlgH"><h2 id="keysDlgH">Keyboard shortcuts</h2>
        <dl class="keys-list">
          <div><dt><kbd>Space</kbd> or <kbd>M</kbd></dt><dd>Turn the microphone on or off</dd></div>
          <div><dt><kbd>T</kbd></dt><dd>Type a transcript line</dd></div>
          <div><dt><kbd>L</kbd></dt><dd>Show the students' sign-in link</dd></div>
          <div><dt><kbd>E</kbd></dt><dd>End class (asks first)</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>This list</dd></div>
        </dl>
        <p class="note">Shortcuts pause while you type, while a dialog is open, and when a focused button already uses the key. Each one has a button on screen too.</p>
        <form method="dialog"><button class="primary" autofocus>Close</button></form></dialog>`;

    const paintPhase = () => {
      document.body.dataset.phase = S.status;
      $("#phase").textContent = { ready: "Not started", live: "Live", ending: "Ending…", ended: "Ended" }[S.status];
      $("#phase").className = `badge ${S.status === "live" ? "live" : ""}`;
      $("#joinPanel").hidden = S.status !== "ready";
      $("#teach").hidden = S.status === "ready";
    };
    paintPhase();
    $("#discard").onclick = async (e) => { if (!Lost.confirmButton(e.target, "Click again to discard")) return; await api(`/api/prof/sessions/${sid}/end`, { method: "POST" }); location.hash = `#/course/${info.course.id}`; };
    $("#startBtn").onclick = async () => { const r = await api(`/api/prof/sessions/${sid}/start`, { method: "POST" }); S.status = r.status; paintPhase(); startMic(); };
    $("#showCode").onclick = () => $("#codeDlg").showModal();
    // Ending always goes through the dialog; nothing ends class in one keystroke.
    const endClass = async () => {
      const b = $("#endBtn"); b.disabled = true; b.textContent = "Ending…";
      await stopMic(true); // send the audio already recorded, then end
      await api(`/api/prof/sessions/${sid}/end`, { method: "POST" });
      S.status = "ending"; paintPhase();
    };
    $("#endBtn").onclick = () => $("#endDlg").showModal();
    $("#endDlg").addEventListener("close", () => { if ($("#endDlg").returnValue === "end") endClass(); else $("#endBtn").focus(); $("#endDlg").returnValue = ""; });
    $("#keysBtn").onclick = () => $("#keysDlg").showModal();
    const anyDialog = () => !!document.querySelector("dialog[open]");
    const onKey = (e) => {
      if (S.status !== "live") return;
      const act = LostKeys.shortcutFor(e, { dialogOpen: anyDialog(), map: { " ": "mic", m: "mic", "?": "keys", t: "type", l: "link", e: "end" } });
      if (!act) return;
      e.preventDefault(); // only now: Space scrolls the page unless it did something here
      if (act === "mic") toggleMic();
      if (act === "keys") $("#keysDlg").showModal();
      if (act === "type") $("#typed").focus();
      if (act === "link") $("#codeDlg").showModal();
      if (act === "end") $("#endDlg").showModal();
    };
    document.addEventListener("keydown", onKey);
    Lost.onLeave(() => document.removeEventListener("keydown", onKey));
    // Signing out mid-class: the header's dialog asks what to do with the class and the mic.
    Lost.signOutGuard = () => S.status === "live" ? { micOn: mic.listening, muteMic: () => stopMic(), endClass } : null;
    Lost.onLeave(() => { Lost.signOutGuard = null; });
    $("#typeForm").onsubmit = async (e) => { e.preventDefault(); const t = $("#typed").value.trim(); if (!t) return; $("#typed").value = ""; await api(`/api/prof/sessions/${sid}/line`, { method: "POST", body: { text: t, origin: "typed" } }).catch((x) => toast(x.message, "error")); };
    let micBusy = false;
    const toggleMic = async () => { if (micBusy) return; micBusy = true; try { await (mic.listening ? stopMic() : startMic()); } finally { micBusy = false; } };
    $("#mic").onclick = toggleMic;
    $("#sample")?.addEventListener("click", async (e) => {
      if (S.status !== "live") { toast("Start the class first."); return; }
      e.target.disabled = true;
      for (const line of SAMPLE) { if (S.status !== "live") break; await api(`/api/prof/sessions/${sid}/line`, { method: "POST", body: { text: line, origin: "sample" } }); await new Promise((r) => setTimeout(r, 3500)); }
      e.target.disabled = false;
    });

    // Fix a transcript line: double-click (or Enter on a focused line).
    let editing = false;
    const editLine = (p) => {
      if (!p || editing) return;
      editing = true;
      const words = p.querySelector(".words"), input = document.createElement("input");
      input.value = words.textContent; input.className = "fix"; input.setAttribute("aria-label", "Fix this line");
      words.replaceWith(input); input.focus();
      const done = async (save) => {
        if (!editing) return; editing = false;
        if (save && input.value.trim() && input.value.trim() !== words.textContent) await api(`/api/prof/sessions/${sid}/line-edit`, { method: "POST", body: { idx: Number(p.dataset.i), text: input.value.trim() } });
        input.replaceWith(words); S.rev = -1;
      };
      input.onkeydown = (k) => { if (k.key === "Enter") done(true); if (k.key === "Escape") done(false); };
      input.onblur = () => done(true);
    };
    $("#transcript").addEventListener("dblclick", (e) => editLine(e.target.closest("p[data-i]")));
    $("#transcript").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("p[data-i]")) editLine(e.target); });

    let transcriberMode = info.transcription.mode;
    Lost.poll(async (signal) => {
      const d = await api(`/api/prof/sessions/${sid}/live?since=${S.since}&rev=${S.rev}`, { signal });
      if (d.status !== S.status) { S.status = d.status; paintPhase(); if (d.status === "ended") { toast("Class ended. The summary is being written."); location.hash = `#/session/${sid}`; return; } }
      transcriberMode = d.transcription.mode;
      if (mic.listening) syncRecognition(transcriberMode);
      $("#clock").textContent = fmt(d.clock);
      $("#present").textContent = d.present;
      $("#lostNow").innerHTML = `<b>${d.lostNow}</b> lost in the last 90 s`;
      $("#lostNow").classList.toggle("alert", d.present > 0 && d.lostNow / Math.max(1, d.present) >= 0.1);
      if (d.full) S.lines = [];
      for (const l of d.lines) S.lines[l.idx] = l;
      S.since = S.lines.length; S.rev = d.rev;
      const marksChanged = JSON.stringify(d.marks) !== JSON.stringify(S.marks); S.marks = d.marks;
      if ((d.lines.length || d.full || marksChanged) && !editing) paintTranscript();
      if (transcriberMode === "server") $("#interim").textContent = d.interim;
      $("#strip").innerHTML = tapStrip(d.taps, d.clock, d.gaps);
      $("#diag").innerHTML = `<dl class="diag-list">
        <dt>Microphone</dt><dd>${mic.listening ? "On" : "Off"}${mic.err ? ` · ${esc(mic.err)}` : ""}</dd>
        <dt>Transcription</dt><dd>${esc(d.transcription.name)}${d.transcription.status ? ` · ${esc(d.transcription.status)}` : ""}</dd>
        <dt>AI help</dt><dd>${d.ai.available ? `On (${esc(d.ai.model || d.ai.provider)})` : "Off: students get the transcript excerpt and matching course materials instead of AI explanations."}</dd>
        <dt>Transcript gaps</dt><dd>${d.gaps.length ? d.gaps.map((g) => `${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)} (${esc(g.reason)})`).join("; ") : "None"}</dd></dl>`;
    });
    function paintTranscript() {
      const box = $("#transcript");
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.innerHTML = S.lines.filter(Boolean).slice(-300).map((l) => {
        const n = S.marks[l.idx] || 0;
        return `<p data-i="${l.idx}" tabindex="-1" class="${n ? "marked" : ""}" title="Double-click to fix a mistake"><time>${fmt(l.t)}</time><span class="words">${withUnsure(l)}</span>${l.origin === "sample" ? ` <span class="tag">sample</span>` : l.origin === "typed" ? ` <span class="tag">typed</span>` : ""}${l.original ? ` <span class="tag" title="Original: ${esc(l.original)}">edited</span>` : ""}${n ? ` <span class="lostmark">${n} lost here</span>` : ""}</p>`;
      }).join("") || `<p class="note">Start talking. Your words show up here.</p>`;
      if (atBottom) box.scrollTop = box.scrollHeight;
    }
    function withUnsure(l) {
      let html = esc(l.text);
      for (const w of new Set(l.unsure || [])) {
        const e = esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        html = html.replace(new RegExp(`(^|\\s)(${e})(?=\\s|$)`), `$1<span class="unsure" title="The speech engine wasn't sure about this word">$2</span>`);
      }
      return html;
    }

    // ---------- mic: audio relay to the server, plus Chrome recognition when the server can't transcribe ----------
    const mic = { listening: false, stream: null, rec: null, recog: null, err: "",
      sender: new LostKeys.MicSender((piece, first) => api(`/api/prof/sessions/${sid}/audio?first=${first ? 1 : 0}`, { method: "POST", raw: piece })) };
    const paintMic = () => {
      const on = mic.listening;
      $("#mic").classList.toggle("on", on); $("#mic").setAttribute("aria-pressed", String(on));
      $("#micState").textContent = on ? "Microphone on" : "Microphone off";
      document.body.dataset.mic = on ? "on" : "off";
      Lost.announce(on ? "Microphone on" : "Microphone off");
    };
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    async function startMic() {
      if (mic.listening) return;
      try { mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { mic.err = `Mic blocked (${e.message}). Type lines below instead.`; $("#micErr").textContent = mic.err; return; }
      mic.listening = true; mic.err = ""; $("#micErr").textContent = "";
      paintMic();
      const type = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      if (type) {
        mic.rec = new MediaRecorder(mic.stream, { mimeType: type, audioBitsPerSecond: 32000 });
        mic.sender.start();
        mic.rec.ondataavailable = (e) => { if (e.data.size) mic.sender.push(e.data); };
        mic.rec.start(1000);
      } else { mic.err = "This browser can't send audio to the server; use Chrome."; }
      syncRecognition(transcriberMode);
    }
    function syncRecognition(mode) {
      if (mode === "server" && mic.recog) { const r = mic.recog; mic.recog = null; r.onend = null; r.stop(); }
      if (mode !== "server" && !mic.recog && Rec && mic.listening) {
        const r = new Rec(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
        r.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const x = e.results[i];
            if (x.isFinal) api(`/api/prof/sessions/${sid}/line`, { method: "POST", body: { text: x[0].transcript, origin: "speech" } }).catch(() => {});
            else interim += x[0].transcript;
          }
          $("#interim").textContent = interim;
        };
        r.onerror = (e) => { if (e.error === "not-allowed") { mic.err = "Speech recognition blocked. Type lines below."; $("#micErr").textContent = mic.err; } };
        r.onend = () => { if (mic.listening && mic.recog === r) try { r.start(); } catch {} };
        mic.recog = r; r.start();
      }
      if (mode !== "server" && !Rec) $("#micErr").textContent = "No speech engine on the server and this browser has no speech recognition. Use Chrome, or type below.";
    }
    async function stopMic(flush = false) {
      if (!mic.listening) return;
      mic.listening = false;
      if (mic.recog) { const r = mic.recog; mic.recog = null; r.onend = null; r.stop(); }
      // Muting: drop pieces not yet sent and stop the tracks at once. Ending: send what was recorded.
      const sending = mic.sender.stop({ flush });
      if (!flush) mic.stream?.getTracks().forEach((t) => t.stop());
      if (mic.rec && mic.rec.state !== "inactive") { const stopped = new Promise((ok) => (mic.rec.onstop = ok)); mic.rec.stop(); await stopped; }
      mic.sender.closed();
      if (flush) await sending;
      mic.stream?.getTracks().forEach((t) => t.stop()); mic.stream = null; mic.rec = null;
      await api(`/api/prof/sessions/${sid}/audio`, { method: "DELETE" }).catch(() => {});
      paintMic(); $("#interim").textContent = "";
    }
    if (S.status === "live") toast("Class is live. Press Space or the microphone button to turn it back on.");
    Lost.onLeave(() => stopMic());
  }

  // Small live strip: taps per 30 s, gaps shaded.
  function tapStrip(taps, clock, gaps) {
    const bin = 30, n = Math.max(10, Math.ceil(clock / bin)), counts = Array(n).fill(0);
    taps.forEach((t) => counts[Math.min(n - 1, Math.floor(t / bin))]++);
    const max = Math.max(3, ...counts), W = 600, H = 70, w = W / n;
    return `<svg viewBox="0 0 ${W} ${H + 16}" class="strip" role="img" aria-label="${taps.length} taps so far, in 30-second bars">
      ${gaps.map((g) => `<rect x="${(g.from_t / bin) * w}" y="0" width="${Math.max(2, (((g.to_t ?? clock) - g.from_t) / bin) * w)}" height="${H}" class="gap"><title>No audio ${fmt(g.from_t)}-${g.to_t == null ? "now" : fmt(g.to_t)}</title></rect>`).join("")}
      ${counts.map((c, i) => `<rect x="${i * w + 1}" y="${H - (c / max) * (H - 4)}" width="${w - 2}" height="${(c / max) * (H - 4)}" class="bar"><title>${fmt(i * bin)}: ${c} taps</title></rect>`).join("")}
      <line x1="0" x2="${W}" y1="${H + 0.5}" y2="${H + 0.5}" class="grid"/><text x="0" y="${H + 14}" class="tick">0:00</text><text x="${W}" y="${H + 14}" class="tick" text-anchor="end">${fmt(n * bin)}</text></svg>
      <p class="note">Each bar is 30 seconds. ${gaps.length ? "Shaded: no audio reached the server." : ""}</p>`;
  }

  const SAMPLE = [
    "Okay, last time we did single parity: one extra bit so the number of ones is even.",
    "Single parity catches any one flipped bit, but if two bits flip, the count is even again and we miss it.",
    "So today: two-dimensional parity. Put the data bits in a grid, rows and columns.",
    "We compute a parity bit for every row and for every column, plus one corner bit.",
    "Now if one bit flips, exactly one row check fails and exactly one column check fails.",
    "The intersection of that row and that column is the bad bit, so the receiver can flip it back. That's correction, not just detection.",
    "Look at slide 5: rows 1010, 1100, 0111. If row 2, column 3 flips, row 2 and column 3 both fail.",
    "Next we'll look at the Internet checksum, which is cheaper but weaker.",
  ];

  // ================= after-class report =================
  async function reportPage(app, [sid]) {
    const draw = async () => {
      const d = await api(`/api/prof/sessions/${sid}/report`);
      if (["ready", "live", "ending"].includes(d.session.status)) {
        if (d.session.status !== "ending") { location.hash = `#/live/${sid}`; return; }
      }
      const a = d.analytics, t = a.totals, sm = d.summary;
      const state = !sm || sm.status === "pending" ? (d.job?.status === "failed" ? "failed" : "pending") : sm.status;
      app.innerHTML = `
        <p class="crumb"><a href="#/course/${d.course.id}/history">${esc(d.course.code)} ${esc(d.course.name)}</a></p>
        <h1>Class on ${when(d.session.started_at)}</h1>
        <p class="note">${esc(d.section.name)}${d.session.title ? ` · ${esc(d.session.title)}` : ""} · ${fmt(a.duration)} long</p>
        <section class="panel" aria-live="polite">
          <h2>Class summary for students</h2>
          ${state === "pending" ? `<p><span class="badge">Being written</span> ${d.job?.attempts > 1 ? `Attempt ${d.job.attempts} of ${d.job.max}. ${esc(d.job.error || "")}` : "Students get a notification when it's published."}</p>`
            : state === "failed" ? `<p><span class="badge bad">Failed</span> ${esc(sm?.error || d.job?.error || "The summary couldn't be written.")}</p><button id="retrySum" class="primary">Try again</button>`
            : state === "transcript_only" ? `<p><span class="badge warn">Transcript only</span> ${sm.payload?.empty ? "Nothing was transcribed in this class, so students got an empty summary notice." : "The AI was off, so students got the transcript and their own moments without an AI summary."}</p>`
            : `<p><span class="badge good">Published to students</span> They were notified. Each student also sees a private section with their own moments.</p>
               <details><summary>See what students see</summary>${sharedSummary(sm.payload.shared)}</details>`}
        </section>
        <section class="panel">
          <h2>Where confusion happened</h2>
          <dl class="stat-row">
            <div><dt>Taps</dt><dd>${t.taps}</dd><p class="note">Every press of I'm lost.</p></div>
            <div><dt>Different students</dt><dd>${t.students}</dd><p class="note">Counted once each.</p></div>
            <div><dt>Marked resolved</dt><dd>${t.resolved}</dd><p class="note">Students said "That helped".</p></div>
            <div><dt>Not resolved</dt><dd>${t.unresolved}</dd><p class="note">No "That helped" yet.</p></div>
            <div><dt>Checks passed</dt><dd>${t.checksPassed}</dd><p class="note">Right answers on understanding checks.</p></div>
          </dl>
          ${a.bins.some((b) => b.taps) ? Lost.tapChart(a.bins, a.binSeconds) : `<p class="empty-state">Nobody tapped during this class.</p>`}
          ${t.categories ? `<p class="note">What students said lost them: ${Object.entries(t.categories).map(([k, v]) => `${esc(catName(k))} ${v}`).join(", ")}.</p>` : t.taps ? `<p class="note">Fewer than 3 students tapped, so the breakdown is hidden: it could point to one person.</p>` : ""}
        </section>
        ${a.moments.length ? `<section class="panel"><h2>Moments</h2><p class="note">Taps less than a minute apart are grouped. Topic labels marked "inferred" are the AI's reading of the transcript, with the lines it used.</p>
          ${a.moments.map((m) => momentCard(m, a.notes.filter((n) => n.moment_idx === m.index))).join("")}</section>` : ""}`;
      $("#retrySum")?.addEventListener("click", async () => { await api(`/api/prof/sessions/${sid}/retry-summary`, { method: "POST" }); draw(); });
      return state;
    };
    const first = await draw();
    if (first === "pending") Lost.poll(async () => { const s = await draw(); if (s !== "pending") Lost.render(); }, 3000);
    const onAct = async (e) => {
      const b = e.target.closest("button[data-act]"); if (!b) return;
      const idx = b.dataset.m, kind = b.dataset.act, out = $(`#act-${idx}`);
      b.disabled = true;
      try {
        const r = await api(`/api/prof/sessions/${sid}/moments/${idx}`, { method: "POST", body: { kind } });
        if (kind === "material") out.innerHTML = r.passages.length ? `<h4>Related material</h4><ul class="plain">${r.passages.map((p) => `<li><b>${safeUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</b>${p.location ? `, ${esc(p.location)}` : ""} ${p.visibility === "staff" ? `<span class="badge">Professor only</span>` : ""}<p class="note">${esc(p.text)}</p></li>`).join("")}</ul>` : `<p class="note">No matching material found.</p>`;
        else if (kind === "revisit") { out.innerHTML = `<p class="note">Added to your revisit list for this class.</p>`; }
        else out.innerHTML = `<h4>${kind === "clarification" ? "Draft clarification" : "Suggested support"} <span class="badge">AI draft, not sent</span></h4><textarea rows="6" aria-label="Draft">${esc(r.text)}</textarea><p class="note">Lost never sends or publishes this. Copy it if you want to use it.</p>`;
      } catch (err) { out.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
      b.disabled = false;
    };
    app.addEventListener("click", onAct);
    Lost.onLeave(() => app.removeEventListener("click", onAct));
  }
  const catName = (k) => ({ term: "a term", reasoning: "a reasoning step", connection: "a connection", missed: "missed speech", "not chosen": "didn't say" }[k] || k);
  function momentCard(m, notes) {
    return `<article class="moment">
      <h3><span class="at">${fmt(m.start)}${m.end - m.start > 1 ? `-${fmt(m.end)}` : ""}</span>${m.topic ? `${esc(m.topic)} <span class="badge" title="Label written by the AI from the transcript">inferred</span>` : "Students tapped here"}</h3>
      <p class="note">${m.taps} tap${m.taps === 1 ? "" : "s"} · ${m.small ? "fewer than 3 students (details hidden so no one is singled out)" : `${m.students} students · ${m.resolved} resolved, ${m.unresolved} not yet`}</p>
      ${m.categories ? `<p class="note">${Object.entries(m.categories).map(([k, v]) => `${esc(catName(k))}: ${v}`).join(" · ")}</p>` : ""}
      ${m.lines.length ? `<div class="excerpt"><span class="label">What you were saying</span>${m.lines.map((l) => `<p><time>${fmt(l.t)}</time>"${esc(l.text)}" <b class="note">${l.taps} tap${l.taps === 1 ? "" : "s"}</b></p>`).join("")}</div>` : `<p class="note">Nothing was transcribed right before these taps.</p>`}
      ${m.topicEvidence?.length ? `<details><summary>Evidence for the inferred topic</summary>${Lost.sources(m.topicEvidence, "Transcript lines the AI used")}</details>` : ""}
      ${notes.length ? `<ul class="plain notes">${notes.map((n) => `<li><span class="badge">${n.kind === "revisit" ? "To revisit" : n.kind === "clarification" ? "Draft" : "Suggestion"}</span> ${esc(n.text)}</li>`).join("")}</ul>` : ""}
      <div class="row actions">
        <button data-act="material" data-m="${m.index}">View related material</button>
        <button data-act="revisit" data-m="${m.index}">Revisit this topic</button>
        <button data-act="clarification" data-m="${m.index}">Draft a clarification</button>
        <button data-act="suggestion" data-m="${m.index}">View suggested support</button>
      </div>
      <div id="act-${m.index}" aria-live="polite"></div>
    </article>`;
  }
  function sharedSummary(s) {
    if (!s) return "";
    if (s.v === 2) return Lost.summaryV2(s);
    return `<div class="summary">
      ${s.main_topics.map((x) => `<article><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p>${Lost.sources(x.sources)}</article>`).join("")}
      ${Lost.steps(s.flow)}
      ${s.concepts.length ? `<h3>Concepts</h3><dl class="terms">${s.concepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.definition)}</dd>`).join("")}</dl>` : ""}
      ${s.examples.length ? `<h3>Examples</h3>${s.examples.map((x) => `<p><span class="origin">${x.origin === "ai" ? "Written by the AI" : x.origin === "materials" ? "From course materials" : "From the lecture"}</span> ${esc(x.text)}</p>`).join("")}` : ""}
      ${s.deadlines.length ? `<h3>Deadlines mentioned</h3><ul>${s.deadlines.map((x) => `<li>${esc(x.text)}${Lost.sources(x.sources, "Source")}</li>`).join("")}</ul>` : ""}
    </div>`;
  }
  Lost.sharedSummary = sharedSummary;

  Lost.boot("professor", [
    [/^\/$/, dashboard],
    [/^\/onboarding$/, onboarding],
    [/^\/canvas$/, canvasPage],
    [/^\/course\/([\w-]+)(?:\/(class|materials|history|settings))?$/, coursePage],
    [/^\/live\/([\w-]+)$/, liveScreen],
    [/^\/session\/([\w-]+)$/, reportPage],
  ]);
})();
