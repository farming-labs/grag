import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "@farming-labs/grag Docs",
    template: "%s | @farming-labs/grag"
  },
  description: "Documentation for the @farming-labs/grag TypeScript GraphRAG package."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
