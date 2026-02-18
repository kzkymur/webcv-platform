import "./globals.css";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";

export const metadata = {
  title: "GalvoWeb 3.0",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="grid">
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}
