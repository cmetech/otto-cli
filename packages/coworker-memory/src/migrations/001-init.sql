-- packages/coworker-memory/src/migrations/001-init.sql
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drawers (
  id TEXT PRIMARY KEY,
  wing TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turn','paste','file_load','ticket','email','rca','note')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT REFERENCES drawers(id) ON DELETE SET NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drawers_wing_room ON drawers (wing, room);
CREATE INDEX IF NOT EXISTS idx_drawers_kind ON drawers (kind);
CREATE INDEX IF NOT EXISTS idx_drawers_created_at ON drawers (created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS drawers_fts USING fts5 (
  content,
  content='drawers',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS drawers_ai AFTER INSERT ON drawers BEGIN
  INSERT INTO drawers_fts (rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS drawers_ad AFTER DELETE ON drawers BEGIN
  INSERT INTO drawers_fts (drawers_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS drawers_au AFTER UPDATE ON drawers BEGIN
  INSERT INTO drawers_fts (drawers_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO drawers_fts (rowid, content) VALUES (new.rowid, new.content);
END;
