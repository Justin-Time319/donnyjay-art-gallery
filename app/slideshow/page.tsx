"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type Item = { src: string; title?: string; author?: string; id: string };

function useQuery() {
  return useMemo(
    () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
    []
  );
}

export default function Slideshow() {
  const [items, setItems] = useState<Item[]>([]);
  const [i, setI] = useState(0);
  const q = useQuery();

  const interval = Math.max(800, Number(q.get("interval") ?? 3500));
  const shuffle = q.get("shuffle") === "1";

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/discord-gallery", { cache: "no-store" });
      const j = await r.json();
      let arr: Item[] = j.items ?? [];
      if (shuffle) arr = arr.sort(() => Math.random() - 0.5);
      setItems(arr);
    })();
  }, [shuffle]);

  useEffect(() => {
    if (!items.length) return;
    const id = setInterval(() => setI((n) => (n + 1) % items.length), interval);
    return () => clearInterval(id);
  }, [items, interval]);

  if (!items.length) return <main style={{padding:24}}>Loading slideshow…</main>;

  const item = items[i];
  return (
    <main style={{
      height:'100vh', width:'100vw',
      display:'grid', placeItems:'center',
      background:'#000', color:'#fff'
    }}>
      <div style={{position:'relative', width:'min(95vw,1200px)', aspectRatio:'16/9'}}>
        <Image
          src={item.src}
          alt={item.title ?? "art"}
          fill
          sizes="100vw"
          style={{objectFit:'contain'}}
          priority
        />
      </div>
      <div style={{
        position:'fixed',
        bottom:16,
        left:16,
        right:16,
        display:'flex',
        justifyContent:'space-between',
        gap:12,
        opacity:.9,
        fontSize:14
      }}>
        <span>{i+1}/{items.length}</span>
        <span style={{textAlign:'center'}}>
          {item.title?.trim() ? item.title : "Untitled"}
        </span>
        <span style={{textAlign:'right'}}>by {item.author ?? "Unknown"}</span>
      </div>
    </main>
  );
}
