# 03 — Cloudflare Workers + Turso runtime

## Introduction

A personal LINE-bot has near-zero traffic and an asymmetric cost
profile: idle 99% of the time, but must be *reachable* and *fast*
during the 1% when a webhook fires. We picked an edge-runtime + HTTP
DB combo to eliminate idle cost and keep the dependency surface
minimal.

## Methods

Four hosting candidates were considered: Cloudflare Workers,
Fly/Railway/Render, local + Cloudflare Tunnel, Vercel/Netlify
Functions.

For storage we wanted libSQL (SQLite-compatible, single-file mental
model) with a remote-first client. Two libSQL clients exist:
`@libsql/client` (full-featured, has native deps) and
`@tursodatabase/serverless` (pure-fetch, no native deps).

Picked **Workers + `@tursodatabase/serverless`** specifically because
Workers run on V8 isolates with no Node compatibility shim by default,
and `@tursodatabase/serverless` calls `fetch()` directly against
Turso's `/v2/pipeline` HTTP endpoint — no libuv, no native modules, no
worker-runtime assumptions to break.

## Results

- **Bundle size:** 34.6 KiB upload, 8.2 KiB gzipped (current version `a9264969`).
- **Cold deploy:** ~3 seconds for `wrangler deploy`.
- **End-to-end webhook latency:** typical reply visible in LINE within ~2 s of forward, including DB INSERT and profile-API call.
- **Deployment trail today:** 6 deploys (`a9e8c3f3` → `a9264969`), all atomic, no traffic gap.
- **Turso DB:** 25 kB, region `aws-ap-northeast-1` (Tokyo, closest to user in Taiwan), libSQL 2026.6.0.

## Discussion

A few non-obvious things tripped us during deploy:

1. **First deploy publishes the script but not the URL.** Cloudflare
   Workers default `workers_dev = false`. The dashboard shows the URL
   greyed out. Setting `workers_dev = true` in `wrangler.toml` makes
   subsequent deploys auto-enable.
2. **First-time accounts must register a `*.workers.dev` subdomain.**
   This is one-time, browser-only, on the Cloudflare dashboard.
   Hit during the very first `wrangler deploy` with a "register a
   workers.dev subdomain" error.
3. **TLS certificate provisioning takes 1–5 minutes** after a new
   subdomain is first used. Smoke tests run immediately after deploy
   will see `SSL handshake failure` or `certificate not found` —
   wait, retry, don't change anything.
4. **Cloudflare's edge bot-detection blocks `Python-urllib/3.x` UAs**
   with HTTP 403 + error code `1010` for some workers.dev domains.
   Test scripts need to set `User-Agent` to anything browser-like.
   LINE's actual webhook UA is fine; this only bites local testing.
5. **`wrangler secret put NAME` reads from stdin** when not run on a
   TTY — perfect for `printf '%s' "$VAL" | wrangler secret put NAME`
   loops driven from `.env` files.
6. **`ctx.waitUntil(reply)`** lets us return `200` to LINE before the
   reply API call resolves. LINE expects webhook responses in well
   under 1 s; without `waitUntil` the reply API would push us past
   the threshold under network jitter.

Free-tier math at personal volume is comfortable: Workers gives
100 k requests/day, Turso gives 9 GB storage and 25 M writes/month.
A "forward 100 messages/day" personal pattern uses well under 0.1 %
of either ceiling.
