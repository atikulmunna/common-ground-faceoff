import { getSession } from "next-auth/react";

const API_BASE = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") {
    // Server-side: no session available, return empty (public endpoints only)
    return {};
  }
  const session = await getSession();
  if (session?.user?.accessToken) {
    return { authorization: `Bearer ${session.user.accessToken}` };
  }
  return {};
}

export async function apiGet<T>(path: string, serverToken?: string): Promise<T> {
  const headers: Record<string, string> = serverToken
    ? { authorization: `Bearer ${serverToken}` }
    : await getAuthHeaders();

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, serverToken?: string): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(serverToken
      ? { authorization: `Bearer ${serverToken}` }
      : await getAuthHeaders())
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}
