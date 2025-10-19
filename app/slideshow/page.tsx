"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import art from "@/data/art.json";

export default function Slideshow() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % art.length), 3500);
    return () => clearInterval(id);
  }, []);
  const item = art[i];

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
      <div style={{position:'fixed', bottom:16, left:16, opacity:.8}}>
        {i+1}/{art.length} — {item.title ?? "Untitled"}
      </div>
    </main>
  );
}
