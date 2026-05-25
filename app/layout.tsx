import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CricBot AI",
  description: "Live cricket scores, player form, team analysis, and match predictions."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
