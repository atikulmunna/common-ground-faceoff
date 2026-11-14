import "./globals.css";
import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Bricolage_Grotesque } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthProvider } from "../components/auth-provider";
import { AuthNav } from "../components/auth-nav";
import { BrandMark } from "../components/brand-mark";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-display",
  display: "swap",
});

const body = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  // Link previews need absolute image URLs; NEXTAUTH_URL is already the site's public address.
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000"),
  title: "Common Ground: find the ground you share",
  description: "Everyone writes what they think. Common Ground restates each view fairly, then shows what you share and where you really differ.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <AuthProvider>
          {/* CG-NFR20: Skip to main content for keyboard/screen reader users */}
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <header className="site-header" role="banner">
            <nav aria-label="Main navigation" className="site-nav">
              <Link href="/" className="brand" aria-label="Common Ground home">
                <BrandMark />
                <span>Common Ground</span>
              </Link>
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
