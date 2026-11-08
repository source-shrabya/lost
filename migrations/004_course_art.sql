-- A course's header drawing (one of the line-art themes in public/theme.js); '' = picked from the course name.
ALTER TABLE courses ADD COLUMN art TEXT NOT NULL DEFAULT '';
