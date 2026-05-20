# 06 — Distilled architectural principles

The first five docs are project-specific. This one strips away the
LINE / Turso / Workers details and keeps only the *transferable*
rules — the patterns I'd reach for again on the next event-driven,
upstream-integrated, single-user-feels-like-prod system.

Each principle has a fixed shape:

- **Claim** — the rule, in one sentence.
- **This project** — the concrete instance that taught it.
- **Generalized** — the form that survives the project.
- **Limits** — when *not* to apply it.

---

## P1 — Capture the wildcard alongside the typed view

**Claim:** when ingesting from an upstream you don't control, store
both the structured columns you query *now* and the raw payload as a
JSON blob. The duplication is cheap; the optionality is priceless.

**This project:** the `messages` table has 23 typed columns plus a
`raw_payload TEXT NOT NULL` containing the full LINE event JSON.
Migration 002 (`quoted_message_id`, `is_self_mention`) backfilled
both columns from `raw_payload` via `json_extract` — no upstream
re-fetch, no historical loss.

**Generalized:** typed-and-indexed for *queries*, JSON blob for
*regrets*. The blob is the time machine: any future column you wish
you'd captured was already captured. Costs ~1–2× row size on disk;
saves the entire "we'll have to re-fetch from the API" conversation.

**Limits:** doesn't apply when the upstream payload contains material
you legally can't store (PII you have to discard, payment data, etc.),
or when payloads are large enough to dominate storage cost (think:
multi-MB media). Then store hashes / pointers instead.

---

## P2 — Use the producer's idempotency key, not your own

**Claim:** every event consumer needs a UNIQUE constraint on a key
the *producer* supplies, plus `ON CONFLICT … DO NOTHING`.

**This project:** `webhook_event_id TEXT NOT NULL UNIQUE` plus a
no-op `ON CONFLICT(webhook_event_id) DO NOTHING` insert. LINE
redelivers events on receiver failure; this turns retries into
cheap no-ops with zero application logic.

**Generalized:** at-least-once delivery is the default semantics of
every webhook / queue / event bus you'll touch. The cheapest
exactly-once equivalent is "let the DB drop dupes." If the producer
gives you an event id, use it. If they don't, derive one
deterministically from `(payload_hash, producer_id, dedup_window)` —
but the producer's id is always cheaper and more correct.

**Limits:** if your insert has business side effects (charge, email,
external API call), the DB-level dedupe alone is not enough — wrap
the side effect in the same transaction, or move it to a separate
"effects" table that joins on the same event id.

---

## P3 — Decouple "this matters" from "we react"

**Claim:** the predicate that decides whether to *record* an event is
almost never the same as the predicate that decides whether to *act*
on it. Name them separately.

**This project:** the function originally called `shouldIngest()`
gated *both* save and reply. When the user said "save everything in
groups but only reply when @-mentioned", the single gate had to
split. Result: `shouldReply()` survives, ingestion is unconditional.

**Generalized:** any system with side effects (notifications, replies,
emails, follow-up jobs) will eventually face "I want to record more
than I want to react to." Build with two predicates from day one;
the second is `() => true` until requirements diverge, but having the
seam in place avoids rewriting the for-loop later.

**Limits:** for purely passive consumers with no outbound side
effects (e.g. log shippers), there's nothing to decouple from. The
single ingest gate is fine. The principle activates the moment a
*reaction* is in the loop.

---

## P4 — Local-explicit beats global-implicit (config precedence)

**Claim:** when a tool has its own config file *and* the user might
have a related env var exported globally, the file wins. Always.

**This project:** the user had `TURSO_DATABASE_URL` exported in their
shell pointing at an unrelated project. Naive `os.environ.get()`-first
lookup silently routed the skill to the wrong DB. Symptom:
`no such table: messages`. Fix: file `.env` first, env vars only as
last resort.

**Generalized:** environment variables are a shared global namespace.
Any tool that reads them shares an attack surface for typos,
collisions, and forgotten exports. A project-local config is *scoped
intent*. Scoped intent should beat ambient state.

The principle of least surprise here is counterintuitive: "I'm using
your project config" is *less* surprising than "I silently used your
global one," even though the global one is what `os.environ` reads
first by default.

**Limits:** for tools meant to be primarily configured by env vars
(`12factor`-style apps, container orchestration), invert this. The
rule applies to *user-facing* tools where a human has both modalities
and would expect their explicit choice to win.

---

## P5 — The provider's API ceiling becomes your design floor

**Claim:** what the upstream provider *can't* tell you defines the
maximum information your system can ever recover. Design assuming
the worst case of the API surface, not the best case.

**This project:** LINE has no API for fetching arbitrary historical
text content. The moment we discovered this, the question "should we
save group messages we don't currently react to?" had only one
defensible answer: yes, because we can't recover them later. The
API constraint *forced* the policy.

