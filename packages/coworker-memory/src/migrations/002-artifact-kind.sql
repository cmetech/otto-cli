-- packages/coworker-memory/src/migrations/002-artifact-kind.sql
-- Adds 'artifact' to the drawers.kind CHECK constraint. SQLite can't ALTER
-- constraints, so the table is rebuilt. Dropping the old table also drops
-- its triggers, so we recreate them. The FTS index is rebuilt from the
-- new drawers table to keep rowid alignment.

BEGIN;

CREATE TABLE drawers_new (
  id TEXT PRIMARY KEY,
  wing TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('turn','paste','file_load','ticket','email','rca','note','artifact')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT REFERENCES drawers_new(id) ON DELETE SET NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT INTO drawers_new (id, wing, room, kind, content, metadata_json, parent_id, redacted, created_at)
SELECT id, wing, room, kind, content, metadata_json, parent_id, redacted, created_at FROM drawers;

DROP TABLE drawers;
ALTER TABLE drawers_new RENAME TO drawers;

-- Recreate indexes (the rename preserves rowids but not separately-named indexes).
CREATE INDEX IF NOT EXISTS idx_drawers_wing_room ON drawers (wing, room);
CREATE INDEX IF NOT EXISTS idx_drawers_kind ON drawers (kind);
CREATE INDEX IF NOT EXISTS idx_drawers_created_at ON drawers (created_at);

-- Recreate triggers (dropped when the old drawers table was dropped).
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

-- Rebuild FTS index so rowids align with the new drawers table.
INSERT INTO drawers_fts (drawers_fts) VALUES ('rebuild');

PRAGMA user_version = 2;

COMMIT;
