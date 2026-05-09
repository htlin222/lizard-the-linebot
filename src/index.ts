import { createDb, insertMessage } from "./db";
import { extractRow } from "./extract";
import { fetchProfile, replyMessage, verifySignature } from "./line";
import type { Env, MessageEvent, WebhookPayload } from "./types";

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

// In 1:1 chat, always reply. In groups/rooms, reply only when the bot is
// explicitly @-mentioned (mentionee with isSelf=true). @all mentions are
// ignored on purpose so group-wide pings don't spam acks.
function shouldReply(event: MessageEvent): boolean {
  if (event.source.type === "user") return true;
  if (event.message.type !== "text") return false;
  return (event.message.mention?.mentionees ?? []).some((m) => m.isSelf === true);
}
