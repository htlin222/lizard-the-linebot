CREATE TABLE IF NOT EXISTS messages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_event_id      TEXT    NOT NULL UNIQUE,
  message_id            TEXT    NOT NULL,
  message_type          TEXT    NOT NULL,
  source_type           TEXT    NOT NULL,
  source_user_id        TEXT,
  source_group_id       TEXT,
  source_room_id        TEXT,
  user_display_name     TEXT,
  text                  TEXT,
  sticker_package_id    TEXT,
  sticker_id            TEXT,
  file_name             TEXT,
  file_size             INTEGER,
  location_title        TEXT,
  location_address      TEXT,
  location_latitude     REAL,
  location_longitude    REAL,
  raw_payload           TEXT    NOT NULL,
  line_timestamp_ms     INTEGER NOT NULL,
  received_at_ms        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_user_time
  ON messages (source_user_id, line_timestamp_ms DESC);

CREATE INDEX IF NOT EXISTS idx_messages_type
  ON messages (message_type);
