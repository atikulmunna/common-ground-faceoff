"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function AuthNav() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (session?.user) {
    const initials = (session.user.name ?? session.user.email ?? "User")
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    return (
      <nav className="auth-nav" aria-label="Account navigation">
        <Link href="/">Conversations</Link>
        <Link href="/create" className="nav-primary">New conversation</Link>
        <details className="user-menu">
          <summary aria-label="Open account menu"><span className="user-avatar" aria-hidden="true">{initials}</span></summary>
          <div className="user-menu__panel">
            <div className="user-menu__identity"><strong>{session.user.name ?? "Your account"}</strong><span>{session.user.email}</span></div>
            <Link href="/profile">Profile and settings</Link>
            {session.user.role === "institutional_admin" && <Link href={"/admin" as never}>Administration</Link>}
            <button onClick={() => signOut({ callbackUrl: "/sign-in" })}>Sign out</button>
          </div>
        </details>
      </nav>
    );
  }

  return (
    <nav className="auth-nav" aria-label="Account navigation">
      <Link href="/#how-it-works">How it works</Link>
      <Link href="/sign-in" className="nav-primary">Sign in</Link>
    </nav>
  );
}
