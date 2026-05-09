# 07 — Further exploration: where to go from here

The first six docs describe what we built and what we learned from
it. This one looks outward: directions to push the project, parallel
systems worth studying, and concrete experiments that would teach
something new without rebuilding from scratch.

Five directions, each with: **why it matters**, **what changes from
the current architecture**, **concrete next steps**, and **resources**
worth a half-day of reading.

---

## Direction A — Scale up (volume, users, geography)

### Why
At personal volume the bot is invisible to its hosting. The
interesting questions only appear when traffic grows: rate limits,
multi-tenancy, replication lag, cold-start tax, batching economics.

### What changes
- **Reads dominate**: a query UI or LLM agent over the archive will
  generate orders of magnitude more reads than writes. Add a read
  replica (`turso db replicate lizard <region>`) per active region.
- **Profile lookups become wasteful**: each ingestion currently calls
  LINE's `/profile` API. At scale, cache in **Cloudflare KV** or
  **Workers Cache API** (TTL 1–24 h). The bot's own user ID can be
  fetched once via `/v2/bot/info` and stored as an env var.
- **Replies become a separate concern**: `ctx.waitUntil(replyMessage)`
  works at low volume; under bursty load, push reply tasks into
  **Cloudflare Queues** for backoff + retry isolation.
- **Multi-tenant** if multiple users share the bot: change
  `webhook_event_id UNIQUE` to `(channel_id, webhook_event_id) UNIQUE`,
  add a `channel_id` column on every row.

### Concrete next steps
1. Add a KV namespace for `display_name_cache:{userId} → name` with 24 h TTL. Measure cache hit rate after a week.
2. Move the reply call out of the request path into a Queue. Compare p99 latency before/after with Workers Analytics.
3. Document the read/write ratio in `turso db inspect` — when reads are >10× writes, replicate.

### Resources
- Cloudflare's "Workers and Durable Objects: Coordination at the Edge" talk (their keynote on coordination patterns)
- Turso's docs on read replicas and embedded replicas
- Designing Data-Intensive Applications, Kleppmann — chapters on replication and stream processing

---

## Direction B — Security & hardening

### Why
The bot currently writes to your DB on receipt of any signed event.
That's appropriate for personal use, but the moment the URL is shared
or the bot enters a bigger surface area, the threat model changes.

### What changes
- **Allowlist `source_user_id`**: even if someone befriends the bot,
  only your own messages get ingested.
  ```ts
  const ALLOWED = new Set(env.ALLOWED_USER_IDS.split(","));
  if (msg.source.userId && !ALLOWED.has(msg.source.userId)) continue;
  ```
- **Replay window**: HMAC verification proves authenticity but not
  freshness. Add a `event.timestamp > now - 5min` check, plus the
  existing `webhook_event_id UNIQUE` to prevent old captures from
  being replayed.
- **Token rotation cadence**: Turso tokens are long-lived JWTs. Build
  a monthly rotation job (`turso db tokens create lizard --revoke`
  rolls the old one). Same for LINE's channel access token.
- **Don't log full payloads**: `console.error("insert failed", err)`
  is fine, but avoid `console.log(JSON.stringify(event))` in
  production — logs persist longer than DB rows in some setups.
- **Right to erasure (GDPR-style)**: even for a personal bot, build a
  `inbox.py forget --user U…` and `--message-id …` early. Easier
  before there are 100 k rows than after.
- **Webhook secret separate from access token**: already true
  (`LINE_CHANNEL_SECRET` ≠ `LINE_CHANNEL_ACCESS_TOKEN`); never reuse
  one for the other.

### Concrete next steps
1. Add an `ALLOWED_USER_IDS` env var (comma-separated). Default to your own userId.
2. Implement timestamp freshness check.
3. Write a `scripts/rotate-secrets.sh` and run it once to validate the path.

### Resources
- OWASP API Security Top 10 (current edition)
- Cloudflare Workers Secrets vs Environment Variables documentation — when to use which
- "How to safely store webhook secrets" — Stripe's engineering blog has the canonical writeup

---

## Direction C — Similar projects (lateral application)

### Why
The architecture pattern — *signed webhook → idempotent ingest →
typed-plus-blob storage → read-side query tools* — generalizes to
many "personal pipeline" use cases. Building a second one teaches
which choices were LINE-specific vs structural.

### What transfers, what doesn't
| You want | Reuses | New territory |
|---|---|---|
| **Telegram archiver bot** | Schema, raw_payload, idempotency | Different webhook auth (no HMAC; use secret_token query param), different mention syntax |
| **Slack save-to-archive** | Same shape | Slack uses signed-secrets headers + slash commands; events arrive via `chat.message.im` event type |
| **Email-to-DB** (forward emails to a personal inbox) | DB schema for a "messages" table | Cloudflare Email Routing → Worker; no replies; MIME parsing is the new hard part |
| **Discord personal log bot** | Same shape | Webhook signing model; Gateway WS connection if real-time presence needed |
| **GitHub event archiver** (issues, PRs you star) | Same shape | OAuth flow for token; webhook signature uses HMAC-SHA256 like LINE |
| **RSS-to-DB personal reader** | Schema + raw_payload | No webhook — cron-driven Worker; XML parsing |

