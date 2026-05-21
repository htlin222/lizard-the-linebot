-- Binary-content archival: store the R2 object key for image/video/audio/file
-- messages. LINE retains content for ~7 days, so the worker downloads bytes
-- to R2 in ctx.waitUntil() right after the INSERT.

ALTER TABLE messages ADD COLUMN r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_r2
  ON messages (r2_key)
  WHERE r2_key IS NOT NULL;
