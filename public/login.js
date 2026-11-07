// Sign in / sign up. Demo accounts appear only when the server runs in demo mode, and are labelled.
(async function () {
  const { $, esc } = Lost;
  const next = new URLSearchParams(location.search).get("next") || "";
  const safeNext = /^\/(prof|student)(#.*)?$/.test(next) ? next : "";
  const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  $("#top").innerHTML = `<span class="brand">Lost</span>`;
  const post = async (path, body) => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Couldn't sign in.");
    return d;
  };
  const go = (d) => { location.href = safeNext && safeNext.startsWith(d.home) ? safeNext : d.home; };

  $("#app").innerHTML = `
    <div class="login-wrap">
      <section class="login-card">
        <h1>Sign in to Lost</h1>
        <p class="lede">Mark the moment you get lost in class, get it explained from the lecture and course materials, then rejoin.</p>
        <form id="signin" novalidate>
          <label for="email">Email</label><input id="email" type="email" autocomplete="username" required>
          <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
          <p id="err" class="form-error" role="alert"></p>
          <button class="primary big">Sign in</button>
        </form>
        <details class="signup"><summary>New here? Create an account</summary>
          <form id="signup" novalidate>
            <label for="sname">Your name</label><input id="sname" autocomplete="name" required>
            <label for="semail">Email</label><input id="semail" type="email" autocomplete="email" required>
            <label for="spw">Password (10 or more characters)</label><input id="spw" type="password" autocomplete="new-password" minlength="10" required>
            <fieldset><legend>I am a</legend>
              <label class="inline"><input type="radio" name="role" value="student" checked> Student</label>
              <label class="inline"><input type="radio" name="role" value="professor"> Professor</label>
            </fieldset>
            <div id="profCodeRow" hidden><label for="pcode">Professor invite code</label><input id="pcode" autocomplete="off">
              <p class="note">Choosing "Professor" alone gives no access to anyone's courses. Professor accounts need an invite code from whoever runs this server, and each professor only sees courses they import or create.</p></div>
            <p id="serr" class="form-error" role="alert"></p>
            <button class="primary">Create account</button>
          </form>
        </details>
        <p class="note">Lost never asks for your Canvas password. Canvas is connected separately, after you sign in.</p>
      </section>
      ${me.demo ? `<section class="demo-card" aria-labelledby="demoH">
        <h2 id="demoH">Demo accounts <span class="badge warn">Development only</span></h2>
        <p class="note">Seeded test users with sample data. They are not real people or real Canvas accounts. Password for all: <code>${esc(me.demoPassword)}</code></p>
        <ul class="demo-list">${me.demoUsers.map((u) => `<li><button data-who="${esc(u.key)}"><b>${esc(u.name)}</b><span>${u.role === "professor" ? "Professor" : "Student"}: ${esc(u.note)}</span></button></li>`).join("")}</ul>
      </section>` : ""}
    </div>`;

  $("#signin").onsubmit = async (e) => {
    e.preventDefault(); $("#err").textContent = "";
    try { go(await post("/api/auth/login", { email: $("#email").value, password: $("#pw").value })); }
    catch (x) { $("#err").textContent = x.message; }
  };
  $("#signup").onsubmit = async (e) => {
    e.preventDefault(); $("#serr").textContent = "";
    const role = document.querySelector("input[name=role]:checked").value;
    try { go(await post("/api/auth/signup", { name: $("#sname").value, email: $("#semail").value, password: $("#spw").value, role, profCode: $("#pcode").value })); }
    catch (x) { $("#serr").textContent = x.message; }
  };
  document.querySelectorAll("input[name=role]").forEach((r) => r.addEventListener("change", () => ($("#profCodeRow").hidden = document.querySelector("input[name=role]:checked").value !== "professor")));
  document.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", async () => {
    try { go(await post("/api/auth/demo", { who: b.dataset.who })); } catch (x) { $("#err").textContent = x.message; }
  }));
  $("h1").focus?.();
})();
