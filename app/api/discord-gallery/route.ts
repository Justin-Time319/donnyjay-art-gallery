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

export async function GET(request: Request) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    return NextResponse.json({ error: "Missing Discord env vars" }, { status: 500 });
  }

  const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bot ${token}` },
    cache: "no-store",
  });

  const debug: any = { ok: resp.ok, status: resp.status };
  if (!resp.ok) {
    return NextResponse.json({ error: "Discord API error", ...debug }, { status: resp.status });
  }

  const messages = (await resp.json()) as any[];
  debug.messageCount = Array.isArray(messages) ? messages.length : 0;

  const items: Array<{ src: string; title?: string; author?: string; id: string; ts?: string }> = [];

  for (const m of messages || []) {
    const author = m?.author?.username;
    const content: string = m?.content || "";

    // 1) Attachments
    for (const a of m?.attachments ?? []) {
      const isImage =
        a?.content_type?.startsWith?.("image/") ||
        looksLikeImageUrl(a?.url);
      if (isImage && a?.url) {
        items.push({
          src: a.url,
          title: content || a.filename,
          author,
          id: m.id,
          ts: m.timestamp,
        });
      }
    }

    // 2) Embeds (unfurled links)
    for (const e of m?.embeds ?? []) {
      const url = e?.image?.url || e?.thumbnail?.url;
      if (looksLikeImageUrl(url)) {
        items.push({
          src: url!,
          title: e?.title || content || "Embed",
          author,
          id: m.id,
          ts: m.timestamp,
        });
      }
    }

    // 3) Fallback: image URLs pasted in the text itself
    const urlMatch = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
    if (urlMatch) {
      items.push({
        src: urlMatch[0],
        title: content.replace(urlMatch[0], "").trim() || "Link",
        author,
        id: m.id,
        ts: m.timestamp,
      });
    }
  }

  // Newest first
  items.sort((a, b) => (a.id < b.id ? 1 : -1));

  const { searchParams } = new URL(request.url);
  const includeDebug = searchParams.get("debug") === "1";

  return NextResponse.json(includeDebug ? { items, debug } : { items });
}
