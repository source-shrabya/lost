// The lecture's backdrop: a few faint line drawings and words picked from what the class is about.
// Picked from the course's speech hints, its name and the last few minutes of transcript. No AI call,
// so it costs nothing and can't invent anything; the drawings themselves live in public/theme.js.
import { one, all } from "./db.js";

// icon id -> words that call for it
const ICONS = [
  ["cpu", /\b(cpu|processor|chip|hardware|transistor|computer)\b/],
  ["memory", /\b(ram|memory|storage|ssd|disk|hard drive|bytes?|kilobyte|megabyte|gigabyte)\b/],
  ["binary", /\b(binary|bits?|base 2|parity|ones and zeros|zeros and ones)\b/],
  ["code", /\b(code|program|programming|python|java|syntax|variable|function|algorithm|if statement|else)\b/],
  ["loop", /\b(loops?|repeat|iteration|recursion|cycle|while)\b/],
  ["search", /\b(search|find|lookup|sorted|query)\b/],
  ["tree", /\b(tree|nodes?|hierarchy|graph theory)\b/],
  ["bug", /\b(bugs?|debug|debugging|error)\b/],
  ["monitor", /\b(screen|pixels?|display|output|input|monitor|rgb|image)\b/],
  ["letters", /\b(ascii|unicode|characters?|letters?|text|string|grammar|alphabet)\b/],
  ["network", /\b(network|internet|server|protocol|router|packets?|wi-?fi)\b/],
  ["sigma", /\b(sum|series|sigma|statistics?|mean|average|variance)\b/],
  ["axes", /\b(slope|derivative|integral|calculus|equation|functions?|curve|linear)\b/],
  ["pi", /\b(circle|radius|geometry|angle|triangle|pi)\b/],
  ["chart", /\b(chart|data|percent|rate|growth|interest|bar graph)\b/],
  ["market", /\b(supply|demand|market|price|equilibrium|econom\w*)\b/],
  ["coin", /\b(money|dollars?|loan|bank|cost|funds?|savings|budget)\b/],
  ["atom", /\b(atoms?|electrons?|physics|energy|nuclear|protons?)\b/],
  ["wave", /\b(waves?|sound|frequency|signal|light)\b/],
  ["flask", /\b(chemistry|chemical|reaction|acid|base|solution|lab)\b/],
  ["molecule", /\b(molecules?|bonds?|compound|element)\b/],
  ["dna", /\b(dna|genes?|genetic|biology|cells?|protein)\b/],
  ["leaf", /\b(plants?|ecology|photosynthesis|leaf|environment|climate)\b/],
  ["globe", /\b(world|country|countries|history|war|sovereignty|map|geography|nation)\b/],
  ["column", /\b(law|government|court|constitution|politic\w*|rome|greek|empire)\b/],
  ["book", /\b(read|reading|book|novel|literature|essay|writing|poem)\b/],
  ["puck", /\b(hockey|puck|rink|stick|ice)\b/],
  ["whistle", /\b(referee|penalty|foul|whistle|offside|icing|linesman|faceoff)\b/],
  ["goal", /\b(goal|net|goalie|shoot|shot|score)\b/],
  ["trophy", /\b(cup|champion\w*|trophy|tournament|win|wins)\b/],
  ["clock", /\b(minutes?|periods?|deadline|seconds?|overtime)\b/],
  ["gear", /\b(engineer\w*|machine|system|mechanism|process)\b/],
];
const FALLBACK = ["bulb", "pencil", "book"];

const cache = new Map(); // session id -> { at, theme }

