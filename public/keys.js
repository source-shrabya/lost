// Keyboard shortcuts and the microphone sender. Plain functions with no DOM access of their own,
// so test/lost.test.js can run them in Node.
(function (root) {
  // Places where a key belongs to what the person is doing, never to a shortcut.
  const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="slider"], [role="spinbutton"]';
  // Focused controls that already do something with Space (activate, toggle, scroll).
  const SPACE_USERS = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="separator"], [tabindex]:not([tabindex="-1"])';

  const within = (el, sel) => !!(el && el.closest && el.closest(sel));

  // maps: { key (lower case, or " " / "?" / "escape") -> action }. Returns the action or null.
  function shortcutFor(e, { map, dialogOpen = false } = {}) {
    if (!e || e.repeat || e.isComposing) return null;
    if (e.ctrlKey || e.metaKey || e.altKey) return null; // browser and system shortcuts
    const t = e.target;
    if (dialogOpen || within(t, "dialog[open]")) return null;
    if (within(t, EDITABLE) || (t && t.isContentEditable)) return null;
    const key = e.key === " " || e.key === "Spacebar" ? " " : e.key === "Escape" ? "escape" : String(e.key || "").toLowerCase();
    if (key === " " && within(t, SPACE_USERS)) return null;
    return (map && map[key]) || null;
  }

  // Sends recorder pieces in order. Muting drops anything not yet sent, so nothing recorded before
  // the mute trickles out afterwards. Ending class flushes instead: every piece already recorded is sent.
  class MicSender {
    constructor(send) { this.send = send; this.gen = 0; this.on = false; this.closing = false; this.first = true; this.chain = Promise.resolve(); this.sent = 0; this.dropped = 0; }
    start() { this.gen++; this.on = true; this.closing = false; this.first = true; }
    push(piece) {
      if (!this.on && !this.closing) { this.dropped++; return false; }
      const g = this.gen, first = this.first; this.first = false;
      this.chain = this.chain.then(async () => {
        if (g !== this.gen) { this.dropped++; return; }
        try { await this.send(piece, first); this.sent++; } catch {}
      });
      return true;
    }
    // flush=false: mute now and drop queued pieces. flush=true: accept the recorder's last piece, send all.
    stop({ flush = false } = {}) { this.on = false; if (flush) this.closing = true; else this.gen++; return this.chain; }
    closed() { this.closing = false; return this.chain; }
  }

  root.LostKeys = { shortcutFor, MicSender, EDITABLE, SPACE_USERS };
})(typeof window !== "undefined" ? window : globalThis);
