// Lost: compare speech engines with and without course terms.
// Mac only (uses the `say` voices to make test audio). Run from the lost folder:
//   node eval/compare.mjs            (Moonshine, plus Deepgram if DEEPGRAM_API_KEY is in .env)
//
// What it measures, per engine, with and without course terms:
//   - word error rate (WER) against the script
//   - course-term errors: listed terms said in the script but missing from the transcript
//   - "inserted" terms: listed terms in the transcript that were never said (the terms must not
//     put words in the professor's mouth)
//   - meaning flips: the contradicting sentence must keep "divergent" and "not"
//   - words produced during a 4-second silence
//   - caption delay: seconds from the end of a spoken sentence to its finished line, fed in real time
//
// Limits: the voices are synthetic text-to-speech, which is far cleaner than a real lecture hall.
// Use the numbers to compare settings, not as a promise of real-classroom accuracy.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(root, ".env")); } catch {}
const work = fs.mkdtempSync(path.join(os.tmpdir(), "lost-eval-"));

const SCRIPT = [
  "Every convergent sequence is Cauchy.",
  "A divergent sequence is not Cauchy, even though the slide says otherwise.",
  "The eigenvalues of a Hermitian matrix are always real.",
  "Dijkstra's algorithm fails when an edge weight is negative.",
  "The derivative of x squared is two x.",
  "We use a hash map, so lookup takes constant time.",
];
const SILENCE_AFTER = 2; // a 4-second silence after this sentence index
// "divergent" is deliberately NOT in the list: the terms must not turn it into "convergent".
const TERMS = ["convergent", "Cauchy", "eigenvalues", "Hermitian", "Dijkstra", "hash map", "derivative", "sequence"];
const VOICES = { "US (Samantha)": "Samantha", "UK (Daniel)": "Daniel", "Indian (Rishi)": "Rishi", "Australian (Karen)": "Karen", "Irish (Moira)": "Moira" };

const ff = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a]);
const sec = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// ---------- make test audio ----------
function build(voice, noisy) {
  const tag = `${voice}${noisy ? "-noisy" : ""}`;
  const parts = [], ends = []; let t = 0;
  const gap = (s, name) => { const f = path.join(work, `${name}.wav`); ff("-f", "lavfi", "-i", `anullsrc=r=16000:cl=mono`, "-t", String(s), f); return f; };
  SCRIPT.forEach((line, i) => {
    const aiff = path.join(work, `${voice}-${i}.aiff`), wav = path.join(work, `${voice}-${i}.wav`);
    execFileSync("say", ["-v", voice, "-o", aiff, line]);
    ff("-i", aiff, "-ar", "16000", "-ac", "1", wav);
    parts.push(wav); t += sec(wav); ends.push(t);
    const g = gap(i === SILENCE_AFTER ? 4 : 1.2, `gap-${voice}-${i}`); parts.push(g); t += sec(g);
  });
  const list = path.join(work, `${tag}.txt`);
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const clean = path.join(work, `${voice}.wav`);
  ff("-f", "concat", "-safe", "0", "-i", list, "-ar", "16000", "-ac", "1", clean);
  if (!noisy) return { file: clean, ends, total: t };
  // background conversation (another voice, quieter) plus room noise
  const babbleAiff = path.join(work, "babble.aiff"), out = path.join(work, `${tag}.wav`);
  if (!fs.existsSync(babbleAiff)) execFileSync("say", ["-v", "Fred", "-o", babbleAiff, "So did you finish the homework for tomorrow? I think the lab is due Friday, and the quiz moved to next week. Anyway, want to get lunch after this? The line at the cafeteria was crazy yesterday."]);
  ff("-i", clean, "-stream_loop", "-1", "-i", babbleAiff, "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.02:r=16000",
    "-filter_complex", "[1:a]aresample=16000,volume=0.25[b];[0:a][b][2:a]amix=inputs=3:duration=first:normalize=0", "-ar", "16000", "-ac", "1", out);
  return { file: out, ends, total: t };
}

