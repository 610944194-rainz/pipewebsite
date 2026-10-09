import { randomUUID } from "node:crypto";
import { MemberError } from "./policy.mjs";

export const staffRoles = ["moderator", "site_admin", "owner"];

export function adminMfaRequired() {
  return process.env.MEMBERS_ADMIN_MFA_ENABLED === "true";
}

export function adminGrantUntil(db, actor, now = Date.now()) {
  const mfa = adminMfaRequired();
  if (mfa && !db.prepare("SELECT 1 FROM member_admin_factors WHERE user_id=? AND enabled=1").get(actor.id)) return 0;
  return db.prepare("SELECT expires_at FROM member_admin_grants WHERE session_id=? AND user_id=? AND expires_at>? AND (?=0 OR factor_verified=1)").get(actor.sessionId, actor.id, now, mfa ? 1 : 0)?.expires_at || 0;
}

export function initializeCommunity(db) {
  const columns = db.prepare("PRAGMA table_info(member_profiles)").all();
  if (!columns.some((column) => column.name === "comment_muted")) db.exec("ALTER TABLE member_profiles ADD COLUMN comment_muted INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_favorites (
      user_id TEXT NOT NULL, product_key TEXT NOT NULL, kind TEXT NOT NULL,
      product_id TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,product_key)
    );
    CREATE TABLE IF NOT EXISTS member_comments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, blend_id TEXT NOT NULL,
      content TEXT NOT NULL, content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', reason TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      reviewed_by TEXT, reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS member_comment_blend_idx ON member_comments(blend_id,status,created_at,id);
    CREATE INDEX IF NOT EXISTS member_comment_user_idx ON member_comments(user_id,created_at);
    CREATE TABLE IF NOT EXISTS member_reports (
      id TEXT PRIMARY KEY, comment_id TEXT NOT NULL, user_id TEXT NOT NULL,
      kind TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT,
      UNIQUE(comment_id,user_id,kind)
    );
    CREATE INDEX IF NOT EXISTS member_report_status_idx ON member_reports(status,created_at);
    CREATE TABLE IF NOT EXISTS member_admin_grants (
      session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_audit (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS member_audit_date_idx ON member_audit(created_at);
  `);
  const commentColumns = db.prepare("PRAGMA table_info(member_comments)").all();
  if (!commentColumns.some((column) => column.name === "blend_title")) db.exec("ALTER TABLE member_comments ADD COLUMN blend_title TEXT NOT NULL DEFAULT ''");
}

export function transaction(db, run) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = run(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function audit(db, actorId, action, targetId, reason = "", details = {}) {
  db.prepare("INSERT INTO member_audit VALUES(?,?,?,?,?,?,?)").run(randomUUID(), actorId, action, targetId, reason, JSON.stringify(details), new Date().toISOString());
}

export function validateText(value, label = "留言", minimum = 3, maximum = 2000) {
  if (typeof value !== "string") throw new MemberError("INVALID_TEXT", `请填写${label}。`);
  const text = value.trim().replace(/\r\n?/g, "\n");
  if ([...text].length < minimum || [...text].length > maximum || /\p{C}/u.test(text.replace(/[\n\t]/g, ""))) throw new MemberError("INVALID_TEXT", `${label}需为 ${minimum}～${maximum} 个字符。`);
  return text;
}

export function saveFavorite(db, userId, item, save) {
  return transaction(db, () => {
    if (!save) { db.prepare("DELETE FROM member_favorites WHERE user_id=? AND product_key=?").run(userId, item.productKey); return; }
    const existing = db.prepare("SELECT 1 FROM member_favorites WHERE user_id=? AND product_key=?").get(userId, item.productKey);
    if (!existing && db.prepare("SELECT count(*) AS n FROM member_favorites WHERE user_id=?").get(userId).n >= 500) throw new MemberError("FAVORITE_LIMIT", "最多可收藏 500 只烟斗。");
    db.prepare("INSERT INTO member_favorites VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,product_key) DO UPDATE SET snapshot=excluded.snapshot").run(userId, item.productKey, item.kind, item.productId, JSON.stringify(item), new Date().toISOString());
  });
}

export function adminActor(db, actor, grantRequired = true) {
  const profile = db.prepare("SELECT * FROM member_profiles WHERE user_id=?").get(actor.id);
  const session = db.prepare('SELECT 1 FROM session WHERE id=? AND "userId"=? AND "expiresAt">?').get(actor.sessionId, actor.id, Date.now());
  if (!session || !profile || profile.status !== "active" || !staffRoles.includes(profile.role)) throw new MemberError("FORBIDDEN", "你没有后台管理权限。", 403);
  if (grantRequired && !adminGrantUntil(db, actor)) throw new MemberError("REAUTH_REQUIRED", adminMfaRequired() ? "请先验证管理员密码和验证器。" : "请先验证管理员密码。", 401);
  return profile;
}

function manageableTarget(db, actor, actorProfile, targetId) {
  const target = db.prepare('SELECT p.*,u.email FROM member_profiles p JOIN user u ON u.id=p.user_id WHERE p.user_id=?').get(targetId);
  if (!target || target.status === "deleted") throw new MemberError("NOT_FOUND", "会员不存在。", 404);
  if (targetId === actor.id || target.role === "owner" || (actorProfile.role !== "owner" && target.role !== "member")) throw new MemberError("PROTECTED_MEMBER", "不能修改自己、站长或权限不低于自己的账号。", 403);
  return target;
}

export function manageMember(db, actor, { targetId, operation, value, channel, reason, passwordHash }) {
  return transaction(db, () => {
    const profile = adminActor(db, actor);
    if (!["owner", "site_admin"].includes(profile.role)) throw new MemberError("FORBIDDEN", "你没有会员管理权限。", 403);
    const target = manageableTarget(db, actor, profile, targetId);
    const now = new Date().toISOString();
    if (operation === "status") {
      if (!["active", "banned"].includes(value)) throw new MemberError("INVALID_STATUS", "请选择正常或封禁。");
      db.prepare("UPDATE member_profiles SET status=? WHERE user_id=?").run(value, targetId);
      if (value === "banned") {
        db.prepare('DELETE FROM session WHERE "userId"=?').run(targetId);
        db.prepare("UPDATE member_comments SET status='hidden',reason=?,updated_at=? WHERE user_id=? AND status='published'").run("账号封禁，需重新审核。", now, targetId);
      }
    } else if (operation === "mute") {
      if (typeof value !== "boolean") throw new MemberError("INVALID_STATUS", "请选择是否禁言。");
      db.prepare("UPDATE member_profiles SET comment_muted=? WHERE user_id=?").run(value ? 1 : 0, targetId);
    } else if (operation === "identity") {
      if (!["unrecorded", "verified", "rejected"].includes(value)) throw new MemberError("INVALID_IDENTITY", "请选择核验状态。");
      const checkedChannel = value === "verified" ? validateText(channel, "核验渠道", 2, 60) : null;
      db.prepare("UPDATE member_profiles SET identity_status=?,identity_channel=?,identity_checked_at=?,identity_checked_by=? WHERE user_id=?").run(value, checkedChannel, now, actor.id, targetId);
      if (value !== "verified") db.prepare("UPDATE member_comments SET status='hidden',reason=?,updated_at=? WHERE user_id=? AND status='published'").run("核验状态变更，需重新审核。", now, targetId);
    } else if (operation === "role") {
      if (profile.role !== "owner" || !["member", "moderator", "site_admin"].includes(value)) throw new MemberError("FORBIDDEN", "仅站长可配置管理角色。", 403);
      db.prepare("UPDATE member_profiles SET role=? WHERE user_id=?").run(value, targetId);
      db.prepare('DELETE FROM session WHERE "userId"=?').run(targetId);
    } else if (operation === "password") {
      if (typeof passwordHash !== "string" || passwordHash.length < 20) throw new MemberError("INVALID_PASSWORD", "密码重置失败。");
      db.prepare('DELETE FROM account WHERE "userId"=? AND "providerId"=\'credential\'').run(targetId);
      db.prepare('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES(?,?,\'credential\',?,?,?,?)').run(randomUUID(), targetId, targetId, passwordHash, Date.now(), Date.now());
      db.prepare('DELETE FROM session WHERE "userId"=?').run(targetId);
      db.prepare("DELETE FROM verification WHERE identifier=?").run(`forget-password-otp-${target.email}`);
    } else if (operation === "delete") {
      db.prepare("DELETE FROM member_admin_recovery WHERE user_id=?").run(targetId);
      db.prepare("DELETE FROM member_admin_factors WHERE user_id=?").run(targetId);
      db.prepare("DELETE FROM member_favorites WHERE user_id=?").run(targetId);
      db.prepare("UPDATE member_comments SET content='',content_hash='',status='deleted',reason=NULL,updated_at=? WHERE user_id=?").run(now, targetId);
      db.prepare("UPDATE member_reports SET reason='账号已注销',resolution=NULL WHERE user_id=?").run(targetId);
      db.prepare('DELETE FROM session WHERE "userId"=?').run(targetId);
      db.prepare('DELETE FROM account WHERE "userId"=?').run(targetId);
      db.prepare('UPDATE user SET name=?,email=?,"emailVerified"=0,image=NULL,"updatedAt"=? WHERE id=?').run("已注销用户", randomUUID() + "@deleted.invalid", Date.now(), targetId);
      db.prepare("UPDATE member_profiles SET status='deleted',role='member',identity_status='unrecorded',identity_channel=NULL,identity_checked_at=NULL,identity_checked_by=NULL,comment_muted=1 WHERE user_id=?").run(targetId);
      // Exact OTP keys only: no wildcard deletion of another user's codes.
      for (const prefix of ["sign-in", "forget-password", "email-verification"]) db.prepare("DELETE FROM verification WHERE identifier=?").run(`${prefix}-otp-${target.email}`);
    } else throw new MemberError("INVALID_ACTION", "操作不可用。");
    if (["delete", "password", "role", "status"].includes(operation)) db.prepare("DELETE FROM member_admin_grants WHERE user_id=?").run(targetId);
    audit(db, actor.id, `member.${operation}`, targetId, reason, operation === "password" || operation === "delete" ? {} : { value });
  });
}

export function moderateComment(db, actor, { id, status, reason }) {
  return transaction(db, () => {
    adminActor(db, actor);
    const row = db.prepare("SELECT c.*,p.status AS member_status,p.identity_status FROM member_comments c JOIN member_profiles p ON p.user_id=c.user_id WHERE c.id=?").get(id);
    if (!row || row.status === "deleted") throw new MemberError("NOT_FOUND", "留言不存在。", 404);
    if (!["published", "rejected", "hidden", "deleted"].includes(status)) throw new MemberError("INVALID_STATUS", "请选择审核操作。");
    if (status === "published" && (row.member_status !== "active" || row.identity_status !== "verified")) throw new MemberError("IDENTITY_REQUIRED", "请先完成该会员的外部实名核验，再公开留言。", 409);
    const now = new Date().toISOString();
    db.prepare("UPDATE member_comments SET status=?,content=?,reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?").run(status, status === "deleted" ? "" : row.content, reason, actor.id, now, now, id);
    if (status === "deleted") db.prepare("UPDATE member_comments SET content_hash='' WHERE id=?").run(id);
    audit(db, actor.id, `comment.${status}`, id, reason);
  });
}

export function resolveReport(db, actor, { id, resolution }) {
  return transaction(db, () => {
    adminActor(db, actor);
    const report = db.prepare("SELECT id FROM member_reports WHERE id=? AND status='open'").get(id);
    if (!report) throw new MemberError("NOT_FOUND", "该反馈已处理或不存在。", 404);
    db.prepare("UPDATE member_reports SET status='resolved',resolution=?,resolved_at=?,resolved_by=? WHERE id=?").run(resolution, new Date().toISOString(), actor.id, id);
    audit(db, actor.id, "report.resolve", id, resolution);
  });
}
