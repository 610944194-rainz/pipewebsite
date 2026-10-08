import { getMemberAuth, getMemberSession } from "@/lib/members/auth";
import { checkMemberWrite, memberFailure, memberJson, readMemberBody } from "@/lib/members/http";
import { getMemberStore, limitMemberAttempt, privateBucket } from "@/lib/members/store.mjs";
import { requireMemberMail, withMemberMail } from "@/lib/members/mail.mjs";
import { MemberError, normalizeEmail, validateNickname, validatePassword } from "@/lib/members/policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowed = new Set([
  "sign-in/email", "sign-out", "change-password", "update-user",
  "email-otp/request-password-reset", "email-otp/reset-password",
  "email-otp/send-verification-otp", "email-otp/request-email-change", "email-otp/change-email",
]);
const publicActions = new Set(["sign-in/email", "sign-out", "email-otp/request-password-reset", "email-otp/reset-password"]);

export async function GET() { return memberJson({ message: "页面不存在。" }, 404); }

export async function POST(request: Request, context: { params: Promise<{ all: string[] }> }) {
  const path = (await context.params).all.join("/");
  if (!allowed.has(path)) return memberJson({ message: "页面不存在。" }, 404);
  try {
    checkMemberWrite(request, path);
    const body = await readMemberBody(request);
    delete body.callbackURL;
    delete body.redirectTo;
    if ("email" in body) body.email = normalizeEmail(body.email);
    if ("newEmail" in body) body.newEmail = normalizeEmail(body.newEmail);
    if (path === "sign-in/email" || path === "email-otp/reset-password") {
      const email = String(body.email);
      limitMemberAttempt(getMemberStore(), privateBucket(`auth:${path}:${email}`), 10, 600);
    }
    if (path === "change-password") { validatePassword(body.newPassword); body.revokeOtherSessions = true; }
    if (path === "email-otp/reset-password") validatePassword(body.password);
    if (path === "update-user") {
      body.name = validateNickname(body.name);
      if (Object.keys(body).some((key) => key !== "name")) throw new MemberError("INVALID_BODY", "只能修改昵称。");
    }
    const member = publicActions.has(path) ? null : await getMemberSession(request.headers);
    if (!publicActions.has(path) && !member) throw new MemberError("UNAUTHORIZED", "请先登录。", 401);
    if (path === "email-otp/send-verification-otp") {
      if (body.type !== "email-verification" || body.email !== member?.user.email) throw new MemberError("FORBIDDEN", "只能验证当前账号邮箱。", 403);
    }
    if (["email-otp/request-password-reset", "email-otp/send-verification-otp", "email-otp/request-email-change"].includes(path)) requireMemberMail();
    const auth = await getMemberAuth();
    const forwarded = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) });
    const response = await withMemberMail(() => auth.handler(forwarded));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return memberJson({ code: payload.code || "AUTH_FAILED", message: errorMessage(payload.code) }, response.status, response.headers);
    if (path === "email-otp/change-email" && member) {
      getMemberStore().prepare('DELETE FROM session WHERE "userId"=? AND id<>?').run(member.user.id, member.session.id);
    }
    if (["change-password", "email-otp/reset-password"].includes(path)) {
      const userId = member?.user.id || getMemberStore().prepare('SELECT id FROM user WHERE email=?').get(String(body.email))?.id;
      if (userId) getMemberStore().prepare("DELETE FROM member_admin_grants WHERE user_id=?").run(String(userId));
      if (path === "change-password" && member) getMemberStore().prepare("DELETE FROM verification WHERE identifier=?").run(`forget-password-otp-${member.user.email}`);
    }
    // Browser-facing JSON never contains a bearer session token.
    delete payload.token;
    return memberJson(payload, response.status, response.headers);
  } catch (error) { return memberFailure(error); }
}

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确。", INVALID_PASSWORD: "当前密码不正确。",
    INVALID_OTP: "验证码不正确或已使用，请检查后重试。", OTP_EXPIRED: "验证码已过期，请重新获取。",
    TOO_MANY_ATTEMPTS: "验证码尝试次数已用尽，请稍后重新获取。",
    SESSION_EXPIRED: "登录已过期，请重新登录。", EMAIL_NOT_VERIFIED: "请先完成邮箱验证。",
    EMAIL_QUOTA_EXHAUSTED: "验证邮件发送额度暂时用尽，请稍后再试。",
  };
  return messages[code] || "操作未完成，请检查账号信息或验证码后重试。";
}
