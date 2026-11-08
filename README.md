# Lost

Lost helps a student find the exact point in a lecture where they got lost, understand it from the lecture and the course materials, and get back into the class. After class, students get a summary and a private review of their own moments, and the professor sees when confusion happened and on which ideas.

The live loop is: mark confusion, pick what lost you, read a short explanation with its context and the flow of the discussion, check your understanding, catch up to what the professor is saying now.

Built for the VOXO Hatchathon 2026. This is a hackathon build. It is not production-ready: see "Limits" and "What production needs" below.

## Run it

You need Node.js 20.12 or newer.

```
git clone https://github.com/source-shrabya/lost.git
cd lost
npm install
cp .env.example .env      # then fill in what you have; everything is optional
npm start                 # http://localhost:3000
```

On campus Wi-Fi, which blocks laptop-to-laptop traffic, use `npm run share` instead. It starts a Cloudflare quick tunnel (install once with `brew install cloudflared`) and prints a public https link. Students use that link; the professor can keep using `localhost`, because Chrome only allows the mic on localhost or https.

Other commands:

```
npm test                       # automated tests (no network, fake AI, demo Canvas fixtures)
npm run reset-demo -- --yes    # delete data/lost.db; the next start re-seeds the demo data
```

Reading PDF, PPTX and DOCX files, and the local speech engines, need the Python setup (Mac: `brew install ffmpeg`, `python3 -m venv .venv`, `.venv/bin/pip install -r requirements.txt`). Plain text and Canvas pages work without it.

## Configuration

All settings are environment variables, read from `.env`. Names only; never commit values.

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | AI through the Anthropic API (Claude Haiku 5.5 by default, `LOST_MODEL` to change). Without it Lost uses Claude Code's `claude -p` if installed, otherwise AI is off. `LOST_AI=api\|cli\|off` forces one. |
| `DEEPGRAM_API_KEY` | Deepgram Nova-3 transcription. Without it: Moonshine on the laptop (Python setup), else Chrome speech recognition. `TRANSCRIBER=deepgram\|moonshine\|whisper\|off`. |
| `PUBLIC_URL` | The server's public https address. Used for the Canvas OAuth redirect and for join links and QR codes. |
| `CANVAS_CLIENT_ID`, `CANVAS_CLIENT_SECRET` | Canvas developer key for USM's Canvas. Turns on "Sign in with Canvas". |
| `CANVAS_DEV_TOKEN` | Testing only: the developer's own Canvas access token. |
| `PROF_SIGNUP_CODE` | Invite code needed to create a professor account. Empty means professor sign-up is off. |
| `LOST_DEMO` | `1` turns on demo accounts and sample Canvas data. On by default, off when `NODE_ENV=production`. |
| `LOST_SECRET` | 64 hex characters that encrypt stored Canvas tokens. Generated into `data/secret.key` if unset. |
| `LOST_OPEN_CLASSES` | A professor's email. Until a university connects Canvas, every student who signs in is put in all of that professor's classes. Empty means no automatic classes. |
| `PORT`, `LOST_DATA`, `LOST_DB` | Port (3000), data folder (`./data`), database file (`data/lost.db`). |

## Demo walkthrough

With demo mode on, the sign-in page lists five seeded accounts with one-click buttons. They are marked as demo accounts everywhere, and every course and file they touch is labelled "Demo Canvas (sample data)". Password for all of them: `lost-demo-2026`.

| Account | Role | Starting point |
|---|---|---|
| Dr. Maya Rivera | Professor | Three courses already imported and synced from demo Canvas |
| Dr. Daniel Okafor | Professor | New: goes through onboarding |
| Jordan Lee | Student | In CSC 311-001 and CSC 202 through demo Canvas |
| Sam Patel | Student | In nothing yet: joins with a code or QR |
| Riley Chen | Student | In CSC 311-002, the other section |

Professor, on a laptop:

