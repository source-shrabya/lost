// Accounts, sign-in sessions and secrets.
//  - Passwords: scrypt with a per-user salt.
//  - Sign-in: a random token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored.
//  - CSRF: every request that changes something must carry the session's csrf token in the
//    x-lost-csrf header. Other sites can't read it or set custom headers on a cross-site form post.
//  - Canvas tokens are encrypted at rest with AES-256-GCM using LOST_SECRET (or data/secret.key).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { one, run, now, newId } from "./db.js";

const SESSION_DAYS = 7;
export const COOKIE = "lost_sid";

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) {
    crypto.scryptSync("x", "timing-equaliser", 32); // same work either way, so a missing user isn't faster
    return false;
  }
  const [, salt, key] = stored.split("$");
  const want = Buffer.from(key, "base64");
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, "base64"), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(18).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  run("INSERT INTO auth_sessions (token_hash, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", sha(token), userId, csrf, expires, now());
  return { token, csrf, expires };
}

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Returns { user, csrf, tokenHash } or null.
export function sessionFrom(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = one("SELECT * FROM auth_sessions WHERE token_hash = ?", sha(token));
  if (!s) return null;
  if (s.expires_at < now()) { run("DELETE FROM auth_sessions WHERE token_hash = ?", s.token_hash); return null; }
  const user = one("SELECT id, email, name, role, demo, onboarded, institution_id FROM users WHERE id = ?", s.user_id);
  return user ? { user, csrf: s.csrf, tokenHash: s.token_hash } : null;
}
export const endSession = (tokenHash) => run("DELETE FROM auth_sessions WHERE token_hash = ?", tokenHash);

export function cookieHeader(token, expires, secure) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
export const clearCookie = (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export function csrfOk(req, session) {
  const given = String(req.headers["x-lost-csrf"] || "");
  return given.length === session.csrf.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(session.csrf));
}

export function createUser({ email, name, role, password, demo = 0 }) {
  const id = newId(9);
  run("INSERT INTO users (id, email, name, role, password_hash, demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, String(email).trim().toLowerCase(), String(name).trim(), role, password ? hashPassword(password) : null, demo ? 1 : 0, now());
  return id;
}

// ---------- encryption for stored Canvas tokens ----------
let KEY = null;
export function loadSecret(dataDir) {
  let hex = process.env.LOST_SECRET || "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    const f = path.join(dataDir, "secret.key");
    try { hex = fs.readFileSync(f, "utf8").trim(); } catch {}
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      hex = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(f, hex, { mode: 0o600 });
    }
  }
  KEY = Buffer.from(hex, "hex");
}
export function encrypt(text) {
  if (text == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const body = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
export function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, body] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}
export { sha };
