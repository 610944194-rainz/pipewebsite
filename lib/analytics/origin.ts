import "server-only";

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.slice(0, -1);
    return parsed.host === host && parsed.protocol === `${proto}:`;
  } catch {
    return false;
  }
}