1. Sign in as Dr. Maya Rivera. Three course cards show their sync status.
2. Open CSC 311, then Materials: the answer key, the instructor notes and a hidden quiz draft are "Professor only", following their Canvas state.
3. Back on Class, pick section 001, type a topic, and press Set up class. The join code and QR code appear.
4. Press Start class. Speak, type lines, or open "Setup and diagnostics" and press Play sample lecture (those lines are stored and shown as "sample").

Student, on a phone:

5. Sign in as Jordan Lee. The live banner says CSC 311 is live. Tap it.
6. Tap I'm lost. Pick the line that lost you (or keep "Explain the current topic"). The help card has A Explanation, B Context and C Flow of the discussion, with the transcript times and slide numbers it used.
7. Answer the quick check if one appears, press Still confused for another angle, or Check my understanding for a new example. Press Catch me up to now to see what was said while you were reading.

Back to the professor:

8. The tapped line is gold in the transcript. Press End class (twice, to confirm). Lost finishes the transcript, writes the summary in the background and publishes it.
9. The report shows when taps happened, taps and different students as separate numbers, resolved and unresolved counts, and each moment with what was being said and an AI topic label marked "inferred" with its evidence.

Student again: the bell shows a notification. The class page has the shared summary and "Your moments": where you got lost, the explanation you got, a review question for anything still open, and an office-hours question you can edit and copy.

To see joining by code, sign in as Sam Patel and enter the code from the professor's screen, or scan the QR code. To see onboarding, sign in as Dr. Daniel Okafor.

## How it works

| Part | File |
|---|---|
| HTTP server, routes and every access check | `server.js` |
| SQLite schema | `migrations/001_init.sql` (runs automatically) |
| Accounts, sessions, CSRF, token encryption | `lib/auth.js` |
| Canvas OAuth, adapters, import and sync | `lib/canvas.js`, sample data in `lib/demo-canvas.js` |
| Text extraction, passages, retrieval (SQLite FTS5) | `lib/materials.js`, `extract.py` |
| Live runtime: audio relay, transcript lines, gaps | `lib/live.js`, speech engines in `engines.js` |
| Help card, diagnostic, checks, catch-up | `lib/help.js` |
| AI provider boundary and output validation | `lib/ai.js` |
| Durable jobs, summaries, analytics | `lib/jobs.js`, `lib/summary.js` |
| Pages | `public/` (no framework, no inline scripts) |

Security. Passwords are hashed with scrypt. Sign-in is an HttpOnly, SameSite=Lax cookie; only a hash of the token is stored. Every request that changes something needs the session's CSRF token in a header. Each professor route checks that the course belongs to that professor; each student route checks the student is enrolled in that section, and each event or check belongs to that student. Choosing "Professor" at sign-up does nothing without the invite code, and a professor account still sees only its own courses. API keys and Canvas tokens stay on the server; Canvas tokens are encrypted at rest.

Course materials. A material is a Canvas file or page, an upload, or pasted notes. Its text is split into passages labelled with where they came from ("Slide 4", "Page 2", a page heading). Canvas items that are unpublished, hidden, locked or in a hidden folder are stored as professor-only. Student answers and citations only ever read student-visible passages, and never PowerPoint speaker notes. A professor can make an item stricter than Canvas, not looser. Sync downloads only items whose Canvas timestamp changed, updates them in place, and marks items that left Canvas as removed (their text is deleted so it can't be cited).

AI. Every request gets the transcript around the student's moment and up to three student-visible passages, each with an id (`L12`, `P34`). The model has to cite those ids. Lost checks every reply against a JSON schema, then removes any citation that wasn't in the evidence, relabels an example as "written by the AI" if its source doesn't check out, and drops a "next idea" that wasn't actually said after the confusing line. Transcript and materials go in as reference data, never as instructions. Identical requests (double clicks) share one call. Timeouts, rate limits and outages fall back to the transcript excerpt and the matching course passages, with the reason shown.

End of class. Ending stops new audio, waits for the speech engine's last words, closes the session and queues a summary job in SQLite. The job runs in the background, retries with backoff up to four times, and survives a restart. Re-running it can't publish twice: the summary is one row per class and notifications are unique per person and class. The professor sees pending, failed (with Try again) or published. The shared summary never contains student questions; each student's own moments are added only on their page.

Privacy in the report. Taps and different students are separate numbers. When fewer than three students tapped in a moment, Lost hides the breakdown by category and resolution, because it could point at one person. AI-drafted clarifications and suggestions are only made when the professor asks, and Lost never sends or publishes them.

## Canvas at USM

USM's Canvas is `https://usm.instructure.com` (checked 2026-11-06: it redirects to `/login/saml`, USM's single sign-on). `canvas.usm.edu` is a USM page that links there, and `usm.canvas.com` does not exist.

