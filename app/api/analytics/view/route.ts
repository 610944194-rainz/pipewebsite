import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, validSession } from "@/lib/analytics/auth";
import { recordView } from "@/lib/analytics/store";
import { sameOrigin } from "@/lib/analytics/origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  if (validSession(request.cookies.get(ADMIN_COOKIE)?.value)) return new NextResponse(null, { status: 204 });

  let path: unknown;
  try {
    ({ path } = await request.json());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof path !== "string" || !/^\/(?!\/)[^?#]{0,300}$/.test(path) || path.startsWith("/admin") || path.startsWith("/api/")) {
    return new NextResponse(null, { status: 400 });
  }

  const previous = request.cookies.get("yd_visitor")?.value;
  const visitor = previous && /^[a-f0-9]{32}$/.test(previous) ? previous : randomBytes(16).toString("hex");
  try {
    await recordView(path, visitor);
  } catch (error) {
    console.error("Analytics record failed", error);
    return new NextResponse(null, { status: 503 });
  }
  const response = new NextResponse(null, { status: 204 });
  if (visitor !== previous) {
    response.cookies.set("yd_visitor", visitor, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 365 * 24 * 60 * 60,
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
