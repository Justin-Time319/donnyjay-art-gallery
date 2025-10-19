"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

type Item = { src: string; title?: string; author?: string; id: string };

export default function Gallery() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/discord-gallery", { cache: "no-store" });
        const j = await r.json();
        setItems(j.items ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <main style={{padding:24}}>Loading gallery…</main>;
  if (!items.length) return <main style={{padding:24}}>No images found yet.</main>;

  return (
    <main style={{padding:'24px'}}>
      <h1 style={{fontSize:'1.75rem', marginBottom:16}}>Community Art Gallery</h1>
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))',
        gap:16
      }}>
        {items.map((item) => (
          <figure key={item.id + item.src} style={{
            border:'1px solid #333',
            borderRadius:12,
            overflow:'hidden',
            background:'#111'
          }}>
            <Image
              src={item.src}
              alt={item.title ?? "art"}
              width={1200}
              height={800}
              style={{width:'100%', height:'auto', display:'block'}}
            />
            <figcaption style={{padding:'10px 12px', fontSize:14, lineHeight:1.4}}>
              <div style={{fontWeight:600}}>
                {item.title?.trim() ? item.title : "Untitled"}
              </div>
              <div style={{opacity:.75}}>
                by {item.author ?? "Unknown"}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
