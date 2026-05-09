# `messages` table schema

Source of truth: [`schema/001_init.sql`](https://github.com/htlin222/lizard-the-linebot/blob/main/schema/001_init.sql) in lizard-the-linebot.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `webhook_event_id` | TEXT UNIQUE | LINE's per-event ID; idempotency key (redeliveries are dropped) |
| `message_id` | TEXT | LINE message ID. Use to fetch content via `GET /v2/bot/message/{id}/content` (≤7 days) |
| `message_type` | TEXT | one of: `text`, `image`, `video`, `audio`, `file`, `location`, `sticker` |
| `source_type` | TEXT | `user` / `group` / `room` |
| `source_user_id` | TEXT | always the **forwarder** — LINE strips the original sender on forward |
| `source_group_id` | TEXT | non-null only for group chats |
| `source_room_id` | TEXT | non-null only for multi-person rooms |
| `user_display_name` | TEXT | resolved at ingest via LINE profile API; may be NULL if the call failed |
| `text` | TEXT | populated for `text` messages |
| `sticker_package_id` | TEXT | for `sticker` |
| `sticker_id` | TEXT | for `sticker` |
| `file_name` | TEXT | for `file` |
| `file_size` | INTEGER | bytes, for `file` |
| `location_title` | TEXT | for `location` |
| `location_address` | TEXT | for `location` |
| `location_latitude` | REAL | for `location` |
| `location_longitude` | REAL | for `location` |
| `raw_payload` | TEXT | full LINE event JSON — backfill any future column from this |
| `line_timestamp_ms` | INTEGER | LINE's timestamp (UTC, ms since epoch) |
| `received_at_ms` | INTEGER | our ingest time (`Date.now()` in the Worker) |

## Indexes

- `idx_messages_user_time` on `(source_user_id, line_timestamp_ms DESC)`
- `idx_messages_type` on `(message_type)`

## Time handling

All timestamps are UTC ms. Convert to Taipei wall time:

```sql
datetime(line_timestamp_ms/1000, 'unixepoch', '+8 hours')
```

For `WHERE` comparisons against `strftime('%s', ...)` you **must** `CAST(... AS INTEGER)` — SQLite compares INTEGER vs TEXT silently as NULL otherwise.

## What's in `raw_payload`

Each row is the JSON-stringified LINE message event:

```json
{
  "type": "message",
  "webhookEventId": "01KR…",
  "timestamp": 1778337277002,
  "source": { "type": "user", "userId": "U…" },
  "message": { "type": "text", "id": "613…", "text": "test", "quoteToken": "…", "markAsReadToken": "…" },
  "replyToken": "…",
  "deliveryContext": { "isRedelivery": false },
  "mode": "active"
}
```

Useful selectors:

```sql
SELECT json_extract(raw_payload, '$.message.quoteToken') AS qt FROM messages WHERE id = ?;
SELECT json_extract(raw_payload, '$.deliveryContext.isRedelivery') AS dup FROM messages;
```

## Adding columns later

The presence of `raw_payload` means new columns can be added + backfilled without losing history:

```sql
ALTER TABLE messages ADD COLUMN quote_token TEXT;
UPDATE messages SET quote_token = json_extract(raw_payload, '$.message.quoteToken');
```
