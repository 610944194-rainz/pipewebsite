export type MemberUser = { id: string; name: string; email: string; emailVerified: boolean; createdAt: string; identityStatus: string; role?: string };

export async function memberRequest<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "暂时无法完成，请稍后再试。");
  return result;
}
