// app/api/discord-gallery/route.ts
import { NextResponse } from "next/server";

// Always fetch fresh
export const revalidate = 0;

type Item = { src: string; title?: string; author?: string; id: string; ts?: string };

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

  const debug: any = { channelId };
  const items: Item[] = [];

  // 1) Try reading parent-channel messages (most servers use this)
  try {
    const msgs = await fetchJson(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
      headers
    );

    debug.messageCount = Array.isArray(msgs) ? msgs.length : 0;

    for (const m of msgs ?? []) {
      const author = m?.author?.username ?? "Unknown";
      const content: string = m?.content ?? "";

      // A) ATTACHMENTS — be permissive: accept if it has a URL and either content_type says "image"
      //    OR the URL looks like an image OR it has width/height (Discord includes those for images)
      for (const a of m?.attachments ?? []) {
        const url: string | undefined = a?.url;
        const isImage =
          !!url &&
          (
            a?.content_type?.startsWith?.("image/") ||
            looksLikeImageUrl(url) ||
            typeof a?.width === "number" || typeof a?.height === "number"
          );

        if (isImage && url) {
          items.push({
            src: url,
            title: content || a?.filename || "Attachment",
            author,
            id: m.id,
            ts: m.timestamp,
          });
        }
      }

      // B) EMBEDS with image or thumbnail
      for (const e of m?.embeds ?? []) {
        const eu = e?.image?.url || e?.thumbnail?.url;
        if (eu && (looksLikeImageUrl(eu))) {
          items.push({
            src: eu,
            title: e?.title || content || "Embed",
            author,
            id: m.id,
            ts: m.timestamp,
          });
        }
      }

      // C) RAW IMAGE LINK in the text
      const linkMatch = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
      if (linkMatch) {
        items.push({
          src: linkMatch[0],
          title: content.replace(linkMatch[0], "").trim() || "Link",
          author,
          id: m.id,
          ts: m.timestamp,
        });
      }
    }
  } catch (e) {
    debug.messagesError = (e as Error).message;
  }

  // 2) (Optional) If you later convert the channel to Media/Forum, you can re-enable thread scraping here.
  //    For now, we skip it because your channel is returning 404 on /threads/active.

  // newest first
  items.sort((a, b) => (a.id < b.id ? 1 : -1));

  const body = debugMode ? { items, debug } : { items };
  return NextResponse.json(body);
}
