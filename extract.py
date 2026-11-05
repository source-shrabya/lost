# Lost: pull readable text and likely lecture terms out of a course file.
# Usage: python extract.py <file> <pdf|pptx|docx|txt>
# Prints one JSON object: {"text", "titles", "notes", "pages", "scanned", "warning", "terms"}
#
# PPTX and DOCX are zip files of XML, so Python's standard library reads them. PDF needs pypdf.
# Scanned PDFs (pictures of pages) have no text layer. This script flags them; it does not do OCR.

import json, re, sys, zipfile
from collections import Counter
from xml.etree import ElementTree as ET

path, kind = sys.argv[1], sys.argv[2]
out = {"text": "", "titles": [], "notes": [], "pages": 0, "scanned": False, "warning": "", "terms": []}

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

def num(name):
    m = re.search(r"(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0

def shape_texts(xml):
    """Text of each shape on a slide, with whether the shape is a title placeholder."""
    root = ET.fromstring(xml)
    shapes = []
    for sp in root.iter(P + "sp"):
        ph = sp.find(f".//{P}nvPr/{P}ph")
        is_title = ph is not None and ph.get("type") in ("title", "ctrTitle")
        paras = []
        for para in sp.iter(A + "p"):
            t = "".join(r.text or "" for r in para.iter(A + "t")).strip()
            if t:
                paras.append(t)
        if paras:
            shapes.append((is_title, paras))
    return shapes

try:
    if kind == "txt":
        with open(path, encoding="utf-8", errors="replace") as f:
            out["text"] = f.read()

    elif kind == "docx":
        with zipfile.ZipFile(path) as z:
            root = ET.fromstring(z.read("word/document.xml"))
        paras = []
        for para in root.iter(W + "p"):
            t = "".join(r.text or "" for r in para.iter(W + "t")).strip()
            if t:
                paras.append(t)
                style = para.find(f"{W}pPr/{W}pStyle")
                if style is not None and "heading" in (style.get(W + "val") or "").lower():
                    out["titles"].append(t)
        out["text"] = "\n".join(paras)

    elif kind == "pptx":
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            slides = sorted([n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)], key=num)
            notes = {num(n): n for n in names if re.match(r"ppt/notesSlides/notesSlide\d+\.xml$", n)}
            lines = []
            for s in slides:
                for is_title, paras in shape_texts(z.read(s)):
                    if is_title:
                        out["titles"].append(" ".join(paras))
                    lines.extend(paras)
                # speaker notes: skip the slide-number placeholder text
                if num(s) in notes:
                    for _, paras in shape_texts(z.read(notes[num(s)])):
                        for t in paras:
                            if not t.isdigit():
                                out["notes"].append(t)
                                lines.append(t)
            out["pages"] = len(slides)
            out["text"] = "\n".join(lines)

    elif kind == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(path)
        out["pages"] = len(reader.pages)
        texts = [(page.extract_text() or "").strip() for page in reader.pages]
        empty = sum(1 for t in texts if len(t) < 20)
        out["text"] = "\n".join(texts)
        if out["pages"] and empty / out["pages"] > 0.5:
            out["scanned"] = True
            out["warning"] = f"{empty} of {out['pages']} pages have no text. This looks scanned and needs OCR, which Lost doesn't do. Paste the key terms instead."
except Exception as e:
    out["warning"] = f"Couldn't read this file ({type(e).__name__}). Transcription still works without it."

# ---------- likely terms ----------
# A rough first list for the professor to edit, not a final answer: acronyms, capitalized names
# and phrases, words with digits or symbols, slide titles, and longer words that repeat.
STOP = set("""a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here
hers him his how i if in into is it its itself just let like make many may me might more most must my no nor not now of
off on once only or other our ours out over own same she should so some such than that the their them then there these
they this those through to too under until up very was we were what when where which while who whom why will with would
you your yours example examples today lecture slide slides next first second third chapter section page figure note notes
using used use called means mean case cases point points way ways thing things look let's we'll here's there's""".split())
text = out["text"]
found = Counter()
for m in re.finditer(r"\b[A-Z]{2,6}s?\b", text):                      # acronyms: CPU, FFT, APIs
    found[m.group(0)] += 3
for m in re.finditer(r"\b(?:[A-Z][a-z]+(?:[- ][A-Z][a-z]+)+)\b", text):  # Capitalized Phrases: Fourier Transform
    found[m.group(0)] += 2
for m in re.finditer(r"(?<=[a-z,;] )[A-Z][a-z]{2,}\b", text):          # names mid-sentence: Cauchy, Dijkstra
    found[m.group(0)] += 2
for m in re.finditer(r"\b[A-Za-z]+[0-9]+[A-Za-z0-9]*\b|\b[A-Za-z]+-[A-Za-z]+\b", text):  # O2, log2, big-O
    found[m.group(0)] += 1
words = Counter(w.lower() for w in re.findall(r"\b[a-zA-Z]{6,}\b", text))
for w, c in words.items():
    if c >= 2 and w not in STOP:
        found[w] += c
for t in out["titles"]:
    t = re.sub(r"\s+", " ", t).strip(" :.-")
    if 2 < len(t) <= 40:
        found[t] += 4
terms = [t for t, _ in found.most_common() if t.lower() not in STOP and len(t) <= 40]
seen, clean = set(), []
for t in terms:
    k = t.lower()
    if k not in seen:
        seen.add(k); clean.append(t)
out["terms"] = clean[:60]
out["text"] = out["text"][:200000]
print(json.dumps(out))
