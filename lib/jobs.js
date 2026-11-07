// Durable background jobs in SQLite. A job is unique per (type, ref), so enqueueing twice is a
// no-op. A running job holds a lease; after a crash or restart the lease runs out and the job runs
// again. Handlers must be idempotent (the summary handler upserts and uses INSERT OR IGNORE).
import { one, all, run, now, newId } from "./db.js";

const handlers = {};
export const MAX_ATTEMPTS = 4;
const LEASE_MS = 5 * 60e3;

export function registerJob(type, fn) { handlers[type] = fn; }

export function enqueue(type, refId, { restart = false } = {}) {
  const r = run("INSERT OR IGNORE INTO jobs (id, type, ref_id, status, run_after, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
    newId(9), type, refId, now(), now(), now());
  if (!r.changes && restart) run("UPDATE jobs SET status = 'pending', attempts = 0, run_after = ?, last_error = NULL, updated_at = ? WHERE type = ? AND ref_id = ? AND status IN ('failed', 'done')", now(), now(), type, refId);
}
export const jobFor = (type, refId) => one("SELECT * FROM jobs WHERE type = ? AND ref_id = ?", type, refId);

let timer = null, busy = false;
// Jobs that were running when the server stopped: run them again.
export function recoverJobs() { return run("UPDATE jobs SET status = 'pending', lease_until = NULL, updated_at = ? WHERE status = 'running'", now()).changes; }
export function startJobs(intervalMs = 1500) {
  recoverJobs();
  timer = setInterval(() => tick().catch((e) => console.error("[jobs]", e)), intervalMs);
  timer.unref?.();
}
export function stopJobs() { clearInterval(timer); timer = null; }

export async function tick() {
  if (busy) return 0;
  busy = true;
  let ran = 0;
  try {
    const due = all("SELECT * FROM jobs WHERE (status = 'pending' AND run_after <= ?) OR (status = 'running' AND lease_until < ?) ORDER BY created_at LIMIT 3", now(), now());
    for (const job of due) {
      const claimed = run("UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE id = ? AND status = ?",
        new Date(Date.now() + LEASE_MS).toISOString(), now(), job.id, job.status).changes;
      if (!claimed) continue;
      ran++;
      const attempt = job.attempts + 1;
      try {
        await handlers[job.type](job.ref_id, { attempt, final: attempt >= MAX_ATTEMPTS });
        run("UPDATE jobs SET status = 'done', lease_until = NULL, last_error = NULL, updated_at = ? WHERE id = ?", now(), job.id);
      } catch (e) {
        const final = attempt >= MAX_ATTEMPTS || e.permanent;
        const backoff = Math.min(120e3, 5e3 * 2 ** (attempt - 1));
        run("UPDATE jobs SET status = ?, lease_until = NULL, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?",
          final ? "failed" : "pending", String(e.message || e).slice(0, 300), new Date(Date.now() + backoff).toISOString(), now(), job.id);
        console.error(`[jobs] ${job.type} ${job.ref_id} attempt ${attempt} failed: ${e.message}`);
      }
    }
  } finally { busy = false; }
  return ran;
}
