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

## Claude explanations

Without a key, the app still works, and the catch-up shows the transcript of what was said. With a key, Claude writes a short explanation, a practice question and a re-teach suggestion for the professor:

```
ANTHROPIC_API_KEY=sk-ant-... npm start
```

It uses `claude-opus-5-5` with the server-side refusal fallback turned on, so if the model declines a request the API retries it on another model.

## Running a class

1. Professor clicks Start class. The mic turns on and the transcript fills in. If the mic fails, type into the box under the transcript.
2. Students tap I'm lost. Nothing appears to read; they get "Marked. You and 2 others. Keep listening."
3. The counter at the bottom left turns red when 10% or more of the class tapped in the last 90 seconds.
4. Professor clicks End class. The report groups taps that came within 45 seconds of each other into one moment, and shows what was said in the 90 seconds before.
5. Professor reads it and clicks Send catch-up to students. Each student only gets the moments they tapped. They can answer "Still confused" or "This didn't help", and those counts show up in the report.

## Live camera and mic

For a demo where the student isn't in the same room, the professor clicks "Share camera + mic" and Chrome asks for permission. Each student who has joined gets the professor's video and sound at the top of their screen, sent straight from laptop to laptop over WebRTC. The Lost server only passes the connection setup messages. If the browser blocks sound, the student sees a "Tap for sound" button. Both laptops still need to be on the same Wi-Fi.

## Demo mode

The yellow FAKE DATA panel is for loud rooms and for testing alone. "Play sample lecture" types a short recursion lecture into the transcript. "+10 fake students" and "5 fake taps now" add made-up students. Say out loud in the demo when you use it.

## How it handles the problems we listed

| Problem | What the app does |
|---|---|
| Students tap late | Each moment covers the 90 seconds before the first tap |
| One student spams the button | One tap per student every 20 seconds counts |
| "3 lost" means nothing without class size | The counter shows the share of the class, and alerts at 10% |
| Reading in class makes students more lost | Nothing to read during class, the catch-up comes after |
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
