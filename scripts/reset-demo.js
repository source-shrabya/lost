// Deletes the SQLite database so the next start re-seeds the demo accounts and demo Canvas courses.
// Stop the server first. Real accounts in the same database are deleted too, so this asks for --yes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.env.LOST_DB || path.join(process.env.LOST_DATA || path.join(here, "data"), "lost.db");
if (!process.argv.includes("--yes")) { console.log(`This deletes ${file} (every account, course and class in it). Run again with: npm run reset-demo -- --yes`); process.exit(1); }
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
console.log(`Deleted ${file}. Start Lost again to re-seed the demo data.`);
