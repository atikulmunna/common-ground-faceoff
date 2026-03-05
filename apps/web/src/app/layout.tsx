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
          <main>
            <header className="card" style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
                <strong>Common Ground MVP</strong>
                <AuthNav />
              </div>
            </header>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
