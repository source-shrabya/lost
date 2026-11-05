# Lost transcriber: turns the professor's audio into transcript lines with faster-whisper.
# It runs on this computer, so no audio leaves it and there is no per-minute charge.
#
# Input (stdin): raw audio, 16 kHz, mono, 16-bit. The Node server feeds it.
# Output (stdout): one JSON object per line.
#   {"ready": true}                       when the model has loaded
#   {"text": "...", "start": 1730000000.1} one finished sentence or phrase; start is the
#                                          computer's clock time when that speech began
#
# Settings (environment variables):
#   WHISPER_MODEL  model name, default small.en (large-v3 is more accurate but too slow live on a laptop CPU)
#   LOST_TERMS     course words to spell right, comma separated, e.g. "recursion, call stack, Cauchy"

import json, os, queue, sys, threading, time
import numpy as np
from faster_whisper import WhisperModel

RATE = 16000
BLOCK = RATE // 10 * 2      # 0.1 s of 16-bit audio, in bytes
QUIET_RMS = 0.006           # below this loudness a block counts as silence
PAUSE = 0.7                 # a pause this long ends a phrase
MAX_LEN = 8.0               # never wait longer than this before transcribing
MIN_SPEECH = 0.4            # ignore blips shorter than this

model_name = os.environ.get("WHISPER_MODEL", "small.en")
terms = os.environ.get("LOST_TERMS", "").strip()
prompt = f"Lecture vocabulary: {terms}." if terms else None

def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

model = WhisperModel(model_name, device="cpu", compute_type="int8")
say({"ready": True, "model": model_name})

# Read stdin on a separate thread so a quiet stream can still flush the last phrase.
blocks = queue.Queue()
def reader():
    buf = b""
    while True:
        chunk = sys.stdin.buffer.read1(65536) if hasattr(sys.stdin.buffer, "read1") else sys.stdin.buffer.read(BLOCK)
        if not chunk:
            blocks.put(None); return
        buf += chunk
        while len(buf) >= BLOCK:
            blocks.put((time.time(), buf[:BLOCK])); buf = buf[BLOCK:]
threading.Thread(target=reader, daemon=True).start()

def transcribe(audio, started):
    segments, _ = model.transcribe(
        audio, language="en", beam_size=1, vad_filter=True,
        condition_on_previous_text=False, initial_prompt=prompt,
        hotwords=terms or None,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    if text:
        say({"text": text, "start": started})

parts, started, speech, quiet = [], None, 0.0, 0.0
while True:
    try:
        item = blocks.get(timeout=0.5)
    except queue.Empty:
        item = "idle"
    if item is None:
        break
    if item != "idle":
        arrived, raw = item
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        loud = float(np.sqrt(np.mean(samples ** 2))) >= QUIET_RMS
        if loud and started is None:
            started = arrived - 0.1
        if started is not None:
            parts.append(samples)
            speech += 0.1 if loud else 0
            quiet = 0.0 if loud else quiet + 0.1
    else:
        quiet += 0.5  # no audio arriving (mic stopped) counts as a pause
    length = len(parts) / 10
    if started is not None and (quiet >= PAUSE or length >= MAX_LEN):
        if speech >= MIN_SPEECH:
            try:
                transcribe(np.concatenate(parts), started)
            except Exception as e:  # keep running; one bad phrase shouldn't stop the class
                sys.stderr.write(f"transcribe failed: {e}\n")
        parts, started, speech, quiet = [], None, 0.0, 0.0
