// Lost: speech-to-text engines. Each one takes the professor's shared mic (WebM/Opus pieces from
// the browser) and reports finished lines and in-progress words.
//
//   deepgram   Deepgram Nova-3 over a live WebSocket. Needs DEEPGRAM_API_KEY and internet; the audio
//              goes to Deepgram. Best accuracy of the three, gives per-word confidence.
//   moonshine  Moonshine v2 on this computer (default when there is no Deepgram key).
//   whisper    faster-whisper on this computer. Waits for a pause before each line.
//   off        none; the professor's Chrome does the recognition.
//
// Pick with TRANSCRIBER=deepgram|moonshine|whisper|off. Course terms (from the professor's vocabulary)
// are passed as recognition hints: Deepgram "keyterm", Moonshine set_keyterms, Whisper hotwords/prompt.
// They are hints only: the engines still transcribe what was said.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const engine = {
  name: "off",          // which engine is in use
  label: "Chrome speech recognition",
  ready: false,         // can take audio now
  status: "",           // short text for the professor screen, e.g. "Connected to Deepgram"
  problem: "",          // set when something is wrong, shown as a warning
  why: "",              // why we fell back to Chrome, printed at startup
};

let here, onLine, onPartial, termsFile;
let terms = [];

export function startEngine(opts) {
  ({ here, onLine, onPartial, termsFile } = opts);
  const wanted = (process.env.TRANSCRIBER || (process.env.WHISPER === "off" ? "off" : process.env.DEEPGRAM_API_KEY ? "deepgram" : "moonshine")).toLowerCase();
  if (wanted === "off") { engine.why = "turned off with TRANSCRIBER=off"; return; }
  if (wanted === "deepgram") {
    if (!process.env.DEEPGRAM_API_KEY) { engine.why = "TRANSCRIBER=deepgram but DEEPGRAM_API_KEY isn't set"; return; }
    engine.name = "deepgram"; engine.label = "Deepgram Nova-3"; engine.ready = true; engine.status = "Ready (connects when you share your mic)";
    return;
  }
  startLocal(wanted === "whisper" ? "whisper" : "moonshine");
}

// The professor's vocabulary changed. Local engines read the terms file; Deepgram gets them on the next connection.
export function setTerms(list) {
  terms = list.slice(0, 100);
  try { fs.writeFileSync(termsFile, terms.join("\n")); } catch {}
}

// ---------- local engines (Python child process) ----------
const local = { proc: null, ffmpeg: null };

function startLocal(kind) {
  const py = [path.join(here, ".venv", "bin", "python"), path.join(here, ".venv", "Scripts", "python.exe")].find((f) => fs.existsSync(f));
  if (!py) { engine.why = "no .venv folder found. Run the setup in the README"; return; }
  engine.name = kind;
  const ffCheck = spawn("ffmpeg", ["-version"]);
  ffCheck.on("error", () => {
    engine.why = "ffmpeg is not installed (Mac: brew install ffmpeg, Windows: winget install ffmpeg), then restart";
    engine.name = "off"; engine.ready = false;
    console.error(`  Transcript: Chrome speech recognition, because ${engine.why}`);
    local.proc?.kill(); local.proc = null;
  });
  const script = kind === "whisper" ? "transcribe.py" : "transcribe_moonshine.py";
  const proc = spawn(py, [path.join(here, script)], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, LOST_TERMS_FILE: termsFile } });
  local.proc = proc;
  engine.status = "Loading the model…";
  let out = "";
  proc.stdout.on("data", (d) => {
    out += d; let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl); out = out.slice(nl + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { engine.ready = true; engine.label = msg.model; engine.status = "Ready, running on this laptop"; console.log(`  Transcript: ${msg.model} is ready`); }
      else if (msg.partial !== undefined) onPartial(String(msg.partial));
      // the audio reaches the server about a second after it was spoken
      else if (msg.text) onLine({ text: String(msg.text), wallStart: msg.start * 1000 - 1000 });
    }
  });
  proc.stderr.on("data", (d) => { if (!/HF_TOKEN|unauthenticated|%\||it\/s|B\/s/.test(d)) console.error("[transcriber]", String(d).trim()); });
  proc.stdin.on("error", () => {});
  proc.on("error", (e) => console.error("[transcriber] could not start Python:", e.message));
  proc.on("exit", (code) => {
    if (engine.name === "off") return; // already explained (ffmpeg missing)
    console.error(`[transcriber] stopped (code ${code}). Using Chrome speech recognition. If it says "No module named ...", run the pip install step in the README.`);
    local.proc = null; engine.ready = false; engine.name = "off"; engine.label = "Chrome speech recognition"; engine.why = "the local model stopped";
  });
}

// ---------- Deepgram (live WebSocket) ----------
const dg = { ws: null, queue: [], keepAlive: null, streamStart: 0, pending: [], closing: false, finalizedAt: 0 };
// A transcript line never holds more than about this many seconds of speech, even if the professor doesn't pause.
const LINE_MAX_S = Number(process.env.LOST_LINE_MAX_S) || 5;

