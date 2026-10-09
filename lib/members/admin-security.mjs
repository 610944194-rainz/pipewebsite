import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createHMAC } from "@better-auth/utils/hmac";
import { MemberError } from "./policy.mjs";
import { adminActor, adminMfaRequired, transaction, audit } from "./community-store.mjs";

export function initializeAdminSecurity(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS member_admin_factors (
    user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    setup_session TEXT, setup_expires INTEGER NOT NULL DEFAULT 0,
    last_step INTEGER NOT NULL DEFAULT -1, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS member_admin_recovery (
    user_id TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(user_id,digest));`);
  if (!db.prepare("PRAGMA table_info(member_admin_grants)").all().some(c => c.name === "factor_verified")) {
    db.exec("ALTER TABLE member_admin_grants ADD COLUMN factor_verified INTEGER NOT NULL DEFAULT 0");
  }
}

function key(secret) { return createHash("sha256").update(`members-admin-factor:v1:${secret}`).digest(); }
function encrypt(value, secret, userId) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(value), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64url")).join(".");
}
function decrypt(value, secret, userId) {
  const [iv, tag, data] = value.split(".").map(s => Buffer.from(s, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
function recoveryDigest(code, secret, userId) {
  return createHmac("sha256", secret).update(`members-admin-recovery:${userId}:${code}`).digest("hex");
}
function recoveryCodes(db, userId, secret) {
  const codes = Array.from({ length: 8 }, () => randomBytes(10).toString("hex"));
  db.prepare("DELETE FROM member_admin_recovery WHERE user_id=?").run(userId);
  for (const code of codes) db.prepare("INSERT INTO member_admin_recovery VALUES(?,?)").run(userId, recoveryDigest(code, secret, userId));
  return codes;
}
function grant(db, actor, now, factorVerified = 1) {
  const until = now + 300000;
  db.prepare("INSERT INTO member_admin_grants(session_id,user_id,expires_at,factor_verified) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET expires_at=excluded.expires_at,factor_verified=excluded.factor_verified").run(actor.sessionId, actor.id, until, factorVerified);
  return until;
}
export function adminFactorStatus(db, actor) {
  if (!adminMfaRequired()) return { mfaRequired: false, enabled: false, recoveryRemaining: 0 };
  return { mfaRequired: true, enabled: db.prepare("SELECT enabled FROM member_admin_factors WHERE user_id=?").get(actor.id)?.enabled === 1,
    recoveryRemaining: db.prepare("SELECT count(*) n FROM member_admin_recovery WHERE user_id=?").get(actor.id).n };
}
function requireMfaEnabled() {
  if (!adminMfaRequired()) throw new MemberError("FACTOR_DISABLED", "验证器功能暂未启用。", 409);
}

export function verifyAdminPassword(db, actor, passwordHash, now = Date.now()) {
  if (adminMfaRequired()) throw new MemberError("FACTOR_REQUIRED", "请验证管理员密码和验证器。", 401);
  return transaction(db, () => {
    checkPasswordSnapshot(db, actor, passwordHash);
    audit(db, actor.id, "admin.reauth.password", actor.id);
    return { grantUntil: grant(db, actor, now, 0) };
  });
}
export async function createAdminOTP(bytes) {
  return createOTP(await createHMAC("SHA-1").importKey(bytes, "sign"));
}
export function beginAdminFactor(db, actor, secret, email, now = Date.now(), passwordHash) {
  requireMfaEnabled();
  return transaction(db, () => {
    adminActor(db, actor, false);
    if (passwordHash) checkPasswordSnapshot(db, actor, passwordHash);
    if (adminFactorStatus(db, actor).enabled) throw new MemberError("FACTOR_ENABLED", "验证器已启用，请使用验证码或恢复码解锁。", 409);
    const bytes = randomBytes(20), encoded = base32.encode(bytes, { padding: false });
    db.prepare("INSERT INTO member_admin_factors VALUES(?,?,0,?,?,-1,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,setup_session=excluded.setup_session,setup_expires=excluded.setup_expires,last_step=-1,version=excluded.version").run(actor.id, encrypt(bytes, secret, actor.id), actor.sessionId, now + 600000, randomBytes(16).toString("hex"));
    audit(db, actor.id, "admin.factor.setup", actor.id);
    return { setupKey: encoded, uri: `otpauth://totp/${encodeURIComponent("烟斗派")}:${encodeURIComponent(email)}?secret=${encoded}&issuer=${encodeURIComponent("烟斗派")}&algorithm=SHA1&digits=6&period=30`, expiresAt: now + 600000 };
  });
}
async function matchedStep(row, code, secret, userId, now) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return -1;
  const otp = await createAdminOTP(decrypt(row.secret, secret, userId));
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= row.last_step || step < 0) continue;
    if (timingSafeEqual(Buffer.from(code), Buffer.from(await otp.hotp(step)))) return step;
  }
  return -1;
}
export async function confirmAdminFactor(db, actor, secret, code, passwordHash, now = Date.now()) {
  requireMfaEnabled();
  const row = db.prepare("SELECT * FROM member_admin_factors WHERE user_id=?").get(actor.id);
  if (!row || row.enabled || row.setup_session !== actor.sessionId || row.setup_expires <= now) throw new MemberError("SETUP_EXPIRED", "验证器设置已过期，请重新开始。", 409);
  const step = await matchedStep(row, code, secret, actor.id, now);
  if (step < 0) throw new MemberError("INVALID_FACTOR", "验证器验证码不正确或已使用。", 401);
  return transaction(db, () => {
    checkPasswordSnapshot(db, actor, passwordHash);
    const result = db.prepare("UPDATE member_admin_factors SET enabled=1,last_step=?,setup_session=NULL,setup_expires=0 WHERE user_id=? AND enabled=0 AND version=? AND setup_session=? AND setup_expires>?").run(step, actor.id, row.version, actor.sessionId, now);
    if (!result.changes) throw new MemberError("SETUP_EXPIRED", "验证器设置已变化，请重新开始。", 409);
    db.prepare("DELETE FROM member_admin_grants WHERE user_id=?").run(actor.id);
    const codes = recoveryCodes(db, actor.id, secret);
    audit(db, actor.id, "admin.factor.enabled", actor.id);
    return { recoveryCodes: codes, grantUntil: grant(db, actor, now) };
  });
}
function checkPasswordSnapshot(db, actor, passwordHash) {
  adminActor(db, actor, false);
  if (db.prepare("SELECT password FROM account WHERE userId=? AND providerId='credential'").get(actor.id)?.password !== passwordHash) throw new MemberError("REAUTH_REQUIRED", "密码已变更，请重新验证。", 401);
}
export async function verifyAdminFactor(db, actor, secret, code, recoveryCode, passwordHash, now = Date.now()) {
  requireMfaEnabled();
  const row = db.prepare("SELECT * FROM member_admin_factors WHERE user_id=? AND enabled=1").get(actor.id);
  if (!row) throw new MemberError("FACTOR_REQUIRED", "请先设置管理员验证器。", 401);
  const recovery = typeof recoveryCode === "string" && /^[a-f0-9]{20}$/.test(recoveryCode) ? recoveryDigest(recoveryCode, secret, actor.id) : null;
  const step = recovery ? -1 : await matchedStep(row, code, secret, actor.id, now);
  return transaction(db, () => {
    checkPasswordSnapshot(db, actor, passwordHash);
    const current = db.prepare("SELECT * FROM member_admin_factors WHERE user_id=? AND enabled=1 AND version=?").get(actor.id, row.version);
    if (!current) throw new MemberError("INVALID_FACTOR", "验证器已变化，请重新验证。", 401);
    if (recovery) {
      if (!db.prepare("DELETE FROM member_admin_recovery WHERE user_id=? AND digest=?").run(actor.id, recovery).changes) throw new MemberError("INVALID_FACTOR", "恢复码不正确或已使用。", 401);
      db.prepare("DELETE FROM member_admin_grants WHERE user_id=?").run(actor.id);
    } else if (step < 0 || !db.prepare("UPDATE member_admin_factors SET last_step=? WHERE user_id=? AND version=? AND last_step<?").run(step, actor.id, row.version, step).changes) {
      throw new MemberError("INVALID_FACTOR", "验证器验证码不正确或已使用。", 401);
    }
    audit(db, actor.id, recovery ? "admin.reauth.recovery" : "admin.reauth.factor", actor.id);
    return { grantUntil: grant(db, actor, now) };
  });
}
export function rotateAdminRecovery(db, actor, secret, passwordHash) {
  requireMfaEnabled();
  return transaction(db, () => {
    checkPasswordSnapshot(db, actor, passwordHash); adminActor(db, actor);
    const codes = recoveryCodes(db, actor.id, secret);
    db.prepare("DELETE FROM member_admin_grants WHERE user_id=? AND session_id<>?").run(actor.id, actor.sessionId);
    audit(db, actor.id, "admin.recovery.rotated", actor.id);
    return { recoveryCodes: codes };
  });
}
