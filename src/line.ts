import type { Env } from "./types";

export async function verifySignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const expected = bytesToBase64(new Uint8Array(sig));
  return timingSafeEqual(expected, header);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function fetchProfile(
  env: Env,
  userId: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { displayName?: string };
  return data.displayName ?? null;
}

export async function replyMessage(
  env: Env,
  replyToken: string,
  text: string,
): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}
