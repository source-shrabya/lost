// AI illustrations for help cards, drawn by Cloudflare Workers AI (FLUX.1 schnell).
// Only on request: the card shows first, the student taps "Show illustration", the server draws once
// and caches the file (IMAGE_PREDRAW=1 draws ahead instead). Credentials never leave the server. Precise diagrams stay in visuals.js (SVG);
// FLUX only draws simple scenes without text.
import fs from "node:fs";
import path from "node:path";
import { one, run, now } from "./db.js";

export const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const STEPS = 4; // the model's default; the schema allows at most 8
const PROMPT_MAX = 400; // our own limit for Claude's scene text (the API allows 2048)
const MAX_BYTES = 4 * 1024 * 1024;
// Images come back 1024x1024 (4 tiles): about 58 neurons each at 4 steps, so 120 a day is about 6,900 of the 10,000 free neurons.
const dailyMax = () => Number(process.env.IMAGE_DAILY_MAX) || 120;
const timeoutMs = () => Number(process.env.IMAGE_TIMEOUT_MS) || 25000;

let dir = null;
let fetchImpl = (...a) => fetch(...a);
const inflight = new Map(); // help_id -> promise, so double taps share one Cloudflare call
const failures = new Map(); // help_id -> failed attempts since start; bounded so one card can't burn the budget
const MAX_TRIES = 3;

export class ImageError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export function initIllustrations(dataDir) {
  dir = path.join(dataDir, "illustrations");
  fs.mkdirSync(dir, { recursive: true });
  // A restart drops in-flight calls; let those be asked again.
  run("UPDATE illustrations SET status = 'ready' WHERE status = 'pending'");
}
export const setFetchForTests = (f) => { fetchImpl = f || ((...a) => fetch(...a)); };

// Why illustrations can't be drawn right now, or null when they can.
export function unavailable() {
  if (String(process.env.IMAGE_GENERATION_ENABLED || "").toLowerCase() !== "true") return "off";
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) return "missing_credentials";
  return null;
}
export const status = () => unavailable() || "on";

const MESSAGES = {
  off: "Illustrations are turned off on this server.",
  missing_credentials: "Illustrations aren't set up on this server yet.",
  auth: "The illustration service didn't accept this server's credentials.",
  // Cloudflare said the account's daily free neurons are gone (resets at 00:00 UTC).
  quota: "The picture service's free daily allowance for this server is used up. It resets at midnight UTC.",
  // Cloudflare said "too many requests right now": temporary, nothing is used up.
  rate_limited: "The picture service is busy right now. Try again in a minute.",
  // Lost's own cap (IMAGE_DAILY_MAX), counted across every class on this server, reset at 00:00 UTC.
  daily_cap: "This server has drawn its daily limit of pictures (shared by every class). It resets at midnight UTC.",
  gave_up: "This picture failed a few times, so Lost stopped trying. The explanation and diagram still work.",
  timeout: "The illustration took too long. Try again.",
  bad_response: "The illustration service sent back something that isn't an image.",
  unavailable: "The illustration service isn't reachable right now.",
};
export const message = (code) => MESSAGES[code] || MESSAGES.unavailable;

// Claude's scene text, checked before it's stored. Returns null when it isn't usable.
export function cleanSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const clip = (s, max) => String(s || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
  const prompt = clip(raw.prompt, PROMPT_MAX), caption = clip(raw.caption, 140), alt = clip(raw.alt, 240);
  if (prompt.length < 12 || !caption || !alt) return null;
  return { prompt, caption, alt };
}

// The scene wrapped in Lost's look: plain line art on a light neutral surface, so the same image sits
// well in light and dark mode (the page frames it in a fixed neutral panel) and never needs redrawing
// when the theme changes. Never any writing.
export const fullPrompt = (scene) =>
  `Minimal educational illustration: ${scene}. Clean simple line art, flat shapes, dark ink lines with muted gold (#e0a800) accents on a plain warm off-white background, plenty of empty space, friendly and calm. No text, no letters, no numbers, no labels, no captions, no logos, no watermark.`;

export const filePath = (helpId) => path.join(dir, `${helpId}.img`);

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

