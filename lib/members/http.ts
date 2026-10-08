import "server-only";
import { getMemberConfig, getMemberStore, limitMemberAttempt, privateBucket } from "./store.mjs";
import { MemberError } from "./policy.mjs";

export function memberJson(data: unknown, status = 200, headers?: HeadersInit) {
  const out = new Headers(headers);
  out.delete("Content-Length");
  out.delete("Content-Encoding");
  out.set("Cache-Control", "no-store, private");
  out.set("Vary", "Cookie");
  out.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers: out });
}

export function checkMemberWrite(request: Request, bucket: string) {
  const config = getMemberConfig();
  if (request.headers.get("origin") !== config.origin || !request.headers.get("content-type")?.startsWith("application/json")) {
    throw new MemberError("FORBIDDEN", "请求来源不可用，请刷新页面后重试。", 403);
  }
  const address = process.env.MEMBERS_TRUST_PROXY === "true" ? request.headers.get("x-real-ip") || "unknown" : "shared-untrusted";
  limitMemberAttempt(getMemberStore(), privateBucket(`request:${bucket}:${address}`), 30, 60);
}

export async function readMemberBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 16384) throw new MemberError("BODY_TOO_LARGE", "提交内容过长。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new MemberError("INVALID_BODY", "请检查填写内容。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new MemberError("BODY_TOO_LARGE", "提交内容过长。", 413); }
    chunks.push(part.value);
  }
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new MemberError("INVALID_BODY", "请检查填写内容。"); }
}

export function memberFailure(error: unknown) {
  if (error instanceof MemberError) return memberJson({ code: error.code, message: error.message }, error.status);
  const apiError = error as { body?: { code?: string }; statusCode?: number };
  if (apiError?.statusCode && apiError.statusCode < 500) return memberJson({ code: apiError.body?.code || "AUTH_FAILED", message: "操作未完成，请检查验证码或账号信息后重试。" }, apiError.statusCode);
  return memberJson({ code: "AUTH_UNAVAILABLE", message: "账号服务暂时不可用，请稍后再试。" }, 503);
}
