import { NextResponse } from "next/server";

export const revalidate = 0;

function looksLikeImageUrl(u?: string) {
  if (!u) return false;
  try {
    const url = new URL(u);
    const ext = (url.pathname.split(".").pop() || "").toLowerCase();
    return ["png","jpg","jpeg","gif","webp"].includes(ext);
  } catch { return false; }
}

type Item = { src: string; title?: string; author?: string; id: string; ts?: string };

async function fetchJson(url: string, headers: Record<string,string>) {
  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) throw new Error(`Discord API ${r.status}`);
  return r.json();
}

async function getItemsFromThread(threadId: string, headers: Record<string,string>): Promise<Item[]> {
  // first message of the thread usually contains the image
  const msgs = await fetchJson(`https://discord.com/api/v10/channels/${threadId}/messages?limit=1`, headers);
  const msg = msgs?.[0];
  if (!msg) return [];
  const author = msg.author?.username ?? "Unknown";
  const content = msg.content ?? "";
  const items: Item[] = [];

  for (const a of msg.attachments ?? []) {
    if (a?.url && (a?.content_type?.startsWith("image/") || looksLikeImageUrl(a?.url))) {
      items.push({ src: a.url, title: content || a.filename, author, id: msg.id, ts: msg.timestamp });
    }
  }
  for (const e of msg.embeds ?? []) {
    const u = e?.image?.url || e?.thumbnail?.url;
    if (looksLikeImageUrl(u)) {
      items.push({ src: u!, title: e?.title || content || "Embed", author, id: msg.id, ts: msg.timestamp });
    }
  }
  return items;
}

export async function GET(request: Request) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !channelId) return NextResponse.json({ error: "Missing Discord env vars" }, { status: 500 });

  const headers = { Authorization: `Bot ${token}` };
  const url = new URL(request.url);
  const debugMode = url.searchParams.get("debug") === "1";

  const debug: any = { channelId };

  const collected: Item[] = [];

  try {
    // ---------- TRY MEDIA/THREADED CHANNEL PATH ----------
    const active = await fetchJson(`https://discord.com/api/v10/channels/${channelId}/threads/active`, headers);
    const archived = await fetchJson(`https://discord.com/api/v10/channels/${channelId}/threads/archived/public`, headers);
    const threads = [...(active?.threads ?? []), ...(archived?.threads ?? [])];
    debug.threadCounts = { active: active?.threads?.length ?? 0, archived: archived?.threads?.length ?? 0 };

    for (const t of threads) {
      const items = await getItemsFromThread(t.id, headers);
      collected.push(...items);
    }
  } catch (e) {
    // If those endpoints 404/403 (not a media/forum channel), we’ll fall back below
    debug.threadError = (e as Error).message;
  }

  // ---------- FALLBACK: REGULAR TEXT CHANNEL MESSAGES ----------
  if (collected.length === 0) {
    try {
      const msgs = await fetchJson(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, headers);
      debug.messageCount = Array.isArray(msgs) ? msgs.length : 0;

      for (const m of msgs ?? []) {
        const author = m?.author?.username;
        const content: string = m?.content || "";
        for (const a of m?.attachments ?? []) {
          const isImage = a?.content_type?.startsWith?.("image/") || looksLikeImageUrl(a?.url);
          if (isImage && a?.url) collected.push({ src: a.url, title: content || a.filename, author, id: m.id, ts: m.timestamp });
        }
        for (const e of m?.embeds ?? []) {
          const u = e?.image?.url || e?.thumbnail?.url;
          if (looksLikeImageUrl(u)) collected.push({ src: u!, title: e?.title || content || "Embed", author, id: m.id, ts: m.timestamp });
        }
        const urlMatch = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
        if (urlMatch) collected.push({ src: urlMatch[0], title: content.replace(urlMatch[0], "").trim() || "Link", author, id: m.id, ts: m.timestamp });
      }
    } catch (e) {
      debug.messagesError = (e as Error).message;
    }
  }

  collected.sort((a, b) => (a.id < b.id ? 1 : -1));
  const body = debugMode ? { items: collected, debug } : { items: collected };
  return NextResponse.json(body);
}
