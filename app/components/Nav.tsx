import Link from "next/link";

export default function Nav() {
  return (
    <nav style={{ padding: 8, borderBottom: "1px solid #3333", gridArea: "nav" }}>
      <Link href="/" style={{ marginRight: 12 }}>Home</Link>
      <Link href="/1-syncro-checkerboard-shots" style={{ marginRight: 12 }}>1. Syncro Checkerboard Shots</Link>
      <Link href="/2-calibrate-scenes" style={{ marginRight: 12 }}>2. Calibrate Scenes</Link>
      <Link href="/3-remap-realtime" style={{ marginRight: 12 }}>3. Remap Realtime</Link>
    </nav>
  );
}
