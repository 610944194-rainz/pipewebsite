import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, validSession } from "@/lib/analytics/auth";
import { sameOrigin } from "@/lib/analytics/origin";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request) || !validSession(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return new NextResponse(null, { status: 403 });
  }
  const response = NextResponse.redirect(new URL("/admin/analytics/login", request.headers.get("origin")!), 303);
  response.cookies.delete(ADMIN_COOKIE);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
