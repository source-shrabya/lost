-- One optional AI illustration per help card. The prompt stays on the server; students only ever
-- see the caption, alt text and the finished image. The image file lives in <data>/illustrations/<help_id>.jpg.
CREATE TABLE illustrations (
  help_id TEXT PRIMARY KEY REFERENCES help_responses(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  caption TEXT NOT NULL,
  alt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'pending', 'ok', 'failed')),
  mime TEXT,
  error TEXT,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX illustrations_requested ON illustrations(requested_at);
