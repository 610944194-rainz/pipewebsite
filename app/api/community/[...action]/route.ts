import { randomUUID } from "node:crypto";
import { getMemberSession } from "@/lib/members/auth";
import { memberJson, memberFailure, checkMemberWrite, readMemberBody } from "@/lib/members/http";
import { getMemberStore, limitMemberAttempt, privateBucket } from "@/lib/members/store.mjs";
import { getBlend, storedBlend, resolveFavorite, type FavoriteItem } from "@/lib/members/catalog";
import { transaction, saveFavorite, validateText, audit } from "@/lib/members/community-store.mjs";
import { MemberError } from "@/lib/members/policy.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string[] }> };
const pageNumber = (url: URL) => Math.min(10000, Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
const visible = "c.status='published' AND p.status='active' AND p.identity_status='verified' AND u.emailVerified=1";

export async function GET(request: Request, context: Context) {
  try {
    const action = (await context.params).action.join("/");
    if (!["favorites", "comments", "my-comments"].includes(action)) return memberJson({ message: "页面不存在。" }, 404);
    const url = new URL(request.url), page = pageNumber(url), offset = (page - 1) * 20;
    const db = getMemberStore();
    if (action === "comments") {
      const blend = getBlend(url.searchParams.get("blendId"));
      const joins = "FROM member_comments c JOIN member_profiles p ON p.user_id=c.user_id JOIN user u ON u.id=c.user_id";
      const rows = db.prepare(`SELECT c.id,c.content,c.created_at AS createdAt,u.name AS author ${joins} WHERE c.blend_id=? AND ${visible} ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ?`).all(blend.id, offset);
      const total = db.prepare(`SELECT count(*) AS n ${joins} WHERE c.blend_id=? AND ${visible}`).get(blend.id)?.n;
      return memberJson({ comments: rows, total, page, blendId: blend.id });
    }
    const member = await getMemberSession(request.headers);
    if (!member) throw new MemberError("UNAUTHORIZED", "请先登录。", 401);
    if (action === "my-comments") {
      const rows = db.prepare("SELECT id,blend_id AS blendId,blend_title AS savedTitle,content,status,reason,created_at AS createdAt FROM member_comments WHERE user_id=? AND status<>'deleted' ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?").all(member.user.id, offset);
      return memberJson({ comments: rows.map((row: Record<string, unknown>) => { const blend = storedBlend(row.blendId, row.savedTitle); return { ...row, title: blend.title, href: blend.href }; }), total: db.prepare("SELECT count(*) AS n FROM member_comments WHERE user_id=? AND status<>'deleted'").get(member.user.id)?.n, page });
    }
    const id = url.searchParams.get("productId");
    if (id) {
      const kind = url.searchParams.get("kind");
      const product = resolveFavorite(id, kind);
      const key = product?.productKey || `${kind}:${id}`;
      return memberJson({ saved: !!db.prepare("SELECT 1 FROM member_favorites WHERE user_id=? AND product_key=?").get(member.user.id, key) });
    }
    const rows = db.prepare("SELECT product_id,kind,snapshot,created_at FROM member_favorites WHERE user_id=? ORDER BY created_at DESC,product_key LIMIT 20 OFFSET ?").all(member.user.id, offset);
    return memberJson({ favorites: rows.map((row: Record<string, unknown>) => {
      const snapshot = JSON.parse(String(row.snapshot)) as FavoriteItem;
      const live = resolveFavorite(row.product_id, row.kind);
      return { ...(live || { ...snapshot, href: "", availability: "unavailable" }), savedAt: row.created_at };
    }), total: db.prepare("SELECT count(*) AS n FROM member_favorites WHERE user_id=?").get(member.user.id)?.n, page });
  } catch (error) { return memberFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const action = (await context.params).action.join("/");
    if (!["favorites", "comments", "comments/delete", "reports", "appeals"].includes(action)) return memberJson({ message: "页面不存在。" }, 404);
    checkMemberWrite(request, `community:${action}`);
    const body = await readMemberBody(request);
    const member = await getMemberSession(request.headers);
    if (!member) throw new MemberError("UNAUTHORIZED", "请先登录。", 401);
    const db = getMemberStore(), userId = member.user.id;
    if (action === "favorites") {
      if (typeof body.save !== "boolean") throw new MemberError("INVALID_BODY", "请选择收藏操作。");
      const product = resolveFavorite(body.productId, body.kind);
      if (!product && body.save) throw new MemberError("NOT_FOUND", "烟斗已下架，不能新增收藏。", 404);
      saveFavorite(db, userId, product || { productKey: `${body.kind}:${body.productId}` }, body.save);
      return memberJson({ success: true, saved: body.save });
    }
    if (action === "comments") {
      const blend = getBlend(body.blendId), content = validateText(body.content);
      limitMemberAttempt(db, privateBucket(`comment-minute:${userId}`), 3, 60);
      limitMemberAttempt(db, privateBucket(`comment-day:${userId}`), 20, 86400);
      const contentHash = privateBucket(`${userId}:${blend.id}:${content}`), id = randomUUID(), now = new Date().toISOString();
      transaction(db, () => {
        const profile = db.prepare("SELECT status,comment_muted FROM member_profiles WHERE user_id=?").get(userId);
        if (!profile || profile.status !== "active" || profile.comment_muted) throw new MemberError("COMMENT_DISABLED", "账号暂不可留言，请联系站方。", 403);
        if (db.prepare("SELECT 1 FROM member_comments WHERE user_id=? AND content_hash=? AND created_at>? AND status<>'deleted'").get(userId, contentHash, new Date(Date.now() - 300000).toISOString())) throw new MemberError("DUPLICATE_COMMENT", "相同留言已提交，请等待审核。", 409);
        db.prepare("INSERT INTO member_comments(id,user_id,blend_id,content,content_hash,created_at,updated_at,blend_title) VALUES(?,?,?,?,?,?,?,?)").run(id, userId, blend.id, content, contentHash, now, now, blend.title);
        audit(db, userId, "comment.submit", id, "", { blendId: blend.id });
      });
      return memberJson({ success: true, id, status: "pending", message: "留言已提交，等待站方审核。" }, 201);
    }
    if (typeof body.id !== "string") throw new MemberError("INVALID_BODY", "请选择留言。");
    if (action === "comments/delete") {
      transaction(db, () => {
        const row = db.prepare("SELECT id FROM member_comments WHERE id=? AND user_id=? AND status<>'deleted'").get(body.id as string, userId);
        if (!row) throw new MemberError("NOT_FOUND", "留言不存在。", 404);
        db.prepare("UPDATE member_comments SET content='',content_hash='',status='deleted',reason=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), body.id as string);
        audit(db, userId, "comment.withdraw", body.id as string);
      });
      return memberJson({ success: true });
    }
    const reason = validateText(body.reason, action === "appeals" ? "申诉说明" : "举报原因", 3, 300);
    limitMemberAttempt(db, privateBucket(`reports:${userId}`), 5, 86400);
    transaction(db, () => {
      const row = db.prepare("SELECT c.user_id,c.status,p.identity_status,p.status AS member_status FROM member_comments c JOIN member_profiles p ON p.user_id=c.user_id WHERE c.id=?").get(body.id as string);
      const appeal = action === "appeals";
      if (!row || (appeal ? row.user_id !== userId || !["rejected", "hidden"].includes(String(row.status)) : row.status !== "published" || row.identity_status !== "verified" || row.member_status !== "active")) throw new MemberError("NOT_FOUND", "该留言暂不可反馈。", 404);
      const kind = appeal ? "appeal" : "report";
      if (db.prepare("SELECT 1 FROM member_reports WHERE comment_id=? AND user_id=? AND kind=?").get(body.id as string, userId, kind)) throw new MemberError("DUPLICATE_REPORT", "反馈已提交，请等待处理。", 409);
      db.prepare("INSERT INTO member_reports(id,comment_id,user_id,kind,reason,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), body.id as string, userId, kind, reason, new Date().toISOString());
      audit(db, userId, appeal ? "comment.appeal" : "comment.report", body.id as string);
    });
    return memberJson({ success: true, message: "反馈已提交，站方会尽快处理。" }, 201);
  } catch (error) { return memberFailure(error); }
}