// ---------- scoring ----------
const norm = (s) => s.toLowerCase().replace(/'s\b/g, "s").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp), d = Array.from({ length: r.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}
const has = (text, term) => ` ${norm(text).join(" ")} `.includes(` ${norm(term).join(" ")} `);
function score(hyp) {
  const ref = SCRIPT.join(" ");
  const said = TERMS.filter((t) => has(ref, t));
  const contra = SCRIPT[1];
  return {
    wer: wer(ref, hyp),
    termErrors: said.filter((t) => !has(hyp, t)).length, termsSaid: said.length,
    inserted: TERMS.filter((t) => !has(ref, t) && has(hyp, t)).length,
    meaningKept: has(hyp, "divergent sequence is not") ? "yes" : "NO",
  };
}

// ---------- engines ----------
async function deepgram(file, useTerms, realtime) {
  const key = process.env.DEEPGRAM_API_KEY;
  const params = new URLSearchParams({ model: "nova-3", language: "en", punctuate: "true", smart_format: "true", interim_results: "true", endpointing: "300", utterance_end_ms: "1000", encoding: "linear16", sample_rate: "16000" });
  if (useTerms) TERMS.forEach((t) => params.append("keyterm", t));
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], { maxBuffer: 1 << 28 });
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", key]);
    const finals = []; let t0 = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "Results" && m.is_final && m.channel.alternatives[0].transcript)
        finals.push({ text: m.channel.alternatives[0].transcript, at: (Date.now() - t0) / 1000, start: m.start, end: m.start + m.duration });
    };
    ws.onclose = () => ok(finals);
    ws.onerror = () => fail(new Error("Deepgram connection failed"));
    ws.onopen = async () => {
      t0 = Date.now();
      const step = 3200; // 0.1 s
      for (let i = 0; i < pcm.length; i += step) {
        ws.send(pcm.subarray(i, i + step));
        if (realtime) await new Promise((r) => setTimeout(r, 100));
      }
      ws.send(JSON.stringify({ type: "CloseStream" }));
    };
  });
}

function moonshine(file, useTerms, realtime) {
  const py = path.join(root, ".venv", "bin", "python");
  return new Promise((ok) => {
    const env = { ...process.env, LOST_TERMS: useTerms ? TERMS.join(",") : "", LOST_TERMS_FILE: "" };
    const p = spawn(py, [path.join(root, "transcribe_moonshine.py")], { env });
    const finals = []; let buf = "", t0 = 0;
    p.stderr.on("data", () => {});
    p.stdout.on("data", async (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const m = JSON.parse(line);
        if (m.ready) {
          t0 = Date.now();
          const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], { maxBuffer: 1 << 28 });
          (async () => {
            for (let i = 0; i < pcm.length; i += 3200) { p.stdin.write(pcm.subarray(i, i + 3200)); if (realtime) await new Promise((r) => setTimeout(r, 100)); }
            p.stdin.write(Buffer.alloc(16000 * 2 * 2)); p.stdin.end();
          })();
        } else if (m.text) finals.push({ text: m.text, at: (Date.now() - t0) / 1000 });
      }
    });
    p.on("close", () => ok(finals));
  });
}

const ENGINES = { "Moonshine medium": moonshine };
if (process.env.DEEPGRAM_API_KEY) ENGINES["Deepgram Nova-3"] = deepgram;

// silence check: words whose timing falls inside the 4 s gap (Deepgram gives times; Moonshine
// output is checked by text: nothing between sentence 3 and 4 that isn't in the script)
function silenceWords(finals, audio) {
  if (finals[0]?.start === undefined) return "n/a";
  const from = audio.ends[SILENCE_AFTER] + 0.3, to = from + 3.4;
  return finals.filter((f) => f.start >= from && f.end <= to).map((f) => f.text).join(" ").split(" ").filter(Boolean).length;
}

