import type { Connection } from "@tursodatabase/serverless";
import { createDb, insertMessage, updateR2Key } from "./db";
import { extractRow } from "./extract";
import { fetchProfile, replyMessage, verifySignature } from "./line";
import type { Env, MessageEvent, WebhookPayload } from "./types";

const BINARY_TYPES = new Set(["image", "video", "audio", "file"]);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response("lizard is alive\n", { status: 200 });
    }

    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    const body = await req.text();
    const sig = req.headers.get("x-line-signature");
    const ok = await verifySignature(env.LINE_CHANNEL_SECRET, body, sig);
    if (!ok) return new Response("invalid signature", { status: 401 });

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body) as WebhookPayload;
    } catch {
      return new Response("bad json", { status: 400 });
    }

    const db = createDb(env);

    for (const event of payload.events) {
      if (event.type !== "message") continue;
      const msg = event as MessageEvent;

      const row = extractRow(msg);

      if (row.source_user_id) {
        try {
          row.user_display_name = await fetchProfile(env, row.source_user_id);
        } catch {
          row.user_display_name = null;
        }
      }

      try {
        await insertMessage(db, row);
      } catch (err) {
        console.error("insert failed", err);
      }

      if (BINARY_TYPES.has(row.message_type)) {
        ctx.waitUntil(
          archiveContent(env, db, row.webhook_event_id, row.message_id).catch(
            (err) => console.error("archive failed", err),
          ),
        );
      }

      if (msg.replyToken && shouldReply(msg)) {
        ctx.waitUntil(
          replyMessage(env, msg.replyToken, "蜥蜴已收到🦎").catch((err) =>
            console.error("reply failed", err),
          ),
        );
      }
    }

    return new Response("ok", { status: 200 });
  },
} satisfies ExportedHandler<Env>;

// Every message is ingested for archival. Reply only fires when the bot
// is explicitly @-mentioned in a group/room — DMs stay silent too, so
// the bot never speaks unless directly summoned.
function shouldReply(event: MessageEvent): boolean {
  if (event.source.type === "user") return false;
  if (event.message.type !== "text") return false;
  return (event.message.mention?.mentionees ?? []).some((m) => m.isSelf === true);
}

// LINE retains binary content for ~7 days at api-data.line.me. We pull
// bytes once and stash them in R2 keyed by YYYY-MM/<messageId>.
async function archiveContent(
  env: Env,
  db: Connection,
  webhookEventId: string,
  messageId: string,
): Promise<void> {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } },
  );
  if (!res.ok || !res.body) {
    console.error(`content fetch failed ${messageId}: ${res.status}`);
    return;
  }
  const contentType =
    res.headers.get("content-type") ?? "application/octet-stream";
  const yyyymm = new Date().toISOString().slice(0, 7);
  const key = `${yyyymm}/${messageId}`;
  await env.ATTACHMENTS.put(key, res.body, { httpMetadata: { contentType } });
  await updateR2Key(db, webhookEventId, key);
}
