// Sample Canvas data for the demo adapter. Nothing here comes from a real Canvas account, and the
// app labels every course and material made from it "Demo Canvas (sample data)".
// It deliberately includes unpublished and hidden items so the permission rules can be seen working.

const slides311 = [
  ["Slide 1", "Error detection\nCSC 311 Computer Networks, Week 7"],
  ["Slide 2", "Why errors happen\nNoise, interference and weak signals can flip bits in transit.\nThe receiver needs a way to notice that a frame arrived damaged."],
  ["Slide 3", "Single parity bit\nAdd one bit so the total number of 1s is even (even parity).\nExample: data 1011001 has four 1s, so the parity bit is 0 and we send 10110010.\nA single flipped bit makes the count odd, so the receiver detects it.\nTwo flipped bits keep the count even, so single parity misses them."],
  ["Slide 4", "Two-dimensional parity\nArrange the data bits in a grid of rows and columns.\nCompute a parity bit for every row and for every column, plus one corner bit.\nA single bit error shows up as exactly one bad row and one bad column; their intersection is the flipped bit, so the receiver can correct it.\nIt detects all 1-, 2- and 3-bit errors and some 4-bit errors."],
  ["Slide 5", "Worked example: 2D parity\nData rows: 1010, 1100, 0111.\nRow parity (even): 0, 0, 1. Column parity: 0, 0, 1, 0.\nIf the bit in row 2, column 3 flips, row 2 and column 3 both fail their checks."],
  ["Slide 6", "Internet checksum\nTreat the data as 16-bit integers, add them with one's complement arithmetic, and send the complement of the sum.\nUsed in IP, UDP and TCP headers. Cheap to compute, weaker than CRC."],
  ["Slide 7", "Cyclic redundancy check (CRC)\nTreat the bits as a polynomial and divide by an agreed generator G using modulo-2 arithmetic.\nThe remainder is the CRC. CRC-32 catches all burst errors of 32 bits or fewer.\nUsed in Ethernet and Wi-Fi frames."],
];
const notes311 = [["Slide 4 speaker notes", "Students usually mix up detecting and correcting here. Spend extra time on why one bad row plus one bad column pins down the bit."]];

export const DEMO_CANVAS = {
  "dr.rivera@demo.lost": {
    user: { id: "demo-u-1001", name: "Maya Rivera" },
    courses: [
      {
        id: "demo-c-311", name: "Computer Networks", course_code: "CSC 311", term: "Fall 2026",
        sections: [
          { id: "demo-s-311-001", name: "CSC 311-001 (MWF 10:00)", roster: ["jordan@demo.lost"] },
          { id: "demo-s-311-002", name: "CSC 311-002 (TR 1:00)", roster: ["riley@demo.lost"] },
        ],
        items: [
          { type: "file", id: "f-311-7", title: "07-error-detection.pptx", kind: "pptx", module: "Week 7: Error detection", updated_at: "2026-10-30T15:00:00Z",
            published: true, parts: [...slides311.map(([loc, text]) => ({ loc, text })), ...notes311.map(([loc, text]) => ({ loc, text, staff: true }))] },
          { type: "page", id: "p-311-hw5", title: "Homework 5: Error detection", module: "Week 7: Error detection", updated_at: "2026-11-01T12:00:00Z", published: true,
            html: "<h2>Homework 5</h2><p>Due Friday, November 13 at 11:59 pm.</p><p>1. Compute the even parity bit for 1101011.</p><p>2. Build the two-dimensional parity grid for the rows 1001, 0110, 1111 and show which bit is wrong if row 1 column 2 flips.</p><p>3. Explain why single parity cannot detect a two-bit error.</p>" },
          { type: "page", id: "p-311-hamming", title: "Lab 4: Hamming distance", module: "Week 7: Error detection", updated_at: "2026-10-28T09:00:00Z", published: true,
            html: "<h2>Hamming distance</h2><p>The Hamming distance between two codewords is the number of bit positions where they differ. A code with minimum distance d detects up to d-1 bit errors and corrects up to floor((d-1)/2).</p><p>Single parity has minimum distance 2, so it detects 1-bit errors and corrects none.</p>" },
          { type: "file", id: "f-311-key", title: "Exam 2 answer key.docx", kind: "docx", module: "", updated_at: "2026-11-02T10:00:00Z", published: false,
            parts: [{ loc: "Section: Question 4", text: "Answer key, question 4: the corrected codeword is 1011 0110; students must show the row and column parity checks." }] },
          { type: "page", id: "p-311-instr", title: "Instructor notes: common mistakes", module: "", updated_at: "2026-10-29T10:00:00Z", published: false,
            html: "<p>Private: last year many students thought 2D parity corrects two-bit errors. It does not.</p>" },
          { type: "file", id: "f-311-hidden", title: "Quiz 3 draft.pdf", kind: "pdf", module: "", updated_at: "2026-11-03T10:00:00Z", published: true, hidden: true,
            parts: [{ loc: "Page 1", text: "Draft quiz: which error-detection method does Ethernet use?" }] },
        ],
      },
      {
        id: "demo-c-202", name: "Data Structures", course_code: "CSC 202", term: "Fall 2026",
        sections: [{ id: "demo-s-202-h01", name: "CSC 202-H01 (Honors)", roster: ["jordan@demo.lost"] }],
        items: [
          { type: "page", id: "p-202-rec", title: "Recursion notes", module: "Week 9: Recursion", updated_at: "2026-10-20T12:00:00Z", published: true,
            html: "<h2>Recursion</h2><p>A recursive function calls itself on a smaller input. Every recursive function needs a base case that stops the calls.</p><p>factorial(n) = n * factorial(n - 1), with factorial(0) = 1.</p><h2>The call stack</h2><p>Each call gets its own stack frame. The frames unwind after the base case returns, and the multiplications happen on the way back up.</p><p>Without a base case the stack keeps growing until a stack overflow.</p>" },
        ],
      },
      {
        id: "demo-c-415", name: "Operating Systems", course_code: "CSC 415", term: "Fall 2026",
        sections: [{ id: "demo-s-415-001", name: "CSC 415-001", roster: [] }],
        items: [
          { type: "page", id: "p-415-sched", title: "CPU scheduling", module: "Week 8: Scheduling", updated_at: "2026-10-25T12:00:00Z", published: true,
            html: "<h2>Scheduling</h2><p>First-come first-served runs jobs in arrival order. Shortest job first minimises average waiting time when burst lengths are known. Round robin gives each process a time quantum.</p>" },
        ],
      },
    ],
  },
  "dr.okafor@demo.lost": {
    user: { id: "demo-u-1002", name: "Daniel Okafor" },
    courses: [
      {
        id: "demo-c-301", name: "Probability and Statistics", course_code: "STA 301", term: "Fall 2026",
        sections: [{ id: "demo-s-301-001", name: "STA 301-001", roster: ["riley@demo.lost"] }],
        items: [
          { type: "page", id: "p-301-bayes", title: "Bayes' rule", module: "Week 6", updated_at: "2026-10-10T12:00:00Z", published: true,
            html: "<p>P(A|B) = P(B|A) P(A) / P(B). The prior P(A) is updated by the likelihood P(B|A).</p>" },
        ],
      },
    ],
  },
};

// Student side: which demo sections a student's demo Canvas account is enrolled in.
export function demoStudentSections(email) {
  const out = [];
  for (const prof of Object.values(DEMO_CANVAS)) for (const c of prof.courses) for (const s of c.sections) if (s.roster.includes(email)) out.push(s.id);
  return out;
}
