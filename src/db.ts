import { connect, type Connection } from "@tursodatabase/serverless";
import type { Env, MessageRow } from "./types";

export function createDb(env: Env): Connection {
  return connect({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
}

const INSERT_SQL = `
INSERT INTO messages (
  webhook_event_id, message_id, message_type,
  source_type, source_user_id, source_group_id, source_room_id,
  user_display_name, text,
  sticker_package_id, sticker_id,
  file_name, file_size,
  location_title, location_address, location_latitude, location_longitude,
  raw_payload, line_timestamp_ms, received_at_ms
) VALUES (?, ?, ?,  ?, ?, ?, ?,  ?, ?,  ?, ?,  ?, ?,  ?, ?, ?, ?,  ?, ?, ?)
ON CONFLICT(webhook_event_id) DO NOTHING
`;

export async function insertMessage(
  db: Connection,
  row: MessageRow,
): Promise<void> {
  await db.execute(INSERT_SQL, [
    row.webhook_event_id,
    row.message_id,
    row.message_type,
    row.source_type,
    row.source_user_id,
    row.source_group_id,
    row.source_room_id,
    row.user_display_name,
    row.text,
    row.sticker_package_id,
    row.sticker_id,
    row.file_name,
    row.file_size,
    row.location_title,
    row.location_address,
    row.location_latitude,
    row.location_longitude,
    row.raw_payload,
    row.line_timestamp_ms,
    row.received_at_ms,
  ]);
}
