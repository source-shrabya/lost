# Lost

Students tap "I'm lost" during a lecture and keep listening. The professor sees a small counter of how many are lost right now. After class, each student gets a catch-up for the moments they tapped, and the professor gets a report of where the class got lost and what was being said.

Built for the VOXO Hatchathon 2026.

## Run it (two laptops, same Wi-Fi)

On the professor laptop:

```
npm install
npm start
```

The terminal prints two links.

- Professor: open `http://localhost:3000/prof` in Chrome on this laptop. It has to be `localhost`, because Chrome only allows the mic on localhost or https.
- Students: open the other link (something like `http://10.0.0.96:3000`) on any other device on the same Wi-Fi, and type the 4-letter code from the professor screen.

If the student laptop can't load the page, macOS may be blocking incoming connections. Allow Node when the firewall asks, or check System Settings > Network > Firewall. Some campus Wi-Fi blocks laptop-to-laptop traffic. A phone hotspot works around that.

## Transcript engines

Lost can use one of four engines. The professor screen shows which one is running next to the Transcript heading.

| Engine | Where it runs | Cost | Notes |
|---|---|---|---|
| Deepgram Nova-3 | Deepgram's servers | Pay per minute; new accounts get free credit | Most accurate in our tests. Needs internet. The lecture audio goes to Deepgram. Underlines words it isn't sure about. |
| Moonshine v2 (medium) | The professor laptop | Free | Words appear while the professor talks. Audio stays on the laptop. |
| faster-whisper (small.en) | The professor laptop | Free | Waits for a pause before each line. |
| Chrome speech recognition | Google, through Chrome | Free | Fallback. Can't use course terms. |

Lost uses Deepgram when a key is set, otherwise Moonshine. Force one with `TRANSCRIBER=deepgram`, `moonshine`, `whisper` or `off`.

### Deepgram

Make an API key at deepgram.com. In the `lost` folder, create a file named `.env` (git ignores it, so the key never reaches GitHub) with one line:

```
DEEPGRAM_API_KEY=your-key-here
```

Then `npm start`. The terminal says `Transcript: Deepgram Nova-3`. The key stays on the server and is never sent to browsers.

### Local engines (Moonshine, faster-whisper) and reading course files

One-time setup on the professor laptop. You need Python 3.9 or newer and ffmpeg. This is also what lets Lost read PDF, PPTX and DOCX files, so do it even if you use Deepgram.

Mac:

```
brew install ffmpeg
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Windows (PowerShell):

```
winget install ffmpeg
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

The first start downloads the model. Wait for `moonshine-medium-streaming is ready` before clicking Start class. If the terminal says it's using Chrome speech recognition, the line after "because" says what's missing. Options: `MOONSHINE_MODEL=small` or `tiny` is faster and less accurate; `WHISPER_MODEL=base.en` speeds up Whisper.

## Course materials

Open "Course materials" on the professor screen (it's open before class starts).

1. Type the course and lecture name.
2. Upload PDF, PPTX, DOCX or TXT files, or paste notes. Lost reads the text, including slide titles and speaker notes, and suggests terms such as names, acronyms and repeated technical words. Files up to 15 MB. Only the extracted text is kept, in `data/` on the laptop; the uploaded file itself is not stored.
3. Check each file's suggested terms and delete the wrong ones. The suggestions come from simple rules, so expect some noise.
4. Tick "Use for this lecture" on the files that apply. Add your own terms, one per line ("term: meaning" is fine; only the term is sent).

The terms in use (up to 100) go to the engine as recognition hints: Deepgram's `keyterm`, Moonshine's key terms, Whisper's prompt and hotwords. Only the list of terms is sent, never the documents. The engines still write what was said: a term is never added just because it's on the list. Terms help spelling. They can't remove room noise or make every accent work, and a mic close to the professor helps more than any list.

Scanned PDFs (pictures of pages) have no text. Lost says so and doesn't do OCR; paste the key terms instead.

During class the professor can double-click a transcript line to fix it. The original words are kept and shown when hovering over the "edited" tag.

## Testing the engines

`node eval/compare.mjs` (Mac only) makes test audio with five macOS voices (US, UK, Indian, Australian, Irish), clean and with background talk, and compares each engine with and without course terms. It writes `eval/results.md`. The voices are synthetic, so real lecture audio will do worse; use it to compare settings.

## Claude explanations

Without a key, the app still works, and the catch-up shows the transcript of what was said. With a key, Claude writes a short explanation, a practice question and a re-teach suggestion for the professor:

```
ANTHROPIC_API_KEY=sk-ant-... npm start
```

It uses `claude-opus-5-5` with the server-side refusal fallback turned on, so if the model declines a request the API retries it on another model.

## Running a class

1. Professor clicks Start class. The mic turns on, the transcript fills in (from Deepgram or the local speech model, if set up), and the professor's sound is shared for students who aren't in the room. If the mic fails, type into the box under the transcript.
2. Students tap I'm lost and keep listening. The button confirms with "Marked. You and 2 others."
3. Students can tap Show transcript to read what has been said so far. It stays hidden until they open it.
4. Students who aren't in the room tap Listen to class. The sound goes through the Lost server, about 2 seconds behind, so it works across any two networks.
5. The counter at the bottom left turns gold when 10% or more of the class tapped in the last 90 seconds.
6. Professor clicks End class. The report groups taps that came within 45 seconds of each other into one moment, and shows what was said in the 90 seconds before.
7. Professor reads it and clicks Send summaries to students. Each student only gets the moments they tapped. They can answer "Still confused" or "This didn't help", and those counts show up in the report.

## Demo mode

The yellow FAKE DATA panel is for loud rooms and for testing alone. "Play sample lecture" types a short recursion lecture into the transcript. "+10 fake students" and "5 fake taps now" add made-up students. Say out loud in the demo when you use it.

## How it handles the problems we listed

| Problem | What the app does |
|---|---|
| Students tap late | Each moment covers the 90 seconds before the first tap |
| One student spams the button | One tap per student every 20 seconds counts |
| "3 lost" means nothing without class size | The counter shows the share of the class, and alerts at 10% |
| Reading in class makes students more lost | The transcript stays hidden unless the student opens it, and the summary comes after class |
| Professors won't write extra material | Claude drafts it, the professor reads and sends |
| Professors fear the data | Students are anonymous, and student ids never reach the professor screen |
| Wi-Fi drops | The page reconnects by itself and keeps the student's id |

## Limits right now

- Everything is in memory. Restarting the server or clicking New class wipes the class.
- One class at a time per server.
- Speech-to-text is Chrome's built-in one. It struggles with accents and noise; Deepgram would be the upgrade.
- No slide upload yet, so recaps of board-heavy math lectures will be weak.

## Files

| File | What it does |
|---|---|
| `server.js` | The whole backend: class state, taps, grouping, Claude call, live updates |
| `public/prof.html` | Professor screen: transcript, counter, timeline, report |
| `public/student.html` | Student screen: join, button, catch-up |
| `public/style.css` | Styles for both |
