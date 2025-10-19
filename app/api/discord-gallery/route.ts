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

function isDiscordCdn(u?: string) {
  if (!u) return false;
  try {
    const h = new URL(u).hostname;
    return h === "cdn.discordapp.com" || h === "media.discordapp.net";
  } catch {
    return false;
  }
}

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
  const rawMode = url.searchParams.get("raw") === "1";
  const pages = Math.min(Math.max(Number(url.searchParams.get("pages") || 1), 1), 5);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 1), 100);

  // -------- RAW DIAGNOSTIC MODE --------
  if (rawMode) {
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      const msgs = await fetchJson(
        `https://discord.com/api/v10/channels/${channelId}/messages?${qs.toString()}`,
        headers
      );
      // Return exactly what Discord returned (safe—no secrets in payload)
      return NextResponse.json({ channelId, count: Array.isArray(msgs) ? msgs.length : 0, messages: msgs });
    } catch (e) {
      return NextResponse.json({ channelId, error: (e as Error).message }, { status: 500 });
    }
  }

  // -------- NORMAL PARSING MODE --------
  const items: Item[] = [];
  const debug: any = {
    channelId,
    pagesScanned: 0,
    messagesScanned: 0,
    found: { attachments: 0, embedImages: 0, linkImages: 0 },
  };

  let before: string | undefined = undefined;

  for (let p = 0; p < pages; p++) {
    if (p > 0) await new Promise((r) => setTimeout(r, 1200)); // rate-limit friendly

    const qs = new URLSearchParams({ limit: String(limit) });
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
    before = msgs[msgs.length - 1]?.id;

    for (const m of msgs) {
      const author = m?.author?.global_name || m?.author?.username || "Unknown";
      const content: string = m?.content ?? "";

      // A) Attachments
      for (const a of m?.attachments ?? []) {
        const u = a?.url as string | undefined;
        const isImage =
          !!u &&
          (a?.content_type?.startsWith?.("image/") ||
            looksLikeImageUrl(u) ||
            isDiscordCdn(u) ||
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
          debug.found.attachments++;
        }
      }

      // B) Embeds
      for (const e of m?.embeds ?? []) {
        const candidates = [
          e?.image?.url,
          e?.image?.proxy_url,
          e?.thumbnail?.url,
          e?.thumbnail?.proxy_url,
        ].filter(Boolean) as string[];

        for (const eu of candidates) {
          if (looksLikeImageUrl(eu) || isDiscordCdn(eu)) {
            items.push({
              src: eu,
              title: e?.title || content || "Embed",
              author,
              id: m.id,
              ts: m.timestamp,
            });
            debug.found.embedImages++;
            break;
          }
        }
      }

      // C) Raw links
      const match = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
      if (match) {
        items.push({
          src: match[0],
          title: content.replace(match[0], "").trim() || "Link",
          author,
          id: m.id,
          ts: m.timestamp,
        });
        debug.found.linkImages++;
      }
    }
  }

  items.sort((a, b) => (a.id < b.id ? 1 : -1));
  return NextResponse.json(debugMode ? { items, debug } : { items });
}
