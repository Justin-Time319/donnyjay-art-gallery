import { NextResponse } from "next/server";

export const revalidate = 0; // always fresh data

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    return NextResponse.json({ error: "Missing Discord environment variables." }, { status: 500 });
  }

  const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, {
    headers: { Authorization: `Bot ${token}` },
    cache: "no-store",
  });

  if (!resp.ok) {
    return NextResponse.json({ error: "Failed to fetch messages." }, { status: resp.status });
  }

  const messages = await resp.json();

  const items = messages.flatMap((m: any) => {
    const author = m.author?.username || "Unknown";
    const text = m.content || "";
    const attachments = m.attachments
      ?.filter((a: any) =>
        a.content_type?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url)
      )
      ?.map((a: any) => ({
        src: a.url,
        title: text || a.filename,
        author,
        id: m.id,
      })) || [];

    return attachments;
  });

  return NextResponse.json({ items });
}
