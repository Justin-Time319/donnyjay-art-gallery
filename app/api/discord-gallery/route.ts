// app/api/discord-gallery/route.ts
import { NextResponse } from "next/server";

export const revalidate = 0;

type Item = {
  src: string;
  title?: string;
  author?: string;
  id: string;   // message id
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
  const defaultChannelId = process.env.DISCORD_CHANNEL_ID;

  if (!token) {
    return NextResponse.json({ error: "Missing DISCORD_BOT_TOKEN" }, { status: 500 });
  }

  const headers = { Authorization: `Bot ${token}` };
  const url = new URL(req.url);

  const channelId = url.searchParams.get("channelId") || defaultChannelId;
  const userId = url.searchParams.get("userId") || undefined;
  const beforeParam = url.searchParams.get("before") || undefined; // fetch older than this msg id
  const oneMode = url.searchParams.get("one") === "1";             // return only one item
  const debugMode = url.searchParams.get("debug") === "1";
  const rawMode = url.searchParams.get("raw") === "1";

  // caps (still useful for non-one mode)
  const pages = Math.min(Math.max(Number(url.searchParams.get("pages") || 1), 1), 5);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);

  if (!channelId) {
    return NextResponse.json(
      { error: "channelId is required (query or env DISCORD_CHANNEL_ID)" },
      { status: 400 }
    );
  }

  // -------- RAW DIAGNOSTIC MODE --------
  if (rawMode) {
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (beforeParam) qs.set("before", beforeParam);
      const msgs = await fetchJson(
        `https://discord.com/api/v10/channels/${channelId}/messages?${qs.toString()}`,
        headers
      );
      return NextResponse.json({ channelId, count: Array.isArray(msgs) ? msgs.length : 0, messages: msgs });
    } catch (e) {
      return NextResponse.json({ channelId, error: (e as Error).message }, { status: 500 });
    }
  }

  const debug: any = {
    channelId,
    pagesScanned: 0,
    messagesScanned: 0,
    found: { attachments: 0, embedImages: 0, linkImages: 0 },
  };

  // Helper: build an Item from a message + image URL
  const makeItem = (m: any, src: string, title?: string): Item => ({
    src,
    title: title || m?.content || "Image",
    author: m?.author?.global_name || m?.author?.username || "Unknown",
    id: m?.id,
    ts: m?.timestamp,
  });

  // If oneMode: return immediately when first match found (newest-first).
  const scanForOne = async () => {
    let before = beforeParam;
    for (let p = 0; p < pages; p++) {
      if (p > 0) await new Promise((r) => setTimeout(r, 1200));
      const qs = new URLSearchParams({ limit: String(limit) });
      if (before) qs.set("before", before);

      const msgs: any[] = await fetchJson(
        `https://discord.com/api/v10/channels/${channelId}/messages?${qs.toString()}`,
        headers
      );

      if (!Array.isArray(msgs) || msgs.length === 0) break;

      debug.pagesScanned = p + 1;
      debug.messagesScanned += msgs.length;

      for (const m of msgs) {
        before = m.id; // next page would continue older than this
        if (userId && m?.author?.id !== userId) continue;

        // A) Attachments (prefer these)
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
            debug.found.attachments++;
            const item = makeItem(m, u, a?.filename);
            return NextResponse.json({ item, nextBefore: m.id, ...(debugMode ? { debug } : {}) });
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
              debug.found.embedImages++;
              const item = makeItem(m, eu, e?.title);
              return NextResponse.json({ item, nextBefore: m.id, ...(debugMode ? { debug } : {}) });
            }
          }
        }

        // C) Raw links in content
        const match = (m?.content ?? "").match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
        if (match) {
          debug.found.linkImages++;
          const item = makeItem(m, match[0]);
          return NextResponse.json({ item, nextBefore: m.id, ...(debugMode ? { debug } : {}) });
        }
      }

      // prepare next page older than the last message of this page
      before = msgs[msgs.length - 1]?.id;
      if (msgs.length < limit) break;
    }

    // nothing found
    return NextResponse.json({ item: null, nextBefore: null, ...(debugMode ? { debug } : {}) });
  };

  if (oneMode) {
    return scanForOne();
  }

  // -------- NORMAL (multi) MODE --------
  const items: Item[] = [];
  let before: string | undefined = beforeParam;

  for (let p = 0; p < pages; p++) {
    if (p > 0) await new Promise((r) => setTimeout(r, 1200));

    const qs = new URLSearchParams({ limit: String(limit) });
    if (before) qs.set("before", before);

    let msgs: any[] = [];
    try {
      msgs = await fetchJson(
        `https://discord.com/api/v10/channels/${channelId}/messages?${qs.toString()}`,
        headers
      );
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, ...(debugMode ? { debug } : {}) }, { status: 500 });
    }

    if (!Array.isArray(msgs) || msgs.length === 0) break;

    debug.pagesScanned = p + 1;
    debug.messagesScanned += msgs.length;
    before = msgs[msgs.length - 1]?.id;

    for (const m of msgs) {
      if (userId && m?.author?.id !== userId) continue;
      const content: string = m?.content ?? "";

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
          items.push(makeItem(m, u, a?.filename || content || "Attachment"));
          debug.found.attachments++;
        }
      }

      for (const e of m?.embeds ?? []) {
        const candidates = [
          e?.image?.url,
          e?.image?.proxy_url,
          e?.thumbnail?.url,
          e?.thumbnail?.proxy_url,
        ].filter(Boolean) as string[];
        for (const eu of candidates) {
          if (looksLikeImageUrl(eu) || isDiscordCdn(eu)) {
            items.push(makeItem(m, eu, e?.title || content || "Embed"));
            debug.found.embedImages++;
            break;
          }
        }
      }

      const match = content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i);
      if (match) {
        items.push(makeItem(m, match[0], content.replace(match[0], "").trim() || "Link"));
        debug.found.linkImages++;
      }
    }
  }

  // newest → oldest
  items.sort((a, b) => (a.id < b.id ? 1 : -1));
  return NextResponse.json(debugMode ? { items, debug } : { items });
}
