import "./globals.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthProvider } from "../components/auth-provider";
import { AuthNav } from "../components/auth-nav";

export const metadata: Metadata = {
  title: "Common Ground — Shared understanding starts here",
  description: "A guided space for understanding perspectives and finding meaningful common ground.",
  icons: { icon: "/logo.png", apple: "/logo.png" }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {/* CG-NFR20: Skip to main content for keyboard/screen reader users */}
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <header className="site-header" role="banner">
            <nav aria-label="Main navigation" className="site-nav">
              <Link href="/" className="brand" aria-label="Common Ground home"><span className="brand-mark" aria-hidden="true"><Image src="/logo.png" alt="" width={44} height={44} priority /></span><span>Common Ground</span></Link>
              <AuthNav />
            </nav>
          </header>
          <main id="main-content" role="main">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
