export interface Env {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}

export type SourceType = "user" | "group" | "room";

export interface Source {
  type: SourceType;
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface BaseMessage {
  id: string;
  type: string;
}

export interface MentionItem {
  index: number;
  length: number;
  type: "user" | "all";
  userId?: string;
  isSelf?: boolean;
}

export interface TextMessage extends BaseMessage {
  type: "text";
  text: string;
  mention?: { mentionees: MentionItem[] };
}

export interface StickerMessage extends BaseMessage {
  type: "sticker";
  packageId: string;
  stickerId: string;
}

export interface FileMessage extends BaseMessage {
  type: "file";
  fileName: string;
  fileSize: number;
}

export interface LocationMessage extends BaseMessage {
  type: "location";
  title?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export type LineMessage =
  | TextMessage
  | StickerMessage
  | FileMessage
  | LocationMessage
  | (BaseMessage & { type: "image" | "video" | "audio" });

export interface MessageEvent {
  type: "message";
  webhookEventId: string;
  timestamp: number;
  source: Source;
  message: LineMessage;
  replyToken?: string;
  deliveryContext?: { isRedelivery: boolean };
}

export interface WebhookPayload {
  destination: string;
  events: Array<MessageEvent | { type: string; [k: string]: unknown }>;
}

export interface MessageRow {
  webhook_event_id: string;
  message_id: string;
  message_type: string;
  source_type: string;
  source_user_id: string | null;
  source_group_id: string | null;
  source_room_id: string | null;
  user_display_name: string | null;
  text: string | null;
  sticker_package_id: string | null;
  sticker_id: string | null;
  file_name: string | null;
  file_size: number | null;
  location_title: string | null;
  location_address: string | null;
  location_latitude: number | null;
  location_longitude: number | null;
  raw_payload: string;
  line_timestamp_ms: number;
  received_at_ms: number;
}