function pick(text, terms, title) {
  const t = ` ${text.toLowerCase()} `;
  const scored = ICONS.map(([id, re]) => [id, (t.match(new RegExp(re.source, "g")) || []).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const icons = scored.slice(0, 7).map(([id]) => id);
  for (const f of FALLBACK) if (icons.length < 3) icons.push(f);
  // words: the course's own terms, the ones being said right now first
  const recent = text.slice(-1500).toLowerCase();
  const said = terms.filter((w) => recent.includes(w.toLowerCase()));
  const words = [...new Set([...said, ...terms])].filter((w) => w.length <= 16).slice(0, 6);
  return { icons, words: words.length ? words : title ? [title] : [] };
}

// Theme for a lecture: course terms plus the last ~40 lines (or the whole thing once it's over).
export function sessionTheme(sessionId) {
  const hit = cache.get(sessionId);
  if (hit && Date.now() - hit.at < 20000) return hit.theme;
  const s = one("SELECT course_id, status FROM lecture_sessions WHERE id = ?", sessionId);
  if (!s) return null;
  const c = one("SELECT name, code, terms FROM courses WHERE id = ?", s.course_id);
  const terms = String(c.terms || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const lines = all("SELECT text FROM transcript_lines WHERE session_id = ? ORDER BY idx DESC LIMIT ?", sessionId, s.status === "ended" ? 400 : 40).map((l) => l.text).reverse();
  // the course name and terms count once; what's being said counts more, so the drawings follow the lecture
  const theme = pick(`${c.name} ${terms.join(" ")} ${lines.join(" ")} ${lines.slice(-12).join(" ")}`, terms, c.code);
  cache.set(sessionId, { at: Date.now(), theme });
  return theme;
}

// ---------- course covers ----------
// Each course card has a decorative cover drawn in public/covers.js: a subject and one of its
// variants, stored as "subject/variant". The professor can pick one; otherwise the subject is guessed
// from the course name and the variant comes from the course id, so it never changes on refresh.
export const VARIANTS = 3;
export const ART = {
  biology: { label: "Biology", names: ["Cells", "Branching", "Leaf veins"] },
  computing: { label: "Computing", names: ["Circuit", "Network", "Layers"] },
  micro: { label: "Microeconomics", names: ["Exchange", "Choices", "Buyers and sellers"] },
  macro: { label: "Macroeconomics", names: ["Circular flow", "Broad flows", "Nested systems"] },
  history: { label: "History and government", names: ["Archive", "Timeline", "Colonnade"] },
  math: { label: "Mathematics", names: ["Construction", "Curves", "Polygons"] },
  chemistry: { label: "Chemistry", names: ["Rings", "Molecule", "Orbitals"] },
  physics: { label: "Physics", names: ["Ripples", "Orbits", "Field lines"] },
  writing: { label: "Language and writing", names: ["Pen line", "Pages", "Paragraphs"] },
  sports: { label: "Sports", names: ["Markings", "Trajectories", "Lanes"] },
  general: { label: "General", names: ["Dots", "Circles", "Hatching"] },
};
export const ART_IDS = Object.keys(ART);
const ART_GUESS = [
  ["computing", /\b(comput\w*|cs|program\w*|software|network\w*|data|algorithm\w*|cyber\w*|information)\b/],
  ["macro", /\b(macro\w*)\b/],
  ["micro", /\b(econ\w*|finance|business|market\w*|accounting|micro\w*)\b/],
  ["biology", /\b(bio\w*|cell\w*|genetic\w*|anatomy|ecology|marine)\b/],
  ["chemistry", /\b(chem\w*)\b/],
  ["physics", /\b(physic\w*|mechanics|engineering)\b/],
  ["math", /\b(math\w*|calculus|algebra|statistic\w*|geometry)\b/],
  ["history", /\b(history|government|politic\w*|law|civics|revolution)\b/],
  ["sports", /\b(hockey|sport\w*|football|soccer|basketball|athletic\w*|kinesiology)\b/],
  ["writing", /\b(english|writing|literature|language|spanish|french|composition)\b/],
];
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
// A professor's saved choice, checked: "" (automatic), "subject" or "subject/variant". Old "economics" means micro.
export function cleanArt(v) {
  const [s0, v0] = String(v ?? "").trim().split("/");
  const s = s0 === "economics" ? "micro" : s0;
  if (!s || !ART[s]) return "";
  const n = v0 === undefined ? null : Number(v0);
  if (n === null) return s;
  return Number.isInteger(n) && n >= 0 && n < VARIANTS ? `${s}/${n}` : "";
}
export function autoArt(c) {
  const text = `${c.code || ""} ${c.name || ""} ${String(c.terms || "").slice(0, 400)}`.toLowerCase();
  const subject = ART_GUESS.find(([, re]) => re.test(text))?.[0] || "general";
  return `${subject}/${hash(c.id || c.name || "") % VARIANTS}`;
}
// The cover students and the professor see: the saved choice, else the automatic one.
export function courseArt(c) {
  const saved = cleanArt(c.art);
  if (!saved) return autoArt(c);
  return saved.includes("/") ? saved : `${saved}/${hash(c.id || "") % VARIANTS}`;
}
