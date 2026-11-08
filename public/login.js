// Sign in: school email, then the university. Students go straight in; professors add their password.
// Classes come from the university's side (Canvas), so there are no join codes to type.
(async function () {
  const { $, esc } = Lost;
  const next = new URLSearchParams(location.search).get("next") || "";
  const safeNext = /^\/(prof|student)(#.*)?$/.test(next) ? next : "";
  const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  const { institutions = [] } = await fetch("/api/auth/institutions").then((r) => r.json()).catch(() => ({}));
  $("#top").innerHTML = `<span class="brand">Lost</span>`;
  const post = async (path, body) => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Couldn't sign in.");
    return d;
  };
  const go = (d) => { location.href = safeNext && safeNext.startsWith(d.home) ? safeNext : d.home; };
  const st = { email: "", institution: "" };

  const shell = (inner) => {
    $("#app").innerHTML = `<div class="login-wrap"><section class="login-card">${inner}</section>
      ${me.demo ? `<section class="demo-card" aria-labelledby="demoH">
        <h2 id="demoH">Demo accounts <span class="badge warn">Development only</span></h2>
        <ul class="demo-list">${me.demoUsers.map((u) => `<li><button data-who="${esc(u.key)}"><b>${esc(u.name)}</b><span>${u.role === "professor" ? "Professor" : "Student"}: ${esc(u.note)}</span></button></li>`).join("")}</ul>
      </section>` : ""}</div>`;
    document.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", async () => {
      try { go(await post("/api/auth/demo", { who: b.dataset.who })); } catch (x) { toastErr(x); }
    }));
    $("h1")?.focus?.();
  };
  const toastErr = (x) => { const e = $("#err"); if (e) e.textContent = x.message; };

  function emailStep() {
    shell(`<h1 tabindex="-1">Sign in to Lost</h1>
      <p class="lede">Use your school email.</p>
      <form id="f" novalidate>
        <label for="email">School email</label><input id="email" type="email" autocomplete="username" inputmode="email" placeholder="you@usm.edu" value="${esc(st.email)}" required>
        <p id="err" class="form-error" role="alert"></p>
        <button class="primary big">Continue</button>
      </form>`);
    $("#email").focus();
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const v = $("#email").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { $("#err").textContent = "Enter your school email."; return; }
      st.email = v; schoolStep();
    };
  }

  function schoolStep() {
    shell(`<p class="crumb"><button class="linkish" id="back">← ${esc(st.email)}</button></p>
      <h1 tabindex="-1">Pick your university</h1>
      <div class="school-list">${institutions.map((i) => `<button class="school" data-inst="${esc(i.id)}"><span class="school-mark" aria-hidden="true">${esc(i.name.replace(/^The /, "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").slice(0, 3))}</span><span>${esc(i.name)}</span></button>`).join("")}</div>
      <p id="err" class="form-error" role="alert"></p>
      <p class="note">Your university connects Lost to Canvas, so your classes show up on their own.</p>`);
    $("#back").onclick = emailStep;
    document.querySelectorAll("[data-inst]").forEach((b) => b.addEventListener("click", async () => {
      st.institution = b.dataset.inst; b.disabled = true;
      try {
        const d = await post("/api/auth/start", { email: st.email, institution: st.institution });
        if (d.needPassword) passwordStep(); else go(d);
      } catch (x) { toastErr(x); b.disabled = false; }
    }));
  }

  function passwordStep() {
    shell(`<p class="crumb"><button class="linkish" id="back">← ${esc(st.email)}</button></p>
      <h1 tabindex="-1">Welcome back, professor</h1>
      <form id="f" novalidate>
        <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
        <p id="err" class="form-error" role="alert"></p>
        <button class="primary big">Sign in</button>
      </form>`);
    $("#back").onclick = emailStep;
    $("#pw").focus();
    $("#f").onsubmit = async (e) => {
      e.preventDefault(); $("#err").textContent = "";
      try { go(await post("/api/auth/start", { email: st.email, institution: st.institution, password: $("#pw").value })); }
      catch (x) { $("#err").textContent = x.message; }
    };
  }

  emailStep();
})();
