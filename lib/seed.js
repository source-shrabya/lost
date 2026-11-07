// Development / demo data. Only runs when demo mode is on (LOST_DEMO=1, the default outside production).
// Every demo account is flagged demo=1 and the login page labels them as demo accounts.
import { one, run } from "./db.js";
import { createUser, hashPassword } from "./auth.js";
import { connectDemo, importCourses, syncCourse, adapterFor } from "./canvas.js";

export const DEMO_PASSWORD = "lost-demo-2026";
export const DEMO_USERS = [
  { key: "prof", email: "dr.rivera@demo.lost", name: "Dr. Maya Rivera", role: "professor", note: "3 courses already synced from demo Canvas" },
  { key: "prof2", email: "dr.okafor@demo.lost", name: "Dr. Daniel Okafor", role: "professor", note: "New professor: goes through onboarding" },
  { key: "jordan", email: "jordan@demo.lost", name: "Jordan Lee", role: "student", note: "Enrolled in CSC 311-001 and CSC 202 through demo Canvas" },
  { key: "sam", email: "sam@demo.lost", name: "Sam Patel", role: "student", note: "Not enrolled yet: joins with a code or QR" },
  { key: "riley", email: "riley@demo.lost", name: "Riley Chen", role: "student", note: "Enrolled in CSC 311-002 (the other section)" },
];

export async function seedDemo() {
  for (const u of DEMO_USERS) {
    const existing = one("SELECT id FROM users WHERE email = ?", u.email);
    if (!existing) createUser({ ...u, password: DEMO_PASSWORD, demo: 1 });
    else run("UPDATE users SET password_hash = ? WHERE id = ? AND demo = 1 AND password_hash IS NULL", hashPassword(DEMO_PASSWORD), existing.id);
  }
  // Students linked to demo Canvas before the professor imports, so roster sync enrolls them.
  for (const key of ["jordan", "riley"]) {
    const s = one("SELECT * FROM users WHERE email = ?", DEMO_USERS.find((u) => u.key === key).email);
    if (!one("SELECT 1 FROM canvas_connections WHERE user_id = ?", s.id)) connectDemo({ ...s, institution_id: "usm" });
  }
  const prof = one("SELECT * FROM users WHERE email = ?", "dr.rivera@demo.lost");
  if (!one("SELECT 1 FROM courses WHERE owner_id = ?", prof.id)) {
    run("UPDATE users SET institution_id = 'usm' WHERE id = ?", prof.id);
    const user = { ...prof, institution_id: "usm" };
    connectDemo(user);
    const ad = adapterFor(user);
    const courses = await ad.teacherCourses();
    const r = await importCourses(user, courses.map((c) => ({ canvasCourseId: c.id, sectionIds: c.sections.map((s) => s.id) })));
    for (const id of r.courseIds) await syncCourse(user, id);
  }
}
