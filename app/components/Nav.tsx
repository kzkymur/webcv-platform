import Link from "next/link";

export default function Nav() {
  return (
    <nav style={{ padding: 8, borderBottom: "1px solid #3333", gridArea: "nav" }}>
      <Link href="/" style={{ marginRight: 12 }}>Home</Link>
      <Link href="/calibration" style={{ marginRight: 12 }}>Calibration</Link>
      <Link href="/homography" style={{ marginRight: 12 }}>Homography</Link>
      <Link href="/galvo">Galvo</Link>
    </nav>
  );
}
