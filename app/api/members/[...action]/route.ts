import { getMemberAuth, getMemberSession } from "@/lib/members/auth";
import { checkMemberWrite, memberFailure, memberJson, readMemberBody } from "@/lib/members/http";
import { getMemberConfig, getMemberStore, limitMemberAttempt, privateBucket } from "@/lib/members/store.mjs";
import { requireMemberMail, withMemberMail } from "@/lib/members/mail.mjs";
import { MemberError, normalizeEmail, validateNickname, validatePassword } from "@/lib/members/policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ action: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  const action = (await context.params).action.join("/");
  try {
    if (action === "status") {
      let ready = false;
      let mailReady = false;
      try { const config = getMemberConfig(); ready = true; requireMemberMail(config); mailReady = true; } catch {}
      return memberJson({ ready, mailReady });
    }
    if (!["session", "sessions"].includes(action)) return memberJson({ message: "页面不存在。" }, 404);
    const member = await getMemberSession(request.headers);
    if (!member) return memberJson({ user: null }, action === "session" ? 200 : 401);
    if (action === "session") return memberJson({ user: {
      id: member.user.id, name: member.user.name, email: member.user.email,
      emailVerified: member.user.emailVerified, createdAt: member.user.createdAt,
      identityStatus: member.profile.identity_status,
      role: member.profile.role,
    } });
    const rows = getMemberStore().prepare('SELECT id,"createdAt","expiresAt","userAgent" FROM session WHERE "userId"=? AND "expiresAt">? ORDER BY "createdAt" DESC').all(member.user.id, Date.now()) as Record<string, unknown>[];
    return memberJson({ sessions: rows.map((row) => ({ ...row, current: row.id === member.session.id })) });
  } catch (error) {
    if (action === "session") return memberJson({ user: null, available: false });
    return memberFailure(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const action = (await context.params).action.join("/");
  try {
    if (!["registration/code", "registration", "sessions/revoke", "sessions/revoke-all"].includes(action)) return memberJson({ message: "页面不存在。" }, 404);
    checkMemberWrite(request, action);
    const body = await readMemberBody(request);
    const auth = await getMemberAuth();
    const db = getMemberStore();
    if (action === "registration/code") {
      requireMemberMail();
      const email = normalizeEmail(body.email);
      limitMemberAttempt(db, privateBucket(`registration-code:${email}`), 1, 60);
      // Identical response for an existing address; never create an unverified account.
      const existing = db.prepare('SELECT id FROM "user" WHERE email=?').get(email);
      if (!existing) await withMemberMail(() => auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } }));
      return memberJson({ success: true, message: "若该邮箱可注册，验证码将发送至你的邮箱。" });
    }
    if (action === "registration") {
      const email = normalizeEmail(body.email);
      const name = validateNickname(body.name);
      const password = validatePassword(body.password);
      if (body.termsAccepted !== true) throw new MemberError("TERMS_REQUIRED", "请先阅读并同意服务协议和隐私说明。");
      if (typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp)) throw new MemberError("INVALID_OTP", "请输入 6 位邮箱验证码。");
      limitMemberAttempt(db, privateBucket(`registration-attempt:${email}`), 10, 600);
      if (db.prepare('SELECT id FROM "user" WHERE email=?').get(email)) throw new MemberError("REGISTRATION_FAILED", "无法完成注册，请检查验证码，或使用登录和找回密码。");
      const result = await auth.api.signInEmailOTP({ body: { email, name, otp: body.otp }, headers: request.headers, returnHeaders: true });
      const sessionHeaders = new Headers(request.headers);
      sessionHeaders.delete("cookie");
      sessionHeaders.set("cookie", result.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "));
      try {
        await auth.api.setPassword({ body: { newPassword: password }, headers: sessionHeaders });
        db.prepare("UPDATE member_profiles SET terms_version=?,terms_accepted_at=? WHERE user_id=?").run("2026-10-06-v1", new Date().toISOString(), result.response.user.id);
      } catch (error) {
        // A partially created account can be recovered through the verified mailbox; no session is returned.
        db.prepare('DELETE FROM session WHERE "userId"=?').run(result.response.user.id);
        throw error;
      }
      return memberJson({ success: true }, 201, result.headers);
    }
    const member = await getMemberSession(request.headers);
    if (!member) throw new MemberError("UNAUTHORIZED", "请先登录。", 401);
    if (action === "sessions/revoke-all") {
      await auth.api.revokeSessions({ headers: request.headers });
      return memberJson({ success: true });
    }
    if (typeof body.id !== "string") throw new MemberError("INVALID_SESSION", "请选择要退出的设备。");
    const target = db.prepare('SELECT token FROM session WHERE id=? AND "userId"=?').get(body.id, member.user.id);
    if (!target) throw new MemberError("NOT_FOUND", "该登录记录已失效。", 404);
    await auth.api.revokeSession({ body: { token: String(target.token) }, headers: request.headers });
    return memberJson({ success: true });
  } catch (error) { return memberFailure(error); }
}
