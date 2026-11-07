-- Words the speech engine was still in the middle of when the student tapped (not yet a line).
ALTER TABLE confusion_events ADD COLUMN interim_text TEXT;