### Concrete next steps
- Pick one. Implement it copying the same architecture verbatim.
  Notice every place where you have to think "wait, does this still
  apply?" — those are the places where the LINE-specific assumptions
  hid.
- The fastest win is probably a **Telegram clone**: same conceptual
  flow, ~80% code reuse, different upstream — exposes which
  abstractions are protocol-agnostic.

### Resources
- Telegram Bot API docs (specifically: webhook with secret token)
- Slack Events API + Bolt for JavaScript
- Cloudflare Email Routing announcement post

---

## Direction D — Real-world parallels (systems with the same shape)

### Why
Production systems built around webhook ingestion have hit the
operational walls we haven't hit yet. Reading their post-mortems and
architecture posts is a shortcut to avoiding their mistakes.

### Systems worth studying

- **Sentry's ingest pipeline** — high-volume signed event ingestion with deduplication; their "How we built our ingestion pipeline" series covers idempotency patterns.
- **Stripe webhook delivery** — the canonical reference for at-least-once delivery, signature verification (`Stripe-Signature`), and replay protection. Their docs section "Best practices for using webhooks" reads like a checklist for our P1–P5.
- **GitHub Actions runner ingest** — handles fan-out from GitHub events to many subscriber repositories; instructive on how to scale from "one webhook handler" to "router + N consumers."
- **Plausible Analytics / Umami** — both are open-source, single-table-with-blob analytics ingestion. Their schema migration histories show how the wildcard column saved them.
- **Linear's sync agent** — bidirectional sync across third-party integrations; instructive on conflict resolution when ingestion isn't append-only.

### What to look for when reading their architecture
1. How do they shape the `events` table? (Almost always: structured + JSON blob.)
2. What's their idempotency key? (Almost always: provider event id + producer scope.)
3. Do they validate at the boundary or throughout? (Always boundary.)
4. How do they handle backpressure? (Queue + visibility timeout.)
5. What's their replay tool? (Almost always: re-run insert from raw blob.)

You'll see the principles in [06](06-distilled-principles.md) appear
in every one of these systems.

---

## Direction E — Learning experiments (concrete builds)

A ladder of small projects that each teach one new thing without
demanding a full rewrite. In rough order of effort:

### E1 — Daily digest email (1 evening)
A scheduled Worker (`cron` trigger) queries last 24 h of messages,
formats a markdown summary, sends via Resend / Cloudflare Email
Routing. **Learns:** scheduled triggers, outbound email from
Workers, formatting messages for human consumption.

### E2 — LLM classification (1 weekend)
Add an `llm_tags TEXT` column. On ingest, call Claude via the
Anthropic SDK to classify the message into 3-5 tags (research /
todo / link / personal / etc.). Store the result. **Learns:**
edge LLM calls, prompt design for classification, how raw_payload
+ derived columns coexist.

### E3 — Search UI (1 weekend)
Cloudflare Pages site that calls a new Worker endpoint
(`GET /search?q=…&token=…`) backed by SQLite FTS5 over the
`text` column. Token-gate so only you can see your archive.
**Learns:** SQLite FTS, Cloudflare Pages deployment, simple
auth-via-shared-secret.

### E4 — Multi-channel ingestion (1 week)
Add Telegram alongside LINE. Same `messages` table, new
`channel_type` column. Two webhook endpoints, one shared insert
path. **Learns:** multi-tenancy lite, where the LINE-specific
assumptions actually live.

### E5 — Query agent (1 week)
A small CLI or Slack bot where you ask "what did I save about
$TOPIC last month?" and an LLM with tool-use translates to SQL
against the archive. **Learns:** tool-use patterns, prompt-driven
SQL generation safety, when to constrain the agent vs let it
reason.

### E6 — Vector search (when E2 is done)
Replace LIKE-search with semantic search. Turso has native vector
support; embed each message at ingest, store in a separate column,
query with cosine similarity. **Learns:** embeddings as a query
substrate, when keyword still wins, hybrid search.

---

## Where to start, given your goals

| If you want to… | Start with |
|---|---|
| Make it more useful day-to-day | E1 (daily digest), then E3 (search UI) |
| Learn distributed-systems thinking | A (scale) + reading list under D |
| Understand the security side of webhooks | B + Stripe's webhook docs |
| Build a portfolio piece | E2 → E5 chain — each is demonstrable |
| Apply this elsewhere | C (pick a Telegram clone, copy the architecture) |

The unifying thread: every direction here is a way to **deepen**
familiarity with the patterns in [06](06-distilled-principles.md)
rather than learn entirely new ones. The principles are
load-bearing; everything else is the chance to see them again in a
new light.
