// Browser walkthrough (professor laptop + student iPhone 13 + 320 px). Needs a Lost server on :3300 and
// Playwright 1.48.2 installed where you run it (npm i playwright@1.48.2 in a scratch folder).
// Usage: node scripts/ui-walkthrough.cjs <folder for screenshots>  (writes <folder>/shots/*.png)
const { chromium, devices } = require("playwright");
const SP = process.argv[2], B = "http://localhost:3300";
const shot = (p, n) => p.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: true });
const errs = [];
(async () => {
  const br = await chromium.launch();
  const prof = await (await br.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  prof.on("pageerror", (e) => errs.push("prof: " + e.message)); prof.on("console", (m) => m.type() === "error" && errs.push("prof console: " + m.text()));
  await prof.goto(B + "/login"); await shot(prof, "01-login");
  await prof.click("button[data-who=prof]"); await prof.waitForSelector(".course-card"); await shot(prof, "02-prof-dashboard");
  await prof.click(".course-card:has-text('Computer Networks') a.button"); await prof.waitForSelector("#newSession"); await shot(prof, "03-course-class");
  await prof.click("text=Materials"); await prof.waitForSelector(".mat-list"); await shot(prof, "04-materials");
  await prof.click("text=Class"); await prof.waitForSelector("#newSession");
  await prof.fill("#ltitle", "Error detection"); await prof.click("#newSession button.primary"); await prof.waitForSelector("#joinPanel:not([hidden])"); await shot(prof, "05-ready-qr");
  const sid = prof.url().split("/live/")[1];
  await prof.click("#startBtn"); await prof.waitForTimeout(800);
  // sample lines through the demo tool
  await prof.click("details.diag summary"); await prof.click("#sample");
  // student on a phone
  const ctx = await br.newContext({ ...devices["iPhone 13"] });
  const st = await ctx.newPage(); st.on("pageerror", (e) => errs.push("student: " + e.message));
  await st.goto(B + "/login"); await st.click("button[data-who=jordan]"); await st.waitForSelector(".course-card"); await shot(st, "10-student-home");
  await st.click(".live-banner"); await st.waitForSelector("#lost:not([disabled])"); await prof.waitForTimeout(9000);
  await shot(st, "11-student-live");
  // keyboard: reach the button with Tab and press Enter
  await st.focus("#roomTitle"); let found = false;
  for (let i = 0; i < 10; i++) { await st.keyboard.press("Tab"); if (await st.evaluate(() => document.activeElement?.id === "lost")) { found = true; break; } }
  console.log("keyboard reached I'm lost:", found);
  await st.keyboard.press("Enter"); await st.waitForSelector(".phrase-list"); await shot(st, "12-student-picker");
  await st.click(".phrase >> nth=-1"); await st.waitForSelector(".card-block", { timeout: 40000 }); await st.waitForTimeout(300); await shot(st, "13-student-card");
  await prof.waitForTimeout(1500); await shot(prof, "06-prof-live");
  await st.click("button[data-h=catchup]"); await st.waitForSelector(".catchup", { timeout: 40000 }); await shot(st, "14-student-catchup");
  const overflow = await st.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); console.log("student horizontal overflow px:", overflow);
  // professor ends class
  await prof.click("#endBtn"); await prof.click("#endBtn"); await prof.waitForURL(/#\/session\//, { timeout: 20000 });
  await prof.waitForSelector("text=Published to students", { timeout: 90000 }); await shot(prof, "07-prof-report");
  await st.goto(`${B}/student#/session/${sid}`); await st.waitForSelector("#review"); await st.waitForTimeout(500); await shot(st, "15-student-summary");
  const o2 = await st.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); console.log("summary overflow px:", o2);
  const sm = await (await br.newContext({ viewport: { width: 320, height: 640 }, isMobile: true })).newPage();
  await sm.goto(B + "/login"); await sm.click("button[data-who=sam]"); await sm.waitForSelector(".join-box"); await shot(sm, "16-sam-320");
  console.log("320 overflow px:", await sm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  console.log("errors:", errs.length ? errs.join("\n") : "none");
  await br.close();
})().catch(async (e) => { console.error("FAILED", e.message); console.log("errors:", errs.join("\n")); process.exit(1); });
