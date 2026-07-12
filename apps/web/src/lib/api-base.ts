const LOCAL_API_BASE_URL = "http://localhost:4100";

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getPublicApiBaseUrl(): string {
  return withoutTrailingSlash(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? LOCAL_API_BASE_URL,
  );
}

export function getServerApiBaseUrl(): string {
  return withoutTrailingSlash(
    process.env.API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      LOCAL_API_BASE_URL,
  );
}

export function getApiBaseUrl(): string {
  return typeof window === "undefined"
    ? getServerApiBaseUrl()
    : getPublicApiBaseUrl();
}
