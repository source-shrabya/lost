-- Lost: first schema. Times are ISO strings (UTC) unless the column says seconds into class.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('professor', 'student')),
  password_hash TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  onboarded INTEGER NOT NULL DEFAULT 0,
  institution_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canvas_host TEXT NOT NULL,
  verified_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- How a user reaches Canvas. mode: oauth (real, per-user token), demo (sample data, labelled
-- everywhere), devtoken (the developer's own token from CANVAS_DEV_TOKEN, for testing only).
CREATE TABLE canvas_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  mode TEXT NOT NULL CHECK (mode IN ('oauth', 'demo', 'devtoken')),
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  expires_at TEXT,
  canvas_user_id TEXT,
  canvas_user_name TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, institution_id)
);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id TEXT REFERENCES institutions(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('canvas', 'demo', 'manual')),
  canvas_course_id TEXT,
  canvas_url TEXT,
  office_hours_url TEXT NOT NULL DEFAULT '',
  tutoring_url TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, source, canvas_course_id)
);

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  canvas_section_id TEXT,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (course_id, canvas_section_id)
);

CREATE TABLE enrollments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('code', 'canvas', 'demo')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, section_id)
);

-- Canvas roster entries seen during a professor's sync, so a student who links Canvas later
-- lands in the right section. Holds only Canvas ids and login ids.
CREATE TABLE canvas_roster (
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  canvas_user_id TEXT NOT NULL,
  login_id TEXT,
  PRIMARY KEY (section_id, canvas_user_id)
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('canvas', 'demo', 'upload', 'notes')),
  external_type TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT '',
  -- students: students may see it and it may be quoted to them. staff: professor only.
  visibility TEXT NOT NULL CHECK (visibility IN ('students', 'staff')),
  visibility_reason TEXT NOT NULL DEFAULT '',
  use_in_class INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'no_text', 'unsupported', 'error', 'removed')),
  warning TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT NOT NULL DEFAULT '',
  synced_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (course_id, source, external_type, external_id)
);

CREATE TABLE passages (
  id INTEGER PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  staff_only INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL
);
CREATE INDEX passages_material ON passages(material_id);
CREATE VIRTUAL TABLE passages_fts USING fts5(text, content='passages', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER passages_ai AFTER INSERT ON passages BEGIN
  INSERT INTO passages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER passages_ad AFTER DELETE ON passages BEGIN
  INSERT INTO passages_fts(passages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE lecture_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('ready', 'live', 'ending', 'ended')),
  material_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
-- One open session per section, so Start twice resumes instead of duplicating.
CREATE UNIQUE INDEX one_open_session ON lecture_sessions(section_id) WHERE status IN ('ready', 'live', 'ending');

CREATE TABLE transcript_lines (
  session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  t REAL NOT NULL,
  text TEXT NOT NULL,
  original TEXT,
  edited_at TEXT,
  unsure TEXT,
  origin TEXT NOT NULL DEFAULT 'speech' CHECK (origin IN ('speech', 'typed', 'sample')),
  PRIMARY KEY (session_id, idx)
);

CREATE TABLE transcript_gaps (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  from_t REAL NOT NULL,
  to_t REAL,
  reason TEXT NOT NULL
);

CREATE TABLE confusion_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  line_idx INTEGER,
  context_from INTEGER,
  context_to INTEGER,
  anchor TEXT CHECK (anchor IN ('current', 'phrase', 'earlier', 'question')),
  anchor_line INTEGER,
  category TEXT CHECK (category IN ('term', 'reasoning', 'connection', 'missed')),
  question TEXT,
  self_status TEXT NOT NULL DEFAULT 'open' CHECK (self_status IN ('open', 'resolved', 'still')),
  resolved_at TEXT,
  topic TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX events_session ON confusion_events(session_id);
CREATE INDEX events_student ON confusion_events(student_id);

CREATE TABLE help_responses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES confusion_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('explain', 'retry', 'prereq', 'catchup')),
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'failed', 'no_ai')),
  payload TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, kind, attempt)
);

CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES confusion_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('diagnostic', 'comprehension', 'review')),
  question TEXT NOT NULL,
  choices TEXT NOT NULL,
  correct_idx INTEGER NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  prerequisite TEXT NOT NULL DEFAULT '',
  chosen_idx INTEGER,
  correct INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, ref_id)
);

CREATE TABLE session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'transcript_only')),
  payload TEXT,
  error TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, kind, ref_id)
);

-- Professor's own working notes after class: drafts are never sent anywhere by Lost.
CREATE TABLE prof_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  moment_idx INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('revisit', 'clarification', 'suggestion')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE office_hours_questions (
  event_id TEXT PRIMARY KEY REFERENCES confusion_events(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
