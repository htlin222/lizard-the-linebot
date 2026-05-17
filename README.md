# lizard-the-linebot

A personal LINE bot that captures every message you forward to it and writes
the metadata (sender, timestamp, type, content) to a [Turso](https://turso.tech)
(libSQL) database. Runs on Cloudflare Workers — free tier is plenty for
personal volume.

> 📓 **Project notebook:** see [`docs/`](docs/00-overview.md) for IMRaD-styled
> notes on the protocol quirks, schema choices, runtime tradeoffs, the
> quote-reply investigation, and the portable-skill design.

> **Note on forwarded messages:** LINE does *not* preserve the original
> sender when a user forwards a message. The bot only sees that *you* sent
> it; `source_user_id` is always the forwarder. Original sender info, if
> any, only survives as inline text the user typed.

---

## How it works

```
┌─────────┐   forward   ┌──────────────┐   webhook   ┌────────────────────┐
│  LINE   ├────────────▶│ LINE Platform├────────────▶│ Cloudflare Worker  │
│ on phone│             │              │   (POST)    │  (lizard-the-      │
└─────────┘             └──────────────┘             │   linebot)         │
      ▲                        │                     │                    │
      │  "蜥蜴已收到🦎"             │                     │ 1. verify HMAC     │
      │  (only when            │                     │ 2. resolve display │
      │   @-mentioned          │                     │    name (LINE API) │
      │   in a group)          │  reply API          │ 3. INSERT row      │
      └────────────────────────┤◀────────────────────┤ 4. ack iff mention │
                                                     └─────────┬──────────┘
                                                               │
                                                               ▼
                                                     ┌────────────────────┐
                                                     │ Turso DB (libSQL)  │
                                                     │  table: messages   │
                                                     └────────────────────┘
```

For each `POST /webhook`:

1. Read the raw body and `x-line-signature` header.
2. Compute `base64(HMAC-SHA256(channel_secret, raw_body))`. Reject `401` if it doesn't match.
3. For each `message` event in the payload:
   - Map the event to a row (text/sticker/file/location have type-specific columns; everything is also dumped into `raw_payload` as JSON).
   - Call `GET /v2/bot/profile/{userId}` to resolve the sender's display name.
   - `INSERT … ON CONFLICT(webhook_event_id) DO NOTHING` — idempotent against LINE redeliveries.
   - If the bot was @-mentioned (group/room only), send "蜥蜴已收到🦎" via `POST /v2/bot/message/reply` (after the 200, via `ctx.waitUntil`).
4. Return `200 ok`.

Unknown event types (follow, unfollow, postback, etc.) are silently skipped.

### What gets saved & when does it reply

Every message that hits the webhook is saved to the DB (full archive).
The reply (`蜥蜴已收到🦎`) is gated separately — only fires when the bot is explicitly @-mentioned in a group/room. DMs stay silent too, so the bot never speaks unless directly summoned.

| Where | Saved? | Reply? |
|---|---|---|
| 1:1 DM | ✅ | ❌ silent |
| Group / room, any message | ✅ | ❌ silent |
| Group / room, @lizard mentioned | ✅ | ✅ |
| Group / room, `@all` | ✅ | ❌ silent (intentional — no group-ping spam) |

The reply gate is `shouldReply()` at the bottom of `src/index.ts` — checks `event.message.mention.mentionees[].isSelf`.

To receive group events at all, **Allow bot to join group chats** must be **Enabled** in the LINE Console → Messaging API tab.

### Quote-reply (replying to a previous message)

When someone replies to message X and your message ends up in our archive, LINE includes `quotedMessageId: X.message_id` in the payload. We store it in `quoted_message_id`, and if X is also in our archive (it usually is now, since groups save everything) you can JOIN them. The skill exposes this via:

```bash
python3 .claude/skills/line-inbox/scripts/inbox.py mentions
```

— @-mention rows with the quoted original LEFT-JOINed in. Originals from before the full-archive era show up as NULL `reply_to_*` columns and are unrecoverable (LINE has no public API to fetch arbitrary historical text).

---

## What's deployed

| Thing | Where |
|---|---|
| Worker | `https://lizard-the-linebot.hsieh-ting-lin.workers.dev` |
| Webhook endpoint | `POST /webhook` |
| Health check | `GET /` → `lizard is alive` |
| Turso DB | `lizard` (region `aws-ap-northeast-1`, Tokyo) |
| LINE channel | `lizard-inbox` (`@927pjtfa`, channel ID `2010025852`) |
| Cloudflare secrets | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` |

Local secrets live in `.env` and `.dev.vars` (both gitignored).

---

## Daily use

Forward any message to `lizard-inbox` from your LINE app. The bot stays silent (DMs no longer auto-ack) but the row lands in Turso within ~2s. To inspect what landed:

```bash
# Last 20
turso db shell lizard "SELECT id, message_type, substr(text,1,80) AS preview, datetime(line_timestamp_ms/1000,'unixepoch','+8 hours') AS at_tw FROM messages ORDER BY id DESC LIMIT 20;"

# Count by type
turso db shell lizard "SELECT message_type, COUNT(*) AS n FROM messages GROUP BY message_type ORDER BY n DESC;"

# Today (Taiwan time)
turso db shell lizard "SELECT message_type, text FROM messages WHERE date(line_timestamp_ms/1000,'unixepoch','+8 hours') = date('now','+8 hours');"

# Free-text search
turso db shell lizard "SELECT id, datetime(line_timestamp_ms/1000,'unixepoch','+8 hours') AS at, text FROM messages WHERE text LIKE '%KEYWORD%' ORDER BY id DESC;"
```

---

## Debugging

**Live tail of worker logs:**

```bash
pnpm dlx wrangler tail
```

This streams every request hitting the worker — including LINE's webhook
calls — with status codes, exceptions, and your `console.log`/`console.error`
output. Leave it running while you forward a test message.

**Cloudflare dashboard:** <https://dash.cloudflare.com/> → Workers → `lizard-the-linebot` → **Observability** has a request log and metrics for the last 24h.

**Common failure modes:**

| Symptom | Likely cause | Fix |
|---|---|---|
| LINE shows "Webhook URL verification failed" | Worker not reachable, or returning non-2xx for empty `events` payload | `pnpm dlx wrangler tail` while clicking Verify; should see `200 ok`. If 401, the channel secret in CF doesn't match LINE. |
| Forwarded message lands no row in DB | `Use webhook` toggle off, or `Auto-response` was re-enabled and is consuming the event | Re-check toggles in LINE Console → Messaging API. Tail logs to confirm whether request hits us at all. (No DM auto-ack anymore — confirm via DB row, not a reply.) |
| Row lands in DB but @-mention reply doesn't fire in group | Turso write succeeded but reply API call failed — or the message wasn't actually an @-mention | `wrangler tail` → look for `reply failed`. Verify the payload had `mention.mentionees[].isSelf === true`. |
| `✗ invalid signature` (401) on a request you signed yourself | Body bytes differ between sign and send (extra newline, encoding) | Use `printf '%s'` not `echo`; sign the *raw* bytes. |

**Rotate a secret** (LINE channel secret got leaked, etc.):

```bash
# 1. Reissue in source of truth
#    LINE: Console → Basic settings → Channel secret → Issue
#    Turso: turso db tokens create lizard --revoke   # invalidates old, prints new
# 2. Update .env locally
# 3. Push to Cloudflare:
printf '%s' "NEW_VALUE" | pnpm dlx wrangler secret put LINE_CHANNEL_SECRET
```

---

## Tweaking

### Change the ack reply

`src/index.ts` — search for `"蜥蜴已收到🦎"`. Whatever string you put there is sent back to LINE. Limit ~2000 chars.

### Capture additional fields

`src/types.ts` adds the type, `src/extract.ts` reads it into a column, `src/db.ts`'s `INSERT_SQL` writes it. Add the column with a new migration in `schema/`:

```sql
-- schema/002_add_xxx.sql
ALTER TABLE messages ADD COLUMN xxx TEXT;
```

Apply with `turso db shell lizard < schema/002_add_xxx.sql`. The
`raw_payload` column already has the full event JSON, so historical rows can
be backfilled with a `UPDATE … SET xxx = json_extract(raw_payload, '$.…')` pass.

### Download media bytes

LINE keeps content available for ~7 days at `GET /v2/bot/message/{messageId}/content`. To archive:

1. Add a column for the storage key (R2 path or a BLOB).
2. In `src/index.ts`, after the INSERT, if `message_type ∈ {image, video, audio, file}`, fetch the content and either store as `BLOB` (Turso) or PUT to R2 with the message ID as key.
3. Don't block the webhook reply — wrap the download in `ctx.waitUntil(...)`.

### Change worker region / move closer to user

Workers run on every Cloudflare edge — there's nothing to change. The Turso DB region is the latency floor; if you move countries, recreate with `turso db create lizard2 --location <new>` and migrate.

### Allowlist your own userId only

Right now anyone who friends `lizard-inbox` can write to your DB (low risk: the bot URL isn't public, but still). Add at the top of the `for (const event…)` loop in `src/index.ts`:

```ts
const ALLOWED = new Set(["U_your_user_id_here"]);
if (msg.source.userId && !ALLOWED.has(msg.source.userId)) continue;
```

Get your userId from any row that already landed: `SELECT DISTINCT source_user_id FROM messages;`.

---

## Redeploy

```bash
pnpm dlx wrangler deploy
```

That's it. The worker uploads (~2s), Cloudflare flips traffic atomically, no downtime. To roll back:

```bash
pnpm dlx wrangler deployments list           # find the previous version ID
pnpm dlx wrangler rollback <version-id>
```

---

## Local development

```bash
pnpm install
cp .env.example .env                 # then fill in the 4 values
cp .env .dev.vars                    # wrangler reads .dev.vars locally
pnpm dev                             # http://localhost:8787
```

Send a signed test request:

```bash
SECRET=$(grep '^LINE_CHANNEL_SECRET=' .env | cut -d= -f2-)
BODY='{"destination":"U0","events":[]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
curl -i -X POST http://localhost:8787/webhook \
  -H "x-line-signature: $SIG" \
  -H 'content-type: application/json' \
  -d "$BODY"
# expect: HTTP/1.1 200 OK
```

Note that local dev hits the *real* Turso DB. To use a separate dev DB, create one (`turso db create lizard-dev`) and override `TURSO_DATABASE_URL` in `.dev.vars`.

---

## Project layout

```
src/index.ts        fetch handler + routing
src/line.ts         HMAC verify, profile lookup, reply
src/db.ts           Turso client + INSERT
src/extract.ts      LINE event → DB row
src/types.ts        minimal LINE webhook types
schema/             SQL migrations (apply with turso db shell <db> < file)
wrangler.toml       Worker config (no secrets)
.env / .dev.vars    local secrets (gitignored)
```

---

## Costs (as of writing)

- **Cloudflare Workers free**: 100k requests/day. A personal forwarder is nowhere close.
- **Turso free**: 9 GB storage, 1B row reads / 25M writes per month. Same — comfortable.
- **LINE Messaging API free tier**: 200 *push* messages/month. Replies (which is what we use) don't count against this. So free.
