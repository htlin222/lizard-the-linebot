import type { MessageEvent, MessageRow } from "./types";

export function extractRow(event: MessageEvent): MessageRow {
  const m = event.message;
  const s = event.source;

  const row: MessageRow = {
    webhook_event_id: event.webhookEventId,
    message_id: m.id,
    message_type: m.type,
    source_type: s.type,
    source_user_id: s.userId ?? null,
    source_group_id: s.groupId ?? null,
    source_room_id: s.roomId ?? null,
    user_display_name: null,
    text: null,
    sticker_package_id: null,
    sticker_id: null,
    file_name: null,
    file_size: null,
    location_title: null,
    location_address: null,
    location_latitude: null,
    location_longitude: null,
    raw_payload: JSON.stringify(event),
    line_timestamp_ms: event.timestamp,
    received_at_ms: Date.now(),
  };

  switch (m.type) {
    case "text":
      row.text = m.text;
      break;
    case "sticker":
      row.sticker_package_id = m.packageId;
      row.sticker_id = m.stickerId;
      break;
    case "file":
      row.file_name = m.fileName;
      row.file_size = m.fileSize;
      break;
    case "location":
      row.location_title = m.title ?? null;
      row.location_address = m.address ?? null;
      row.location_latitude = m.latitude;
      row.location_longitude = m.longitude;
      break;
  }

  return row;
}
