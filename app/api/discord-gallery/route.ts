// app/api/discord-gallery/route.ts
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

async function fetchOk(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) throw new Error(`Discord API ${r.status} for ${url}`);
  return r.json();
}

async function getThreadStarterItems(
  threadId: string,
  headers: Record<string, string>
): Promise<Item[]> {
  // Try to fetch the oldest message (the thread "post")
  // Many clients use ?after=0 to get from the beginning.
  const msgs: any[] = await fetchOk(
    `https://discord.com/api/v10/channels/${threadId}/messages?limit=1&after=0`,
    headers
  );

  const msg = msgs?.[0];
  if (!msg) return [];
  const author = msg?.author?.global_name || msg?.author?.username || "Unknown";
  const content: string = msg?.content ?? "";
  const items: Item[] = [];

  for (const a of msg?.attachments ?? []) {
    const url = a?.url as string | undefined;
    const isImage =
      !!url &&
      (a?.content_type?.startsWith?.("image/") ||
        looksLikeImageUrl(url) ||
        typeof a?.width === "number" ||
        typeof a?.height === "number");
    if (isImage && url) {
      items.push({
        src: url,
        title: content || a?.filename || "Attachment",
        author,
        id: msg.id,
        ts: msg.timestamp,
      });
    }
  }

  for (const e of msg?.embeds ?? []) {
    const eu = e?.image?.url || e?.thumbnail?.url;
    if (eu && looksLikeImageUrl(eu)) {
      items.push({
        src: eu,
        title: e?.title || content || "Embed",
        author,
        id: msg.id,
        ts: msg.timestamp,
      });
    }
  }

  const link = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i)?.[0];
  if (link) {
    items.push({
      src: link,
      title: content.replace(link, "").trim() || "Link",
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
  const debug: any = { channelId };

  const allItems: Item[] = [];

  // -------- 1) MEDIA/FORUM PATH: list threads for this channel --------
  try {
    // Get channel (to learn guild_id)
    const channel = await fetchOk(`https://discord.com/api/v10/channels/${channelId}`, headers);
    const guildId: string | undefined = channel?.guild_id;
    debug.guildId = guildId ?? null;

    const threads: any[] = [];

    if (guildId) {
      // Active threads across the guild, then filter by parent_id
      const active = await fetchOk(
        `https://discord.com/api/v10/guilds/${guildId}/threads/active`,
        headers
      );
      const activeThreads: any[] = active?.threads ?? [];
      threads.push(...activeThreads.filter((t) => t?.parent_id === channelId));
      debug.activeThreadsFromGuild = activeThreads.length;
      debug.activeThreadsForChannel = threads.length;
    }

    // Archived public threads directly from this channel (first page)
    try {
      const archived = await fetchOk(
        `https://discord.com/api/v10/channels/${channelId}/threads/archived/public?limit=50`,
        headers
      );
      const archivedThreads: any[] = archived?.threads ?? [];
      debug.archivedThreads = archivedThreads.length;
      threads.push(...archivedThreads);
    } catch (e) {
      debug.archivedError = (e as Error).message;
    }

    // De-duplicate threads by id
    const seen = new Set<string>();
    const uniqueThreads = threads.filter((t) => {
      if (!t?.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    debug.totalThreadsConsidered = uniqueThreads.length;

    // Pull the first message from each thread (usually the original media post)
    for (const t of uniqueThreads) {
      try {
        const items = await getThreadStarterItems(t.id, headers);
        allItems.push(...items);
      } catch (e) {
        // ignore per-thread errors but record
        debug.threadFetchError = (debug.threadFetchError || 0) + 1;
      }
    }
  } catch (e) {
    debug.mediaPathError = (e as Error).message;
  }

  // -------- 2) FALLBACK: REGULAR TEXT CHANNEL MESSAGES --------
  if (allItems.length === 0) {
    try {
      const msgs: any[] = await fetchOk(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
        headers
      );
      debug.messageCount = Array.isArray(msgs) ? msgs.length : 0;

      for (const m of msgs ?? []) {
        const author = m?.author?.global_name || m?.author?.username || "Unknown";
        const content: string = m?.content ?? "";

        for (const a of m?.attachments ?? []) {
          const u = a?.url as string | undefined;
          const isImage =
            !!u &&
            (a?.content_type?.startsWith?.("image/") ||
              looksLikeImageUrl(u) ||
              typeof a?.width === "number" ||
              typeof a?.height === "number");
          if (isImage && u) {
            allItems.push({
              src: u,
              title: content || a?.filename || "Attachment",
              author,
              id: m.id,
              ts: m.timestamp,
            });
          }
        }

        for (const e of m?.embeds ?? []) {
          const eu = e?.image?.url || e?.thumbnail?.url;
          if (eu && looksLikeImageUrl(eu)) {
            allItems.push({
              src: eu,
              title: e?.title || content || "Embed",
              author,
              id: m.id,
              ts: m.timestamp,
            });
          }
        }

        const link = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i)?.[0];
        if (link) {
          allItems.push({
            src: link,
            title: content.replace(link, "").trim() || "Link",
            author,
            id: m.id,
            ts: m.timestamp,
          });
        }
      }
    } catch (e) {
      debug.textPathError = (e as Error).message;
    }
  }

  // newest first
  allItems.sort((a, b) => (a.id < b.id ? 1 : -1));

  const body = debugMode ? { items: allItems, debug } : { items: allItems };
  return NextResponse.json(body);
}
