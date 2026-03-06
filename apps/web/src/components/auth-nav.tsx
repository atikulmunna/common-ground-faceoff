"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function AuthNav() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (session?.user) {
    return (
      <nav style={{ display: "flex", gap: "0.8rem", alignItems: "center" }}>
        <Link href="/">Dashboard</Link>
        <Link href="/create">Create Session</Link>
        {session.user.role === "institutional_admin" && <Link href={"/admin" as never}>Admin</Link>}
        <Link href="/profile">Profile</Link>
        <span style={{ color: "#475569" }}>{session.user.email}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/sign-in" })}
          style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
        >
          Sign Out
        </button>
      </nav>
    );
  }

  return (
    <nav style={{ display: "flex", gap: "0.8rem" }}>
      <Link href="/">Dashboard</Link>
      <Link href="/sign-in">Sign In</Link>
    </nav>
  );
}
