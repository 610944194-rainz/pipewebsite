import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "yd_analytics_admin";
export const ADMIN_USERNAME = "admin";

function signature(value: string) {
  const secret = process.env.ANALYTICS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Analytics session secret is not configured");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function validPassword(input: string) {
  const expected = process.env.ANALYTICS_ADMIN_PASSWORD;
  if (!expected || expected.length < 8) return false;
  const a = createHmac("sha256", "yd-password-check").update(input).digest();
  const b = createHmac("sha256", "yd-password-check").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createSession() {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const value = String(expiry);
  return `${value}.${signature(value)}`;
}

export function validSession(token?: string) {
  if (!token) return false;
  const [expiry, supplied, extra] = token.split(".");
  if (extra || !/^\d{13}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  if (Number(expiry) <= Date.now() || Number(expiry) > Date.now() + 7 * 24 * 60 * 60 * 1000) return false;
  try {
    return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(expiry), "hex"));
  } catch {
    return false;
  }
}

export async function isAdmin() {
  return validSession((await cookies()).get(ADMIN_COOKIE)?.value);
}