**Generalized:** every upstream has read-after-write windows, content
expirations, rate limits, and "we don't expose that" gaps. Find them
*before* designing the policy that depends on them. The cost of
discovering them after launch is migration debt or permanent data
loss.

A useful question to ask early: *"if I lose every event I haven't
already saved, can I recover it from the upstream?"* If the answer
is no, your retention policy is "everything, forever" — anything less
is a bet against future you.

**Limits:** when storage cost would dominate (think: video streams,
sensor firehoses), accept the data loss explicitly and document the
policy. The principle isn't "always save everything" — it's "let the
provider's limits drive the decision, not aesthetic preferences."

---

## P6 — Verify at boundaries; trust inside

**Claim:** put defensive checks at the system boundary (HMAC, schema
validation, auth) and write trusting code internally. Don't validate
twice.

**This project:** `verifySignature()` runs once, at the top of the
webhook handler. Past it, every internal function assumes the payload
is well-formed and the source is authentic. No `if (msg)` re-checks,
no nullable threading. The boundary is the only place defensive code
lives.

**Generalized:** an architectural seam between *outside* and *inside*
should be a sharp line. Outside: assume hostile, validate everything.
Inside: assume well-formed, write declarative code. Mixing the two
modes everywhere creates the worst of both — slow code, inconsistent
guarantees, and "is this checked?" ambiguity.

**Limits:** when you have multiple boundaries (e.g. a worker that
reads from one queue and writes to another), each one is its own
verification site. Internal-only services without their own external
exposure can be more relaxed at their entry, but the principle —
"validate where untrust enters" — still holds.

---

## P7 — Build the observability tool beside the producer

**Claim:** when you ship something that generates events, ship the
tool that lets you watch those events at the same time. Not after.

**This project:** the `inbox.py` skill (latest / search / mentions /
sql) was built within the same week as the worker. The first
end-to-end debug session — verifying group ingestion, seeing
`source_type=group` rows arrive — used the skill, not the Cloudflare
dashboard, not raw `turso db shell`. Built-in observability paid for
itself the first time we were unsure what landed.

**Generalized:** event-driven systems are opaque without the consumer
side of the observability story. Logs tell you "a request happened";
your domain query tells you "what we now believe about the world."
The latter is what you actually need to debug. Build it as a tool,
not as ad-hoc SQL each time.

**Limits:** if the system has truly trivial state (e.g. a stateless
proxy), there's nothing to observe at the domain layer — logs are
sufficient. The principle activates whenever the system *learns*
something from events.

---

## P8 — One source, many mirrors — never two sources

**Claim:** if the same artifact must exist in two places, mirror at
the file-system level (symlink), atomic-deploy level (Cloudflare's
version flip), or package level (npm/PyPI). Never `cp` and "remember
to sync."

**This project:** the `line-inbox` skill is owned by the
`lizard-the-linebot` repo and exposed in a second local repo
(`<home>/<other-repo>`) via an absolute symlink. One edit, both projects pick it up. Cloudflare deploys
flip atomically per version; any rollback is a single command.

**Generalized:** the cost of two sources is not "I have to update
twice" — it's "drift will appear and I won't notice." The maintenance
burden compounds nonlinearly with the number of consumers. The
mitigation is a hierarchy of cheap-to-expensive options:
**symlink → atomic deploy → published package**. Pick the cheapest
one that works for your audience.

**Limits:** for shared libraries with multiple independent consumers
who need version pinning (different teams, different release
cycles), publish a real package. Symlinks are for one-user, one-
machine setups; atomic deploys are for one-service, multi-region
setups; packages are for everything else.

---

## What didn't make the list

A few things I considered and dropped, with the reason:

- **"Use TypeScript"** — too prescriptive, language choice is project-specific.
- **"Pick a free tier"** — economic, not architectural.
- **"Use a single denormalized table"** — already covered by P1; the table shape is a consequence of the wildcard-plus-typed pattern, not a separate principle.
- **"Migrations should be idempotent"** — true, but a special case of P2 (idempotency in general).

The cut suggests the principles above are roughly orthogonal — each
addresses a distinct architectural axis (storage, dedupe, control
flow, config, upstream constraints, trust boundaries, observability,
duplication).

---

## How to apply

When starting a new event-driven integration:

1. **P5 first** — read the provider's API for what you *can't*
   retrieve later. Decide retention before anything else.
2. **P1 next** — design the schema with a `raw_payload` column from
   day one.
3. **P2 in the same PR as P1** — pick the idempotency key now.
4. **P3 emerges** as soon as you have any side effect — split the
   predicates the moment a second one is needed.
5. **P4, P6, P8** are runtime discipline — apply throughout.
6. **P7** is the second deliverable, never the third.

If you remember nothing else from this notebook, remember P1 + P5 +
P7. The other five are amplifiers; those three are the load-bearing
beams.
