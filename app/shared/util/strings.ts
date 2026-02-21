export function sanitize(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
}

export function shorten(s: string) {
  if (!s) return s;
  return s.length > 48 ? s.slice(0, 22) + "…" + s.slice(-22) : s;
}

