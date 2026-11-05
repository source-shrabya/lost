# Lost transcriber using Moonshine v2 (moonshine-voice), a streaming speech model that runs on this
# computer. It transcribes while the professor is still talking, so words show up sooner than with
# Whisper, which waits for a pause.
#
# Same contract as transcribe.py:
# Input (stdin): raw audio, 16 kHz, mono, 16-bit. The Node server feeds it.
# Output (stdout): one JSON object per line.
#   {"ready": true, "model": "..."}       when the model has loaded
#   {"partial": "..."}                     words of the line still being spoken (may change)
#   {"text": "...", "start": 1730000000.1} a finished line; start is the computer's clock time
#                                          when that speech began
#
# Settings (environment variables):
#   MOONSHINE_MODEL  medium (default), small or tiny. Smaller is faster and less accurate.
#   LOST_TERMS       course words to spell right, comma separated, e.g. "recursion, call stack, Cauchy"

import json, os, sys, time
import numpy as np
from moonshine_voice.download import get_model_for_language
from moonshine_voice.transcriber import Transcriber, ModelArch, LineCompleted, LineTextChanged

RATE = 16000
CHUNK = RATE // 4 * 2   # 0.25 s of 16-bit audio, in bytes

ARCHS = {"tiny": ModelArch.TINY_STREAMING, "small": ModelArch.SMALL_STREAMING, "medium": ModelArch.MEDIUM_STREAMING}
size = os.environ.get("MOONSHINE_MODEL", "medium")
terms = [t.strip() for t in os.environ.get("LOST_TERMS", "").split(",") if t.strip()]

def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

# Download logs would mix into stdout, which the server reads as JSON, so send them to stderr.
real_stdout, sys.stdout = sys.stdout, sys.stderr
model_path, arch = get_model_for_language("en", ARCHS.get(size, ModelArch.MEDIUM_STREAMING))
transcriber = Transcriber(model_path, arch, update_interval=0.5)
sys.stdout = real_stdout
if terms:
    transcriber.set_keyterms(terms)

# Seconds of audio fed so far. Moonshine gives each line a start time in "audio seconds"; turning
# that into clock time as (now - how far back in the audio it began) also works across pauses
# between the professor's sharing sessions.
fed = 0.0

def on_event(event):
    line = event.line
    if isinstance(event, LineCompleted):
        text = (line.text or "").strip()
        if text:
            say({"text": text, "start": time.time() - max(0.0, fed - line.start_time)})
    elif isinstance(event, LineTextChanged) and not line.is_complete:
        say({"partial": (line.text or "").strip()})

transcriber.add_listener(on_event)
transcriber.start()
say({"ready": True, "model": f"moonshine-{size}-streaming"})

buf = b""
while True:
    chunk = sys.stdin.buffer.read1(65536)
    if not chunk:
        break
    buf += chunk
    while len(buf) >= CHUNK:
        samples = np.frombuffer(buf[:CHUNK], dtype=np.int16).astype(np.float32) / 32768.0
        buf = buf[CHUNK:]
        fed += len(samples) / RATE
        try:
            transcriber.add_audio(samples.tolist(), RATE)
        except Exception as e:  # keep running; one bad pass shouldn't stop the class
            sys.stderr.write(f"moonshine add_audio failed: {e}\n")

transcriber.stop()  # flushes the last line
