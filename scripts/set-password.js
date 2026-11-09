// Sets a new password for one account, because Lost has no "forgot password" page yet.
//   node scripts/set-password.js professor@usm.edu
// It makes a random password, saves the hash in the database, and writes the password to
// data/passwords/<email>.txt (data/ is gitignored), so it is never printed or committed.
// Sign-ins already open on other devices stay signed in.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "../lib/auth.js";

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.LOST_DATA || path.join(here, "data");
const file = process.env.LOST_DB || path.join(dataDir, "lost.db");
const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) { console.log("Usage: node scripts/set-password.js <email>"); process.exit(1); }

const db = new Database(file);
db.pragma("busy_timeout = 5000");
const user = db.prepare("SELECT id, name, role FROM users WHERE email = ?").get(email);
if (!user) { console.log(`No account with the email ${email}.`); process.exit(1); }

// Three short random groups: easy to type on a phone, about 60 bits.
const abc = "abcdefghjkmnpqrstuvwxyz23456789";
const group = () => Array.from(crypto.randomBytes(5), (b) => abc[b % abc.length]).join("");
const pw = `${group()}-${group()}-${group()}`;

db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(pw), user.id);
const out = path.join(dataDir, "passwords", `${email}.txt`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${email}\n${pw}\n`, { mode: 0o600 });
console.log(`New password set for ${user.name} (${user.role}). It is in ${out}`);
