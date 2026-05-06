export function normalizeDatabaseUrl(rawUrl: string) {
  const url = new URL(rawUrl);

  if (!url.searchParams.get("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }

  if (!url.searchParams.get("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}
