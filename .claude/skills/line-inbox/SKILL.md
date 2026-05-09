---
name: line-inbox
description: Query the user's personal LINE message archive — every message they forwarded to the lizard-inbox LINE bot is stored in a Turso DB by lizard-the-linebot. Use when the user asks "what did I forward", "search my LINE archive/inbox", "latest line message", "上週 forward 給 lizard 的訊息", "我存到 lizard 的東西", "翻一下我的 LINE 收藏", "what's in my line bot db", or wants to list/search/count/inspect captured LINE messages.
allowed-tools: Bash(python3 *)
---

# LINE Inbox

Query the personal LINE message archive captured by [lizard-the-linebot](https://github.com/htlin222/lizard-the-linebot). Storage is a Turso (libSQL) database; reads go via Turso's HTTP pipeline API — no extra Python deps.

## Path conventions

`${CLAUDE_SKILL_DIR}` = directory holding this `SKILL.md`. Resolve once per shell:

```bash
export CLAUDE_SKILL_DIR=<path reported by the Skill tool's "Base directory">
```

Credentials default to `/Users/htlin/lizard-the-linebot/.env`. **The file always wins over `TURSO_*` env vars** because the user has another Turso DB exported globally. Override the file path with `LINE_INBOX_ENV=/somewhere/else/.env`.

## Invocation

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" [--json] <subcommand> [args]
```

Subcommands: `latest`, `today`, `search`, `count`, `since`, `get`, `sql`. Default output is a fixed-width table; `--json` emits JSON.

## References (load on demand)

- [references/schema.md](references/schema.md) — `messages` table columns, type-specific fields, what's in `raw_payload`

## Common playbooks

### Latest N (default 10)

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" latest -n 5
```

### Today (Asia/Taipei)

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" today
```

### Search text body

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" search "keyword"
# LIKE %keyword%, capped at -n (default 20)
```

### Time window

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" since "-7 days"      # relative
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" since "2026-05-01"   # absolute
```

### Counts by type

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" count
```

### Full row (incl. raw_payload JSON)

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" --json get 7
```

### Ad-hoc SELECT

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/inbox.py" sql \
  "SELECT message_type, COUNT(*) FROM messages WHERE date(line_timestamp_ms/1000,'unixepoch','+8 hours') >= '2026-05-01' GROUP BY 1"
```

`sql` accepts only one statement, no parameter binding (use single quotes inside the query). Read-only is not enforced — be careful.

## Output shape

Table mode prints a header + dashed underline + rows, columns left-aligned. JSON mode prints `[{col: val, ...}, ...]`; integers/floats are typed, NULL → Python `None` → JSON `null`.

## Errors

- `no creds: ...` — `.env` missing or lacks `TURSO_*` lines.
- `HTTP 401: ...` — token expired/revoked. Reissue: `turso db tokens create lizard --revoke`.
- `sql error: no such table: messages` — wrong DB. Almost always means a stray `TURSO_DATABASE_URL` env var slipped through; check `LINE_INBOX_ENV`.
- `(no rows)` — query ran fine, just nothing matched.
