// app/api/discord-gallery/route.ts
import { NextResponse } from "next/server";

// Always fetch fresh from Discord
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

async function getFirstMessageItemsFromThread(
  threadId: string,
  headers: Record<string, string>
): Promise<Item[]> {
  // In Media/Forum channels, the art is the FIRST message of each thread
  const msgs = await fetchJson(
    `https://discord.com/api/v10/channels/${threadId}/messages?limit=1`,
    headers
  );
  const msg = msgs?.[0];
  if (!msg) return [];
  const author = msg.author?.username ?? "Unknown";
  const content = msg.content ?? "";

  const items: Item[] = [];

  // Attachments
  for (const a of msg.attachments ?? []) {
    const isImage =
      a?.content_type?.startsWith?.("image/") || looksLikeImageUrl(a?.url);
    if (isImage && a?.url) {
      items.push({
        src: a.url,
        title: content || a.filename,
        author,
        id: msg.id,
        ts: msg.timestamp,
      });
    }
  }

  // Embeds (unfurled image links)
  for (const e of msg.embeds ?? []) {
    const u = e?.image?.url || e?.thumbnail?.url;
    if (looksLikeImageUrl(u)) {
      items.push({
        src: u!,
        title: e?.title || content || "Embed",
        author,
        id: msg.id,
        ts: msg.timestamp,
      });
    }
  }

  // Fallback: raw image URL in text
  const urlMatch = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
  if (urlMatch) {
    items.push({
      src: urlMatch[0],
      title: content.replace(urlMatch[0], "").trim() || "Link",
      author,
      id: msg.id,
      ts: msg.timestamp,
    });
  }

  return items;
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

  const collected: Item[] = [];
  const debug: any = { channelId };

  // ---------------------------
  // 1) MEDIA/FORUM CHANNEL PATH
  // ---------------------------
  try {
    // Active + archived public threads under the channel
    const active = await fetchJson(
      `https://discord.com/api/v10/channels/${channelId}/threads/active`,
      headers
    );
    const archived = await fetchJson(
      `https://discord.com/api/v10/channels/${channelId}/threads/archived/public`,
      headers
    );

    const activeThreads = active?.threads ?? [];
    const archivedThreads = archived?.threads ?? [];
    debug.threadCounts = {
      active: activeThreads.length,
      archived: archivedThreads.length,
    };

    const threads = [...activeThreads, ...archivedThreads];

    // Pull first message (art post) from each thread
    for (const t of threads) {
      const items = await getFirstMessageItemsFromThread(t.id, headers);
      collected.push(...items);
    }
  } catch (e) {
    // If the channel isn't a media/forum channel, these endpoints can 404/403 — that's fine.
    debug.threadError = (e as Error).message;
  }

  // ------------------------------------------------
  // 2) FALLBACK: REGULAR TEXT CHANNEL (no threads)
  // ------------------------------------------------
  if (collected.length === 0) {
    try {
      const msgs = await fetchJson(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
        headers
      );
      debug.messageCount = Array.isArray(msgs) ? msgs.length : 0;

      for (const m of msgs ?? []) {
        const author = m?.author?.username;
        const content: string = m?.content || "";

        for (const a of m?.attachments ?? []) {
          const isImage =
            a?.content_type?.startsWith?.("image/") || looksLikeImageUrl(a?.url);
          if (isImage && a?.url) {
            collected.push({
              src: a.url,
              title: content || a.filename,
              author,
              id: m.id,
              ts: m.timestamp,
            });
          }
        }
        for (const e of m?.embeds ?? []) {
          const u = e?.image?.url || e?.thumbnail?.url;
          if (looksLikeImageUrl(u)) {
            collected.push({
              src: u!,
              title: e?.title || content || "Embed",
              author,
              id: m.id,
              ts: m.timestamp,
            });
          }
        }
        const urlMatch = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
        if (urlMatch) {
          collected.push({
            src: urlMatch[0],
            title: content.replace(urlMatch[0], "").trim() || "Link",
            author,
            id: m.id,
            ts: m.timestamp,
          });
        }
      }
    } catch (e) {
      debug.messagesError = (e as Error).message;
    }
  }

  // newest first
  collected.sort((a, b) => (a.id < b.id ? 1 : -1));

  const payload = debugMode ? { items: collected, debug } : { items: collected };
  return NextResponse.json(payload);
}
