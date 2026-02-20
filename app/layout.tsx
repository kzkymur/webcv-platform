import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "webcv-platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="grid">
          {children}
        </div>
      </body>
    </html>
  );
}