Lost uses the Canvas REST API with OAuth 2, as Canvas's documentation describes (https://canvas.instructure.com/doc/api/file.oauth.html). For Instructure-hosted Canvas, that page says developer keys "are issued by the admin of the institution", so a professor can't set this up alone. To turn it on at USM:

1. Ask USM's Canvas administrators (through ITech) for an API developer key for Lost. Give them the redirect URI `https://<your server>/api/canvas/callback` and the scopes Lost reads: courses, sections, enrollments, files, folders, pages and modules.
2. Put the key in `CANVAS_CLIENT_ID` and `CANVAS_CLIENT_SECRET`, and the server's https address in `PUBLIC_URL`.
3. Restart. "Sign in with Canvas" turns on for professors and students.

Canvas's documentation also says asking other users to generate and paste personal tokens breaks its API policy, so Lost has no such field. `CANVAS_DEV_TOKEN` is only for the developer to test the connector against their own account.

An LTI 1.3 install (Lost opened from inside Canvas) would also need the administrators: Canvas's documentation says LTI service tokens work only where the tool has been deployed. It isn't built.

The real Canvas connector has not been run against usm.instructure.com, because there is no developer key. It is covered by the same import and sync code paths the demo adapter uses, and by tests with fake adapters for failures, partial failures, removals and repeated syncs.

## Classroom experience

Sign-in is a school email, then the university. Students go straight in with no password; professors add their password. The university option is the name as text. USM publishes logo files at usm.edu/university-communications/university-logo.php, but that page says the university owns its logos and "reserves the right to review and monitor logo usage", and it says nothing about outside or student projects. So Lost shows no USM logo until University Communications approves one in writing. Lost is not affiliated with or endorsed by the university.

Professor live screen: a large microphone button that reads "Microphone on" or "Microphone off". Space or M toggles it when the page has focus. The shortcuts ignore typing, open dialogs, held keys, Ctrl/Cmd/Alt combinations, and Space on a focused button. `?` opens the list of shortcuts, T focuses the type-a-line box, L shows the sign-in link and E opens the end-class dialog. Ending class always asks first. Muting drops audio pieces not yet sent, and the server refuses any piece that arrives after the mute (409), so nothing reaches the transcriber or the listeners. Ending class sends what was already recorded first. Lost records only the browser microphone, never computer audio.

Student live screen: the transcript is the main surface. New lines never move a reader who scrolled up; a "Jump to live" button appears instead. Students tap a line, or I'm lost, to mark the moment. On a wide screen help opens beside the transcript and can be resized (drag or arrow keys) or minimized; on a phone it is a bottom sheet with "Back to live". "Got it" marks the moment understood, closes the panel and offers Undo. Closing or minimizing never marks anything understood. "My moments" reopens any moment and its help. Shortcuts: L for I'm lost, J to jump to live, Esc to minimize help, ? for the list. "Catch me up" summarises only what was said since the tap, and shows the lines themselves when fewer than 2 lines or 20 words were said.

Help cards: the question, a short hook, the idea in one sentence, one picture when it helps, an example, and where it fits in class. "Explain more" and "Sources" open on demand. Pictures are drawn from checked specs with fixed SVG templates; the AI never sends markup. Types: rink or field zones (players, pucks, lines, regions), place values for number bases, worked calculations (with a bar sequence for changing balances), supply and demand, parity grids, decision branches, processes, comparisons, cause and effect, concept maps and analogies. Lost computes every number shown. A picture that fails the checks is left out and the card says so, with a button to try another explanation. A "misheard" warning is dropped when every line near the moment was typed rather than spoken.

