# 02 — Schema design with `raw_payload` backup

## Introduction

The DB needs to satisfy two competing pressures: be useful to query
*now* (so columns are typed and indexed), and survive future schema
needs *we haven't thought of yet*. The cheap solution: a denormalized
table plus a JSON dump of every original event.

## Methods

We chose a single `messages` table with type-specific nullable columns
(`text`, `sticker_*`, `file_*`, `location_*`) and one wildcard column,
`raw_payload TEXT NOT NULL`, holding the entire `MessageEvent` JSON as
delivered by LINE. Idempotency uses `webhook_event_id UNIQUE` plus
`ON CONFLICT(webhook_event_id) DO NOTHING`. Time is stored as
`line_timestamp_ms INTEGER` (UTC ms) and `received_at_ms INTEGER`.

Two indexes were created up-front for the queries we already knew we'd
run: `(source_user_id, line_timestamp_ms DESC)` and `(message_type)`.

When `quoted_message_id` and `is_self_mention` became necessary
(see [04](04-quote-reply-investigation.md)), we issued `ALTER TABLE`
plus a `UPDATE … json_extract(raw_payload, '$.…')` backfill in one
migration file (`schema/002_quoted_and_mention.sql`).

## Results

- **Initial schema** (`schema/001_init.sql`): 19 columns, 2 indexes, ~25 kB at 14 rows.
- **Migration 002**: added 2 columns + 2 indexes; backfill recovered all 4 then-existing rows' `quoted_message_id` and `is_self_mention` values from `raw_payload`. No row was lost, no new ingestion was required.
- **Live numbers** at the time of writing: ~17 rows, 25 kB on disk, 257 row reads / 72 row writes lifetime.
- A representative `raw_payload` (text event) is ~700–900 bytes; ratio of "structured columns" to "JSON backup" is roughly 1:1 at this row size.

## Discussion

The bet behind `raw_payload` is that storage is cheap relative to the
cost of "I wish I'd stored that." On a personal-volume archive (Turso
free tier: 9 GB), even pessimistic growth (~1 KB/row × 100 rows/day)
buys decades of headroom. In return, every future column we want is a
zero-cost backfill instead of a "data is gone" conversation.

We considered and rejected:

- **3NF with one table per message type.** Cleaner conceptually,
  worse to query (UNION ALL everywhere), and the JOIN graph would have
  needed re-thinking each time LINE adds a message type.
- **Skipping `raw_payload` and trusting the typed columns.** This
  would have made migration 002 strictly impossible — we couldn't have
  recovered `quoted_message_id` from rows already on disk.
- **A separate `events` audit table** holding the JSON. Nothing to
  gain over an extra column on the same row, and it would split the
  per-row info across two queries.

A SQLite type gotcha worth flagging here: `WHERE int_col >= strftime('%s', ...)`
silently returns NULL because `strftime` returns TEXT and SQLite
refuses the implicit comparison. Always wrap with
`CAST(strftime('%s', …) AS INTEGER)` when comparing against
millisecond/epoch integer columns. We hit this once
([commit `1b3196e`](https://github.com/htlin222/lizard-the-linebot/commit/1b3196e))
and now document it on every time-window query in the skill.
