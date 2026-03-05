"use client";

import { SessionProvider, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { SessionTimeout } from "./session-timeout";

function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  return (
    <>
      {session && <SessionTimeout />}
      {children}
    </>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthGuard>{children}</AuthGuard>
    </SessionProvider>
  );
}
