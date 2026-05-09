# 01 — LINE webhook protocol & quirks

## Introduction

LINE's Messaging API webhook delivers events the moment a user
interacts with our Official Account, but the spec hides a few details
that surprise you on first contact. This note records the exact
behaviors we depended on, and the things LINE *won't* give us no matter
how hard we ask.

## Methods

We treated the docs as a starting point and verified each protocol
detail against live traffic.

- **Signature:** signed our own test payloads with `openssl dgst -sha256 -hmac` and compared bytes to our Web Crypto implementation in `src/line.ts::verifySignature`.
- **Source/source.type:** observed the difference between DM and group/room events by sending one of each and inspecting `raw_payload`.
- **Mention shape:** triggered an `@lizard` mention in a group and read `message.mention.mentionees` from the stored row.
- **Quote-reply:** replied to a previous message with an `@lizard` mention and inspected `message.quotedMessageId`.

## Results

- **Signature** = `base64( HMAC-SHA256(channel_secret, raw_request_body) )`. Header is `x-line-signature`. Our impl matched openssl byte-for-byte on a `'{"events":[]}'` payload.
- **Source object** has `type ∈ {user, group, room}` plus the corresponding ID (`userId`, `groupId`, `roomId`). On a DM `type=user` and `userId` is the sender. In a group `type=group`, `groupId` identifies the group, and `userId` identifies *the speaker*, never the bot.
- **Mention** lives only on text messages: `message.mention.mentionees: [{ index, length, type: "user"|"all", userId, isSelf }]`. We gate replies on `isSelf === true`.
- **Quote-reply**: when a user long-presses a message and chooses "reply", the resulting event carries `message.quotedMessageId` — the LINE message id of the quoted source.
- **Channel access token** issued via the Console is **long-lived**; we treat it like a static secret.

## Discussion

LINE's protocol is sender-centric: every event tells you *who pressed
send* and *into which conversation*, but never *what message they're
forwarding the contents of*. Two consequences worth keeping in mind:

1. **Forwards lose attribution.** When a user forwards a message in
   LINE, the bot receives a fresh message authored by the forwarder.
   The original sender is not preserved anywhere in the event.
   `source_user_id` is *always* the forwarder.
2. **Historical text is unrecoverable.** LINE exposes
   `GET /v2/bot/message/{id}/content` for *binary* content (images,
   videos, files, audio) for ~7 days, but there is no equivalent for
   text. If a text message wasn't delivered to your webhook the
   moment it was sent, you can't read it later.

These two facts are why the archive is structured the way it is: trust
nothing about a message except what was on the wire when it arrived,
and store the full event body so you can backfill any future column
without revisiting LINE.

The Console-side surprise: as of 2023, Messaging API channels are
created indirectly through the LINE Official Account Manager (create
an OA → enable Messaging API). The dev console no longer lets you
create one in a single click. Two settings then need to be flipped in
the OA Manager: **Auto-response → off** and **Greeting message → off**,
otherwise LINE's built-in autoreply consumes events before our webhook
sees them.
