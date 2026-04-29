import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "Git Diff Viewer",
  description: "Codex plugin UI proof of concept",
  other: {
    "git-diff-viewer-app": "true"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body data-git-diff-viewer-app="true">{children}</body>
    </html>
  );
}
