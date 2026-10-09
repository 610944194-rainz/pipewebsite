import { hashPassword, verifyPassword } from "better-auth/crypto";
import { requireAdmin } from "@/lib/members/admin";
import { memberJson, memberFailure, checkMemberWrite, readMemberBody } from "@/lib/members/http";
import { getMemberConfig, getMemberStore, privateBucket, limitMemberAttempt } from "@/lib/members/store.mjs";
import { validatePassword, MemberError } from "@/lib/members/policy.mjs";
import { adminMfaRequired, adminGrantUntil, validateText, manageMember, moderateComment, resolveReport } from "@/lib/members/community-store.mjs";
import { storedBlend } from "@/lib/members/catalog";
import { adminFactorStatus, beginAdminFactor, confirmAdminFactor, verifyAdminFactor, verifyAdminPassword, rotateAdminRecovery } from "@/lib/members/admin-security.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string[] }> };
const memberRoles = ["owner", "site_admin"];

export async function GET(request: Request, context: Context) {
  try {
    const action = (await context.params).action.join("/");
    if (!["me", "members", "comments", "reports", "audit"].includes(action)) return memberJson({ message: "页面不存在。" }, 404);
    const { member, actor, role } = await requireAdmin(request.headers, action !== "me");
    const db = getMemberStore(), url = new URL(request.url);
    if (["members", "audit"].includes(action) && !memberRoles.includes(role)) throw new MemberError("FORBIDDEN", "你没有会员管理权限。", 403);
    if (action === "me") return memberJson({ name: member.user.name, role, ...adminFactorStatus(db, actor), grantUntil: adminGrantUntil(db, actor) });
    const page = Math.min(10000, Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1)), offset = (page - 1) * 20;
    const query = (url.searchParams.get("q") || "").trim().slice(0, 100), status = url.searchParams.get("status") || "";
    if (action === "members") {
      const filter = "WHERE p.status<>'deleted' AND (u.name LIKE ? OR u.email LIKE ?) AND (?='' OR p.status=?)";
      const args = [`%${query}%`, `%${query}%`, status, status];
      return memberJson({ rows: db.prepare(`SELECT u.id,u.name,u.email,u.createdAt AS createdAt,p.role,p.status,p.identity_status AS identityStatus,p.identity_channel AS identityChannel,p.comment_muted AS muted FROM user u JOIN member_profiles p ON p.user_id=u.id ${filter} ORDER BY u.createdAt DESC,u.id LIMIT 20 OFFSET ?`).all(...args, offset), total: db.prepare(`SELECT count(*) AS n FROM user u JOIN member_profiles p ON p.user_id=u.id ${filter}`).get(...args)?.n, page });
    }
    if (action === "comments") {
      const filter = "WHERE c.status<>'deleted' AND (?='' OR c.status=?) AND (c.content LIKE ? OR u.name LIKE ?)";
      const args = [status, status, `%${query}%`, `%${query}%`];
      const from = "FROM member_comments c JOIN user u ON u.id=c.user_id JOIN member_profiles p ON p.user_id=c.user_id";
      const rows = db.prepare(`SELECT c.id,c.content,c.blend_id AS blendId,c.blend_title AS savedTitle,c.status,c.reason,c.created_at AS createdAt,u.name AS author,p.identity_status AS identityStatus,p.status AS memberStatus ${from} ${filter} ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ?`).all(...args, offset);
      return memberJson({ rows: rows.map((row: Record<string, unknown>) => { const blend = storedBlend(row.blendId, row.savedTitle); return { ...row, blendTitle: blend.title, href: blend.href }; }), total: db.prepare(`SELECT count(*) AS n ${from} ${filter}`).get(...args)?.n, page });
    }
    if (action === "reports") {
      const filter = "WHERE (?='' OR r.status=?)";
      return memberJson({ rows: db.prepare(`SELECT r.id,r.comment_id AS commentId,r.kind,r.reason,r.status,r.resolution,r.created_at AS createdAt,u.name AS author,c.content,c.status AS commentStatus FROM member_reports r JOIN user u ON u.id=r.user_id JOIN member_comments c ON c.id=r.comment_id ${filter} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`).all(status, status, offset), total: db.prepare(`SELECT count(*) AS n FROM member_reports r ${filter}`).get(status, status)?.n, page });
    }
    return memberJson({ rows: db.prepare("SELECT a.id,a.action,a.target_id AS targetId,a.reason,a.details,a.created_at AS createdAt,COALESCE(u.name,'系统') AS actor FROM member_audit a LEFT JOIN user u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?").all(offset), total: db.prepare("SELECT count(*) AS n FROM member_audit").get()?.n, page });
  } catch (error) { return memberFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const action = (await context.params).action.join("/");
    if (!["reauth", "factor/setup", "factor/confirm", "factor/recovery", "members", "comments", "reports"].includes(action)) return memberJson({ message: "页面不存在。" }, 404);
    checkMemberWrite(request, `admin:${action}`);
    const body = await readMemberBody(request), db = getMemberStore();
    const securityAction = ["reauth", "factor/setup", "factor/confirm", "factor/recovery"].includes(action);
    const { member, actor, role } = await requireAdmin(request.headers, !securityAction || action === "factor/recovery");
    if (action.startsWith("factor/") && !adminMfaRequired()) throw new MemberError("FACTOR_DISABLED", "验证器功能暂未启用。", 409);
    if (action === "members" && !memberRoles.includes(role)) throw new MemberError("FORBIDDEN", "你没有会员管理权限。", 403);
    if (securityAction) {
      limitMemberAttempt(db, privateBucket(`admin-reauth:${actor.id}`), 5, 300);
      const password = typeof body.password === "string" && body.password.length <= 128 ? body.password : "";
      const account = db.prepare('SELECT password FROM account WHERE "userId"=? AND "providerId"=\'credential\'').get(actor.id);
      if (!account || typeof account.password !== "string" || !await verifyPassword({ hash: account.password, password })) throw new MemberError("INVALID_PASSWORD", "管理员密码不正确。", 401);
      if (action === "reauth" && !adminMfaRequired()) return memberJson(verifyAdminPassword(db, actor, account.password));
      const secret = getMemberConfig().secret;
      if (action === "factor/setup") return memberJson(beginAdminFactor(db, actor, secret, member.user.email, Date.now(), account.password));
      if (action === "factor/confirm") return memberJson(await confirmAdminFactor(db, actor, secret, body.code, account.password));
      if (action === "factor/recovery") return memberJson(rotateAdminRecovery(db, actor, secret, account.password));
      return memberJson(await verifyAdminFactor(db, actor, secret, body.code, body.recoveryCode, account.password));
    }
    const reason = validateText(body.reason, "操作原因", 3, 200);
    if (action === "members") {
      if (typeof body.id !== "string" || typeof body.operation !== "string") throw new MemberError("INVALID_BODY", "请选择会员和操作。");
      let passwordHash;
      if (body.operation === "password") passwordHash = await hashPassword(validatePassword(body.password));
      manageMember(db, actor, { targetId: body.id, operation: body.operation, value: body.value, channel: body.channel, reason, passwordHash });
    } else if (action === "comments") {
      if (typeof body.id !== "string" || typeof body.status !== "string") throw new MemberError("INVALID_BODY", "请选择留言和操作。");
      moderateComment(db, actor, { id: body.id, status: body.status, reason });
    } else {
      if (typeof body.id !== "string") throw new MemberError("INVALID_BODY", "请选择反馈。");
      resolveReport(db, actor, { id: body.id, resolution: reason });
    }
    return memberJson({ success: true });
  } catch (error) { return memberFailure(error); }
}
