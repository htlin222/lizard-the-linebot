# Project notebook — overview

Personal LINE-message archiver: forward anything to the bot (a LINE
channel you create, e.g. `lizard-inbox`), and the bot writes it to a
Turso libSQL database for later querying. Lives at
`https://lizard-the-linebot.<your-cf-subdomain>.workers.dev/webhook`
on Cloudflare Workers.

These docs capture **non-obvious lessons** picked up during the build —
things that aren't recoverable from reading the code alone. Each doc
follows an IMRaD-ish shape (Introduction / Methods / Results /
Discussion) so the *why* and *how-we-verified* survive alongside the
*what*.

## Index

| # | Topic | Why read |
|---|---|---|
| [01](01-line-webhook-protocol.md) | LINE webhook protocol & quirks | Signature, mention model, what LINE will and won't tell us |
| [02](02-message-archive-schema.md) | Schema design with raw_payload backup | Cheap insurance for "we'll regret this column later" |
| [03](03-cloudflare-workers-turso.md) | Workers + Turso runtime choices | Why this stack, deployment gotchas, free-tier math |
| [04](04-quote-reply-investigation.md) | Recovering quoted-original messages | An investigation + a behavior change driven by a real user question |
| [05](05-claude-code-skill-portability.md) | Project-local Claude Code skill | Cred precedence, symlink mirror, gitignore strategy |
| [06](06-distilled-principles.md) | **Distilled architectural principles** | Project-agnostic patterns abstracted from 01–05 — read this first if you're starting a new integration |
| [07](07-further-exploration.md) | Further exploration & learning path | Where to go from here — scale, security, similar projects, real-world parallels, experiment ladder |

## Status snapshot

- **Code:** TypeScript on Cloudflare Workers, no framework (~80 LOC entrypoint).
- **DB:** Turso (`lizard`) in `aws-ap-northeast-1`. Single denormalized `messages` table + `raw_payload` column.
- **Behavior:** every message saved (DM + group + room); reply (`蜥蜴已收到🦎`) only fires when the bot is `@`-mentioned in a group (DMs are silent too).
- **Skill:** project-local at `.claude/skills/line-inbox/`, mirrored read-only into another local repo (`<home>/<other-repo>`) via symlink.

## Reading order

If you're maintaining the bot: 01 → 02 → 03.
If you're extending the skill or porting it elsewhere: 05.
If you hit a quote-reply or "where's the original?" question: 04.
