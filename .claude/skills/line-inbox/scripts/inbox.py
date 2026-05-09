#!/usr/bin/env python3
"""Query the lizard-the-linebot Turso DB from anywhere."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

DEFAULT_ENV = pathlib.Path("/Users/htlin/lizard-the-linebot/.env")


def load_creds() -> tuple[str, str]:
    """Resolve URL + token. The repo's .env always wins over shell env vars,
    because the user may have a different TURSO_DATABASE_URL exported for
    another project. Only fall back to env vars if the .env is missing.
    Override the file path with LINE_INBOX_ENV=/path/to/.env."""
    env_path = pathlib.Path(os.environ.get("LINE_INBOX_ENV", DEFAULT_ENV))
    if env_path.exists():
        env: dict[str, str] = {}
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
        url = env.get("TURSO_DATABASE_URL", "")
        token = env.get("TURSO_AUTH_TOKEN", "")
        if url and token:
            return _to_https(url), token

    url = os.environ.get("TURSO_DATABASE_URL", "")
    token = os.environ.get("TURSO_AUTH_TOKEN", "")
    if url and token:
        return _to_https(url), token
    sys.exit(
        f"no creds: put TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in {env_path}, "
        f"or set LINE_INBOX_ENV=/path/to/.env"
    )


def _to_https(url: str) -> str:
    return url.replace("libsql://", "https://", 1) if url.startswith("libsql://") else url


def execute(sql: str, args: list | None = None) -> list[dict]:
    """POST a single statement to Turso's HTTP pipeline. Returns list of row dicts."""
    url, token = load_creds()
    stmt: dict = {"sql": sql}
    if args:
        stmt["args"] = [_arg(a) for a in args]
    body = json.dumps({
        "requests": [
            {"type": "execute", "stmt": stmt},
            {"type": "close"},
        ]
    }).encode()
    req = urllib.request.Request(
        f"{url}/v2/pipeline",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "lizard-inbox-cli/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            payload = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:300]}")

    result = payload["results"][0]
    if result.get("type") == "error":
        sys.exit(f"sql error: {result['error']['message']}")
    res = result["response"]["result"]
    cols = [c["name"] for c in res["cols"]]
    return [{c: _val(v) for c, v in zip(cols, row)} for row in res["rows"]]


def _arg(v) -> dict:
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": str(int(v))}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}


def _val(cell: dict):
    t = cell.get("type")
    if t == "null":
        return None
    v = cell.get("value")
    if t == "integer":
        return int(v)
    if t == "float":
        return float(v)
    return v


# ---- formatting -----------------------------------------------------------

def fmt(rows: list[dict], as_json: bool) -> str:
    if as_json:
        return json.dumps(rows, ensure_ascii=False, indent=2)
    if not rows:
        return "(no rows)"
    cols = list(rows[0].keys())
    widths = {c: max(len(c), *(len(str(r.get(c) or "")) for r in rows)) for c in cols}
    out = ["  ".join(c.ljust(widths[c]) for c in cols),
           "  ".join("-" * widths[c] for c in cols)]
    for r in rows:
        out.append("  ".join(str(r.get(c) or "").ljust(widths[c]) for c in cols))
    return "\n".join(out)


# ---- subcommands ----------------------------------------------------------

PREVIEW_SQL = (
    "SELECT id, message_type, user_display_name, "
    "substr(coalesce(text, sticker_id, file_name, location_title, ''), 1, 80) AS preview, "
    "datetime(line_timestamp_ms/1000, 'unixepoch', '+8 hours') AS at_tw "
    "FROM messages"
)


def cmd_latest(args):
    return execute(f"{PREVIEW_SQL} ORDER BY id DESC LIMIT ?", [args.n])


def cmd_today(_):
    return execute(
        f"{PREVIEW_SQL} "
        "WHERE date(line_timestamp_ms/1000, 'unixepoch', '+8 hours') "
        "    = date('now', '+8 hours') "
        "ORDER BY id DESC"
    )


def cmd_search(args):
    return execute(
        f"{PREVIEW_SQL} WHERE text LIKE ? ORDER BY id DESC LIMIT ?",
        [f"%{args.query}%", args.n],
    )


def cmd_count(_):
    return execute(
        "SELECT message_type, COUNT(*) AS n FROM messages "
        "GROUP BY message_type ORDER BY n DESC"
    )


def cmd_since(args):
    # Relative ("-7 days", "+1 hour") use 'now' as the anchor; absolute
    # ("2026-05-01") parses directly. CAST AS INTEGER is required — strftime
    # returns TEXT and SQLite's INTEGER>=TEXT comparison silently yields NULL.
    if args.when.startswith(("-", "+")):
        anchor = "CAST(strftime('%s', 'now', ?) AS INTEGER)"
    else:
        anchor = "CAST(strftime('%s', ?) AS INTEGER)"
    sql = (
        f"{PREVIEW_SQL} "
        f"WHERE line_timestamp_ms/1000 >= {anchor} "
        "ORDER BY id DESC LIMIT ?"
    )
    return execute(sql, [args.when, args.n])


def cmd_get(args):
    return execute("SELECT * FROM messages WHERE id = ?", [args.id])


def cmd_sql(args):
    return execute(args.sql)


# ---- argparse -------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(description="Query the LINE inbox Turso DB")
    p.add_argument("--json", action="store_true", help="output JSON instead of table")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("latest", help="last N messages (default 10)")
    sp.add_argument("-n", type=int, default=10)
    sp.set_defaults(fn=cmd_latest)

    sp = sub.add_parser("today", help="today's messages (Asia/Taipei)")
    sp.set_defaults(fn=cmd_today)

    sp = sub.add_parser("search", help="LIKE-search the text column")
    sp.add_argument("query")
    sp.add_argument("-n", type=int, default=20)
    sp.set_defaults(fn=cmd_search)

    sp = sub.add_parser("count", help="count rows by message_type")
    sp.set_defaults(fn=cmd_count)

    sp = sub.add_parser("since", help="messages on/after WHEN (e.g. '2026-05-01' or '-7 days')")
    sp.add_argument("when")
    sp.add_argument("-n", type=int, default=50)
    sp.set_defaults(fn=cmd_since)

    sp = sub.add_parser("get", help="full row for one id")
    sp.add_argument("id", type=int)
    sp.set_defaults(fn=cmd_get)

    sp = sub.add_parser("sql", help="raw SELECT (no params)")
    sp.add_argument("sql")
    sp.set_defaults(fn=cmd_sql)

    args = p.parse_args()
    rows = args.fn(args)
    print(fmt(rows, args.json))


if __name__ == "__main__":
    main()
