-- New help kinds: "Show the steps" (steps) and "Still confused" (simpler). SQLite can't change a CHECK,
-- so the table is rebuilt with the same columns and rows.
CREATE TABLE help_responses_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES confusion_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('explain', 'retry', 'steps', 'simpler', 'prereq', 'catchup')),
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'failed', 'no_ai')),
  payload TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, kind, attempt)
);
INSERT INTO help_responses_new SELECT id, event_id, kind, attempt, status, payload, error, created_at FROM help_responses;
DROP TABLE help_responses;
ALTER TABLE help_responses_new RENAME TO help_responses;