After class: a private "Your learning moments" list shows every moment, marked either "You said you got it" or "Still open", and an optional quiz of up to 3 questions with new examples. Quiz answers are stored apart from what the student marked and are not grades.

Course cards carry a band of line drawings chosen from the course name, or picked by the professor in course settings. The drawings were made for this project (public/theme.js), so there are no outside image licences. No image-generation service is used; this repository never had a Cloudflare or FLUX integration.

Theme: Bricolage Grotesque for headings, Atkinson Hyperlegible Next for reading text (both Google Fonts, SIL Open Font License). Light, dark or automatic, remembered per device. Sign out asks first. A professor signing out during a live class chooses between keeping the class open with the mic off, ending the class, or staying signed in. An expired session returns to sign-in with a note.

## Tests

`npm test` runs 25 end-to-end tests against a real server on a random port, with an in-memory database, the demo Canvas fixtures and a deterministic fake AI. They cover: a professor with three courses and another professor who can't see them; onboarding import without duplicates; students joining the right section and being refused a second section; cross-course, cross-student, wrong-role, missing-CSRF and signed-out access; professor-only Canvas content kept out of retrieval and out of the AI prompt; repeated, failed, partial and removing syncs; the full help flow with citation cleaning; several students at once and duplicate requests sharing one AI call; the AI rate-limited or off; transcript gaps and thin evidence; ending class mid-request; summary after a simulated crash with no duplicate notifications; summary failure then retry; resolution counts; resuming instead of duplicating a session; join links and redirects; the help rate limit; Space and M toggling once and staying out of typing, focused buttons, dialogs and held keys; muting dropping queued audio and the server refusing audio after a mute without ending class; Got it with Undo, closing help not resolving, and moments private to their student; school-email sign-in; course art choices.

Tested in headless Chromium on 2026-11-08 against the real Claude Haiku 5.5 API, with a fake microphone (not in `npm test`): the whole journey at 1280 px and 390 px, 24 checks, all passing. Real-AI cards drew a picture for hockey icing and offside (player and puck against the blue line), loanable funds, compound interest, two-dimensional parity and binary place values. Not tested: real Deepgram audio in a room, real Canvas, screen readers, Safari.

Tested by hand on 2026-11-06, not in `npm test`: the live help flow and the end-of-class summary against the real Claude Haiku 5.5 API (explanation in about 6 seconds, re-explanation and catch-up in 3 to 4), and the professor and student pages in headless Chromium at 1280 px, iPhone 13 (390 px) and 320 px, including reaching I'm lost by keyboard. No sideways scrolling at any of those widths. Not tested: real Canvas, Deepgram in a real room, screen readers.

## Limits

- One speech-engine stream per server: the first live class that sends audio gets Deepgram or Moonshine, other live classes at the same time use Chrome speech recognition on the professor's laptop (the screen says so).
- Live pages poll every second. That works through the Cloudflare tunnel; it isn't built for hundreds of concurrent classes.
- Retrieval is keyword search (SQLite FTS5), not embeddings. Scanned PDFs need OCR, which Lost doesn't do.
- Email and password accounts have no email verification or password reset yet.
- Rate limits are in memory and reset on restart.
- Student sign-in has no password: anyone who types a student's email gets that account. Fine for a demo, not for real use; university single sign-on replaces it.
- The AI places marks on rink and field pictures. Lost checks that they are in range, not that they match the rule, so a picture can be loose (for example a puck drawn just past the line).
- No USM logo (see Classroom experience). No image generation.

## What production needs

- Real sign-in through USM single sign-on (SAML or OpenID Connect through USM ITech), or Canvas OAuth as the login, instead of local passwords.
- The Canvas developer key above, approved by USM.
- HTTPS hosting with `PUBLIC_URL` set, `NODE_ENV=production`, `LOST_DEMO=0`, a fixed `LOST_SECRET`, and backups of the database.
- A review of FERPA obligations for confusion data and transcripts, and a retention policy.
