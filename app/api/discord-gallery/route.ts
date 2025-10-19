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

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    return NextResponse.json({ error: "Missing Discord env vars" }, { status: 500 });
  }

  // Step 1: fetch all active/archived threads from the channel
  const headers = { Authorization: `Bot ${token}` };
  const activeThreads = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads/active`, { headers });
  const archivedThreads = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads/archived/public`, { headers });

  const active = (await activeThreads.json())?.threads ?? [];
  const archived = (await archivedThreads.json())?.threads ?? [];
  const threads = [...active, ...archived];

  const items: any[] = [];

  // Step 2: fetch the starter message for each thread (usually the art post)
  for (const t of threads) {
    const threadId = t.id;
    try {
      const msgResp = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages?limit=1`, { headers });
      if (!msgResp.ok) continue;

      const [msg] = await msgResp.json();
      if (!msg) continue;

      const author = msg.author?.username ?? "Unknown";
      const content = msg.content ?? "";

      // attachments
      for (const a of msg.attachments ?? []) {
        if (a?.url && (a?.content_type?.startsWith("image/") || looksLikeImageUrl(a?.url))) {
          items.push({
            src: a.url,
            title: content || a.filename,
            author,
            id: msg.id,
            ts: msg.timestamp,
          });
        }
      }

      // embeds
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

    } catch (err) {
      console.error("Thread fetch failed:", err);
    }
  }

  items.sort((a, b) => (a.id < b.id ? 1 : -1));
  return NextResponse.json({ items, debug: { threads: threads.length, items: items.length } });
}
