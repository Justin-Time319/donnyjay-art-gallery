export default function Home() {
  return (
    <main style={{padding:'32px', maxWidth: 960, margin: '0 auto'}}>
      <h1 style={{fontSize: '2rem', marginBottom: 12}}>Donny Jay – Art Hub</h1>
      <p style={{opacity:.8, marginBottom: 24}}>
        Browse the community art gallery or start the full-screen slideshow.
      </p>
      <ul style={{display:'grid', gap:12}}>
        <li><a href="/gallery">🖼️ Open Gallery Grid</a></li>
        <li><a href="/slideshow">🎞️ Start Slideshow</a></li>
      </ul>
    </main>
  );
}
