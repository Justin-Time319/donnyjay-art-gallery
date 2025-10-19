import Image from "next/image";
import art from "@/data/art.json";

export default function Gallery() {
  return (
    <main style={{padding:'24px'}}>
      <h1 style={{fontSize:'1.75rem', marginBottom:16}}>Community Art Gallery</h1>
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))',
        gap:16
      }}>
        {art.map((item) => (
          <figure key={item.src} style={{border:'1px solid #333', borderRadius:12, overflow:'hidden'}}>
            <Image
              src={item.src}
              alt={item.title ?? "art"}
              width={800}
              height={800}
              style={{width:'100%', height:'auto', display:'block'}}
            />
            <figcaption style={{padding:'8px 10px', fontSize:14, opacity:.85}}>
              {item.title ?? "Untitled"}
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
