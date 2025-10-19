"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

type Item = { src: string; title?: string; author?: string; id: string };

export default function Gallery() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/discord-gallery");
      const data = await res.json();
      setItems(data.items || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <main style={{padding:24}}>Loading art from Discord...</main>;
  if (!items.length) return <main style={{padding:24}}>No images found.</main>;

  return (
    <main style={{padding:'24px'}}>
      <h1 style={{fontSize:'1.75rem', marginBottom:16}}>🎨 Discord Art Gallery</h1>
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))',
        gap:16
      }}>
        {items.map((item) => (
          <figure key={item.id} style={{border:'1px solid #333', borderRadius:12, overflow:'hidden'}}>
            <Image
              src={item.src}
              alt={item.title || "art"}
              width={800}
              height={800}
              style={{width:'100%', height:'auto'}}
            />
            <figcaption style={{padding:'8px 10px', fontSize:14, opacity:.85}}>
              {item.title || "Untitled"} — <i>{item.author}</i>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
