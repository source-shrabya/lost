// Onboarding walkthrough for the new demo professor (Dr. Okafor). Same setup as ui-walkthrough.cjs.
const { chromium } = require("playwright");
const SP = process.argv[2];
(async () => { const br = await chromium.launch(); const p = await (await br.newContext({ viewport: { width: 1200, height: 900 } })).newPage(); const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:3300/login"); await p.click("button[data-who=prof2]"); await p.waitForSelector("#instNext");
await p.click("#instNext"); await p.waitForSelector(".connect-options"); await p.screenshot({ path: `${SP}/shots/20-onb-connect.png`, fullPage: true });
await p.click("#demo"); await p.waitForSelector("#pick"); await p.check("input[name=sec]"); await p.click("#importBtn"); await p.waitForSelector("#importResult a.button");
await p.screenshot({ path: `${SP}/shots/21-onb-done.png`, fullPage: true });
console.log("errors:", errs.join("|") || "none"); await br.close(); })().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