// One Cloudflare call. Never logs the token or account id.
export async function draw(scene) {
  const why = unavailable();
  if (why) throw new ImageError(why, message(why), 503);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/run/${MODEL}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs());
  let res, body;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: fullPrompt(scene), steps: STEPS }),
      signal: ctl.signal,
    });
    body = await res.text();
  } catch (e) {
    if (e?.name === "AbortError") throw new ImageError("timeout", message("timeout"), 504);
    throw new ImageError("unavailable", message("unavailable"));
  } finally { clearTimeout(timer); }
  let json = null;
  try { json = JSON.parse(body); } catch {}
  const errText = JSON.stringify(json?.errors || []).toLowerCase();
  if (res.status === 401 || res.status === 403 || /authenticat|unauthori[sz]ed|invalid.*token/.test(errText))
    throw new ImageError("auth", message("auth"));
  // Only an explicit "daily allocation / neurons" error means the free allowance is gone; any other 429
  // or capacity error is a temporary rate limit.
  if (/daily free allocation|neurons?|allocation exhausted|quota/.test(errText))
    throw new ImageError("quota", message("quota"), 429);
  if (res.status === 429 || /rate.?limit|too many requests|capacity/.test(errText))
    throw new ImageError("rate_limited", message("rate_limited"), 429);
  if (!res.ok || !json) throw new ImageError("unavailable", message("unavailable"));
  // REST wraps model output as { result: { image }, success }; accept a bare { image } too.
  const b64 = json.result?.image ?? json.image;
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length > MAX_BYTES * 1.4)
    throw new ImageError("bad_response", message("bad_response"));
  const buf = Buffer.from(b64, "base64");
  const mime = sniff(buf);
  if (!mime || buf.length > MAX_BYTES) throw new ImageError("bad_response", message("bad_response"));
  return { buf, mime };
}

const usedToday = () => one(
  "SELECT COUNT(*) n FROM illustrations WHERE status IN ('ok', 'pending') AND requested_at >= ?",
  new Date().toISOString().slice(0, 10)).n;

// Draw (or reuse) the illustration for one help card. Caller has already checked access.
// True when a new picture could be drawn right now (set up, and today's cap not reached).
export const canDraw = () => !unavailable() && usedToday() < dailyMax();
export const usage = () => ({ state: status(), usedToday: usedToday(), dailyMax: dailyMax(), resets: "00:00 UTC" });

export async function illustrate(helpId, userId) {
  const row = one("SELECT * FROM illustrations WHERE help_id = ?", helpId);
  if (!row) throw new ImageError("none", "This card has no illustration.", 404);
  if (row.status === "ok" && fs.existsSync(filePath(helpId))) return { helpId, caption: row.caption, alt: row.alt };
  if (inflight.has(helpId)) return inflight.get(helpId);
  const why = unavailable();
  if (why) throw new ImageError(why, message(why), 503);
  if (usedToday() >= dailyMax()) throw new ImageError("daily_cap", message("daily_cap"), 429);
  if ((failures.get(helpId) || 0) >= MAX_TRIES) throw new ImageError("gave_up", message("gave_up"), 429);
  run("UPDATE illustrations SET status = 'pending', error = NULL, requested_by = ?, requested_at = ? WHERE help_id = ?", userId, now(), helpId);
  const p = (async () => {
    try {
      const { buf, mime } = await draw(row.prompt);
      fs.writeFileSync(filePath(helpId), buf);
      run("UPDATE illustrations SET status = 'ok', mime = ? WHERE help_id = ?", mime, helpId);
      failures.delete(helpId);
      return { helpId, caption: row.caption, alt: row.alt };
    } catch (e) {
      run("UPDATE illustrations SET status = 'failed', error = ? WHERE help_id = ?", e.code || "unavailable", helpId);
      failures.set(helpId, (failures.get(helpId) || 0) + 1);
      throw e instanceof ImageError ? e : new ImageError("unavailable", message("unavailable"));
    } finally { inflight.delete(helpId); }
  })();
  inflight.set(helpId, p);
  return p;
}

export function readImage(helpId) {
  const row = one("SELECT status, mime FROM illustrations WHERE help_id = ?", helpId);
  if (row?.status !== "ok") return null;
  try { return { binary: fs.readFileSync(filePath(helpId)), type: row.mime || "image/jpeg" }; } catch { return null; }
}