function dgConnect() {
  const params = new URLSearchParams({
    model: "nova-3", language: "en",
    punctuate: "true", smart_format: "true",   // punctuation and numbers as digits; the words stay as spoken
    interim_results: "true",                   // in-progress words while the professor talks
    endpointing: "300", utterance_end_ms: "1000", vad_events: "true", // end a line after a short pause
  });
  for (const t of terms) params.append("keyterm", t);
  // Deepgram accepts the key as a WebSocket subprotocol, so it never appears in a URL.
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", process.env.DEEPGRAM_API_KEY]);
  ws.binaryType = "arraybuffer";
  dg.ws = ws; dg.closing = false; dg.pending = [];
  engine.status = "Connecting to Deepgram…"; engine.problem = "";
  ws.onopen = () => {
    engine.status = `Connected to Deepgram${terms.length ? `, using ${terms.length} course terms` : ""}`;
    for (const b of dg.queue.splice(0)) ws.send(b);
    clearInterval(dg.keepAlive);
    dg.keepAlive = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "KeepAlive" })), 5000);
  };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "Results") {
      const alt = msg.channel?.alternatives?.[0]; if (!alt) return;
      const lineStart = dg.pending[0]?.start ?? msg.start;
      const spoken = msg.start + (msg.duration || 0) - lineStart; // seconds of speech in the line so far
      if (!msg.is_final) {
        onPartial([...dg.pending.map((p) => p.text), alt.transcript].join(" ").trim());
        // Don't wait for the professor to pause: after about 5 seconds of talking, ask Deepgram to
        // finalize what it has so the line appears now instead of at the end of a long sentence.
        if (alt.transcript && spoken >= LINE_MAX_S && Date.now() - dg.finalizedAt > 1500 && e.target.readyState === 1) {
          dg.finalizedAt = Date.now(); e.target.send(JSON.stringify({ type: "Finalize" }));
        }
        return;
      }
      if (alt.transcript) dg.pending.push({ text: alt.transcript, start: msg.start, words: alt.words || [] });
      if (msg.speech_final || msg.from_finalize || spoken >= LINE_MAX_S) dgFlush();
      else onPartial(dg.pending.map((p) => p.text).join(" "));
    } else if (msg.type === "UtteranceEnd") dgFlush();
  };
  ws.onerror = () => {};
  ws.onclose = (e) => {
    clearInterval(dg.keepAlive); dgFlush();
    if (dg.ws === ws) dg.ws = null;
    if (dg.closing) { engine.status = "Ready (connects when you share your mic)"; return; }
    // 1008 / 4xx-ish closes mean the key or request was rejected
    const reason = e.reason || `code ${e.code}`;
    engine.problem = /auth|401|403|credential|token/i.test(reason) || e.code === 1008 ? "Deepgram rejected the API key. Check DEEPGRAM_API_KEY and restart." : `Lost connection to Deepgram (${reason}). Reconnects when you share your mic again.`;
    engine.status = "Disconnected";
    console.error("[deepgram] closed:", reason);
  };
}

function dgFlush() {
  if (!dg.pending.length) return;
  const parts = dg.pending.splice(0);
  const words = parts.flatMap((p) => p.words);
  // Only Deepgram gives per-word confidence. Words under 0.6 are shown as "not sure".
  const unsure = words.filter((w) => typeof w.confidence === "number" && w.confidence < 0.6).map((w) => w.punctuated_word || w.word);
  onLine({ text: parts.map((p) => p.text).join(" "), wallStart: dg.streamStart + parts[0].start * 1000, unsure });
  onPartial("");
}

// ---------- shared entry points used by server.js ----------
export function newStream(header) {
  endStream();
  if (!engine.ready) return;
  if (engine.name === "deepgram") {
    dg.streamStart = Date.now() - 1000; // the first piece covers the second before it arrived
    dg.queue = [header];
    dgConnect();
    return;
  }
  const ff = spawn("ffmpeg", ["-loglevel", "error", "-fflags", "nobuffer", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"]);
  ff.on("error", (e) => { console.error("[transcriber] ffmpeg failed:", e.message); local.ffmpeg = null; });
  ff.stdin.on("error", () => {});
  ff.stdout.on("data", (d) => local.proc?.stdin.write(d));
  ff.stdin.write(header);
  local.ffmpeg = ff;
}

export function feed(piece) {
  if (engine.name === "deepgram") {
    if (dg.ws?.readyState === 1) dg.ws.send(piece);
    else if (dg.ws) dg.queue.push(piece);
    return;
  }
  local.ffmpeg?.stdin.write(piece);
}

export function endStream() {
  if (engine.name === "deepgram") {
    if (dg.ws) { dg.closing = true; try { dg.ws.send(JSON.stringify({ type: "CloseStream" })); } catch {} }
    return;
  }
  if (!local.ffmpeg) return;
  local.ffmpeg.stdin.end(); local.ffmpeg = null;
  // 1.5 s of silence so the model finishes the last line instead of waiting for more audio
  setTimeout(() => local.proc?.stdin.write(Buffer.alloc(16000 * 2 * 1.5)), 500);
}
