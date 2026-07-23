import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SportBot AI",
  description: "Football and cricket matches, team form, history, and predictions."
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
