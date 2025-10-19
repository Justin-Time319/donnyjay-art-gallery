// app/api/discord-gallery/route.ts
import { NextResponse } from "next/server";

export const revalidate = 0;

type Item = {
  src: string;
  title?: string;
  author?: string;
  id: string;
  ts?: string;
};

function looksLikeImageUrl(u?: string) {
  if (!u) return false;
  try {
    const url = new URL(u);
    const ext = (url.pathname.split(".").pop() || "").toLowerCase();
    return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  } catch {
    return false;
  }
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) throw new Error(`Discord API ${r.status} for ${url}`);
  return r.json();
}

export async function GET(req: Request) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !channelId) {
    return NextResponse.json(
      { error: "Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID" },
      { status: 500 }
    );
  }

  const headers = { Authorization: `Bot ${token}` };
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";

  // You can tweak how deep we scan: pages * 100 messages (max 5 pages = 500 messages)
  const pages = Math.min(Math.max(Number(url.searchParams.get("pages") || 5), 1), 5);

  const items: Item[] = [];
  const debug: any = { channelId, pagesScanned: 0, messagesScanned: 0 };

  let before: string | undefined = undefined;

  for (let p = 0; p < pages; p++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (before) qs.set("before", before);

    let msgs: any[] = [];
    try {
      msgs = await fetchJson(
        `https://discord.com/api/v10/channels/${channelId}/messages?${qs.toString()}`,
        headers
      );
    } catch (e) {
      debug.fetchError = (e as Error).message;
      break;
    }

    if (!Array.isArray(msgs) || msgs.length === 0) break;

    debug.pagesScanned = p + 1;
    debug.messagesScanned += msgs.length;

    // Next page anchor
    before = msgs[msgs.length - 1]?.id;

    for (const m of msgs) {
      const author =
        m?.author?.global_name || m?.author?.username || "Unknown";
      const content: string = m?.content ?? "";

      // A) Attachments (be permissive: URL + image content_type OR image-looking URL OR width/height set)
      for (const a of m?.attachments ?? []) {
        const u = a?.url as string | undefined;
        const isImage =
          !!u &&
          (a?.content_type?.startsWith?.("image/") ||
            looksLikeImageUrl(u) ||
            typeof a?.width === "number" ||
            typeof a?.height === "number");
        if (isImage && u) {
          items.push({
            src: u,
            title: content || a?.filename || "Attachment",
            author,
            id: m.id,
            ts: m.timestamp,
          });
        }
      }

      // B) Embeds with image/thumbnail
      for (const e of m?.embeds ?? []) {
        const eu = e?.image?.url || e?.thumbnail?.url;
        if (eu && looksLikeImageUrl(eu)) {
          items.push({
            src: eu,
            title: e?.title || content || "Embed",
            author,
            id: m.id,
            ts: m.timestamp,
          });
        }
      }

      // C) Raw image link in text
      const match = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
      if (match) {
        items.push({
          src: match[0],
          title: content.replace(match[0], "").trim() || "Link",
          author,
          id: m.id,
          ts: m.timestamp,
        });
      }
    }
  }

  // newest first
  items.sort((a, b) => (a.id < b.id ? 1 : -1));

  const body = debugMode ? { items, debug } : { items };
  return NextResponse.json(body);
}
