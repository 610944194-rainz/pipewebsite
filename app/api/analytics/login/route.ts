import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_USERNAME, createSession, validPassword } from "@/lib/analytics/auth";
import { loginAttempts } from "@/lib/analytics/store";
import { sameOrigin } from "@/lib/analytics/origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const form = await request.formData();
  const username = form.get("username");
  const password = form.get("password");
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const secret = process.env.ANALYTICS_SESSION_SECRET;
  if (!secret || secret.length < 32) return new NextResponse("管理员登录未配置", { status: 503 });
  const bucket = createHmac("sha256", secret).update(ip).digest("hex");
  let attempts: number;
  try {
    attempts = await loginAttempts(bucket);
  } catch (error) {
    console.error("Analytics login throttling failed", error);
    return new NextResponse("管理员登录暂不可用", { status: 503 });
  }
  if (attempts > 5) return new NextResponse("尝试次数过多，请15分钟后再试", { status: 429 });
  if (username !== ADMIN_USERNAME || typeof password !== "string" || !validPassword(password)) {
    return NextResponse.redirect(new URL("/admin/analytics/login?error=1", request.headers.get("origin")!), 303);
  }
  const response = NextResponse.redirect(new URL("/admin/analytics", request.headers.get("origin")!), 303);
  response.cookies.set(ADMIN_COOKIE, createSession(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/", maxAge: 7 * 24 * 60 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
