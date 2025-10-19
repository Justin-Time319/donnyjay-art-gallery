import { NextResponse } from "next/server";

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

  // STEP 1 — Try standard text messages first
  try {
    const msgs = await fetchJson(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
      headers
    );
    debug.messageCount = Array.isArray(msgs) ? msgs.length : 0;

    for (const m of msgs ?? []) {
      const author =
        m?.author?.global_name || m?.author?.username || "Unknown";
      const content: string = m?.content ?? "";

      // ATTACHMENTS (permissive detection)
      for (const a of m?.attachments ?? []) {
        const url = a?.url;
        const isImage =
          a?.content_type?.startsWith?.("image/") ||
          looksLikeImageUrl(url) ||
          (a?.width && a?.height);
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

      // EMBEDS (images or thumbnails)
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

      // RAW IMAGE LINKS
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

  // STEP 2 — If nothing found, try Discord’s media search API
  if (items.length === 0) {
    try {
      const mediaResp = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages/search?has=media`,
        { headers }
      );
      if (mediaResp.ok) {
        const data = await mediaResp.json();
        const hits = data?.messages?.flat?.() ?? [];
        debug.mediaHits = hits.length;

        for (const m of hits) {
          const author =
            m?.author?.global_name || m?.author?.username || "Unknown";
          for (const a of m?.attachments ?? []) {
            const url = a?.url;
            if (url && looksLikeImageUrl(url)) {
              items.push({
                src: url,
                title: m?.content || a?.filename || "Image",
                author,
                id: m.id,
                ts: m.timestamp,
              });
            }
          }
        }
      } else {
        debug.mediaError = `Discord API ${mediaResp.status} for media endpoint`;
      }
    } catch (err) {
      debug.mediaCatch = (err as Error).message;
    }
  }

  // Sort newest → oldest
  items.sort((a, b) => (a.id < b.id ? 1 : -1));

  const body = debugMode ? { items, debug } : { items };
  return NextResponse.json(body);
}