// ---------- run ----------
const rows = [];
for (const [label, voice] of Object.entries(VOICES)) {
  for (const noisy of [false, true]) {
    const audio = build(voice, noisy);
    for (const [ename, run] of Object.entries(ENGINES)) {
      for (const useTerms of [false, true]) {
        const finals = await run(audio.file, useTerms, false);
        const hyp = finals.map((f) => f.text).join(" ");
        rows.push({ engine: ename, voice: label, audio: noisy ? "noisy" : "clean", terms: useTerms ? "on" : "off", ...score(hyp), silence: silenceWords(finals, audio), hyp });
        process.stderr.write(".");
      }
    }
  }
}

// caption delay: one clean US run per engine, fed in real time
const delays = {};
const us = build("Samantha", false);
for (const [ename, run] of Object.entries(ENGINES)) {
  const finals = await run(us.file, true, true);
  // match each finished line to the sentence whose end it covers, in order
  const lags = []; let k = 0;
  for (const f of finals) {
    while (k < SCRIPT.length - 1 && has(f.text, norm(SCRIPT[k + 1]).slice(-2).join(" ")) && !has(f.text, norm(SCRIPT[k]).slice(-2).join(" "))) k++;
    if (has(f.text, norm(SCRIPT[k]).slice(-2).join(" "))) { lags.push(f.at - us.ends[k]); k++; }
  }
  delays[ename] = lags.length ? { median: lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)], max: Math.max(...lags), n: lags.length } : null;
}

// ---------- report ----------
const pct = (x) => `${(x * 100).toFixed(1)}%`;
let md = `# Lost speech engine comparison\n\nRun ${new Date().toISOString().slice(0, 16).replace("T", " ")} on ${os.cpus()[0].model}. Script: ${SCRIPT.length} sentences, ${norm(SCRIPT.join(" ")).length} words, a 4 s silence after sentence ${SILENCE_AFTER + 1}. Course terms: ${TERMS.join(", ")} ("divergent" left out on purpose).\n\n`;
md += `Voices are macOS text-to-speech, not real people. Noisy = a second voice talking in the background plus pink noise.\n\n`;
md += `## Summary (average over ${Object.keys(VOICES).length} voices)\n\n| Engine | Audio | Course terms | WER | Term errors | Inserted terms | "divergent ... not" kept | Words in silence |\n|---|---|---|---|---|---|---|---|\n`;
for (const e of Object.keys(ENGINES)) for (const a of ["clean", "noisy"]) for (const t of ["off", "on"]) {
  const g = rows.filter((r) => r.engine === e && r.audio === a && r.terms === t);
  const avg = (k) => g.reduce((s, r) => s + r[k], 0) / g.length;
  const sil = g.map((r) => r.silence).filter((x) => x !== "n/a");
  md += `| ${e} | ${a} | ${t} | ${pct(avg("wer"))} | ${g.reduce((s, r) => s + r.termErrors, 0)} of ${g.reduce((s, r) => s + r.termsSaid, 0)} | ${g.reduce((s, r) => s + r.inserted, 0)} | ${g.filter((r) => r.meaningKept === "yes").length} of ${g.length} | ${sil.length ? sil.reduce((s, x) => s + x, 0) : "not measured"} |\n`;
}
md += `\n## Caption delay (clean US voice, fed in real time)\n\nSeconds from the end of a spoken sentence to its finished line. In-progress words appear earlier than this.\n\n| Engine | Median | Worst | Sentences matched |\n|---|---|---|---|\n`;
for (const [e, d] of Object.entries(delays)) md += d ? `| ${e} | ${d.median.toFixed(1)} s | ${d.max.toFixed(1)} s | ${d.n} of ${SCRIPT.length} |\n` : `| ${e} | not measured | | |\n`;
md += `\n## Every run\n\n| Engine | Voice | Audio | Terms | WER | Transcript |\n|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.engine} | ${r.voice} | ${r.audio} | ${r.terms} | ${pct(r.wer)} | ${r.hyp.replace(/\|/g, "/")} |\n`;
const outFile = path.join(root, "eval", "results.md");
fs.writeFileSync(outFile, md);
console.log(md.split("## Every run")[0]);
console.log(`Full results: ${outFile}`);
fs.rmSync(work, { recursive: true, force: true });
