import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "../components/auth-provider";
import { AuthNav } from "../components/auth-nav";

export const metadata: Metadata = {
  title: "Common Ground MVP",
  description: "AI-powered debate and perspective alignment tool"
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
          <header className="card site-header" role="banner" style={{ marginBottom: "1rem" }}>
            <nav aria-label="Main navigation" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <strong>Common Ground MVP</strong>
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
