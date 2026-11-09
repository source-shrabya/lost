-- "Save for later": the student keeps listening and comes back to this moment after class.
-- A flag, not a new self_status, because SQLite can't change a CHECK and rebuilding
-- confusion_events would cascade-delete its help. The moment stays unresolved.
ALTER TABLE confusion_events ADD COLUMN saved_later INTEGER NOT NULL DEFAULT 0;
