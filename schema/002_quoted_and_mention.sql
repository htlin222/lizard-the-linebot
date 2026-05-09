-- Quote-reply support: link a mention to the message it replied to,
-- and explicitly tag rows where the bot itself was @-mentioned so the
-- "thread view" query stays index-friendly.

ALTER TABLE messages ADD COLUMN quoted_message_id TEXT;
ALTER TABLE messages ADD COLUMN is_self_mention   INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows from raw_payload.
UPDATE messages
SET quoted_message_id = json_extract(raw_payload, '$.message.quotedMessageId')
WHERE json_extract(raw_payload, '$.message.quotedMessageId') IS NOT NULL;

UPDATE messages
SET is_self_mention = 1
WHERE EXISTS (
  SELECT 1
  FROM json_each(json_extract(raw_payload, '$.message.mention.mentionees'))
  WHERE json_extract(value, '$.isSelf') = 1
);

CREATE INDEX IF NOT EXISTS idx_messages_quoted ON messages (quoted_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_self_mention ON messages (is_self_mention, line_timestamp_ms DESC);
