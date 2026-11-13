PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  raw TEXT NOT NULL,
  english TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL,
  title TEXT NOT NULL,
  handoff TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'vocabulary', 'taste', 'anti_pattern', 'decision')),
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
  term TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'kb', 'docs', 'web')),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_session ON pages(session_id);
CREATE INDEX IF NOT EXISTS idx_profile_kind ON profile_entries(kind);
CREATE INDEX IF NOT EXISTS idx_profile_weight ON profile_entries(weight DESC);
