# 04 — Quote-reply investigation

## Introduction

A real user question drove a meaningful design change here: *"if I
reply to someone in the group and then @-mention the bot, why can't I
see the original message?"*

The honest answer turned out to require both a protocol investigation
and a behavior change.

## Methods

We had a freshly-archived row (id=14) that fit the pattern:

```
group  @林協霆(Dr. 蜥蜴)  一個星期後換頭貼   ← user's @-mention reply
```

Three things to check:

1. **Does the event payload contain a pointer to the quoted
   original?** Inspected `raw_payload` via
   `json_extract(raw_payload, '$.message.quotedMessageId')`.
2. **Is the original in our DB?** Joined `messages.message_id`
   against the extracted id.
3. **Can we fetch the original from LINE if it's missing?** Surveyed
   the Messaging API reference for any "get message by id" text-content
   endpoint.

## Results

1. **Yes** — `quotedMessageId = "613219593586213456"` was present in
   `raw_payload`. LINE does propagate the link.
2. **No** — querying for `message_id = '613219593586213456'` returned
   zero rows. The original had never been ingested.
3. **No public API exists** for fetching arbitrary historical text
   from LINE. The only message-content endpoint is
   `GET /v2/bot/message/{messageId}/content`, which serves binary
   payloads (images, videos, files, audio) for ~7 days. Text is
   write-once, read-only-at-time-of-delivery.

The original's invisibility was a direct consequence of the prior
ingestion rule: groups only saved messages that `@`-mentioned the
bot. Any non-mention message — including ones that someone might
later quote-reply to — was dropped at the gate.

## Discussion

Once "the original is unrecoverable from LINE" was confirmed, the
design space narrowed:

- **Don't change anything** — accept that quote-replies in groups are
  partial-context. Rejected: it's the most common pattern the user
  cares about.
- **Save the quoted id only** — store `quotedMessageId` even when the
  original isn't in our DB. Rejected: a row containing only an opaque
  ID with no recoverable text is essentially useless.
- **Save everything in groups** — flip the ingestion rule. Accepted.
  See [commit `41f8366`](https://github.com/htlin222/lizard-the-linebot/commit/41f8366).

To keep the chat itself quiet, *reply* gating was decoupled from
*ingestion* gating: every message is saved, but the
`蜥蜴已收到🦎` reply only fires for explicit `@`-mentions in a group/room
— DMs are silent too (`shouldReply()` in `src/index.ts`).

A new column pair (`quoted_message_id`, `is_self_mention`) was added
plus a skill subcommand `inbox.py mentions` that performs the
LEFT-JOIN on `(quoted_message_id, source_group_id)` so the
"composite" view materializes naturally. Test row #17 demonstrated
the end-to-end path: an `@`-mention reply to a previously-archived
non-mention message rendered both halves of the conversation in one
row.

The historical loss is acknowledged: rows id 11/13/14, captured under
the old rule, will forever show NULL `reply_to_*` columns. There is
no way to recover their originals.
