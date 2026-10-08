import { createHmac } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemberError } from "./policy.mjs";
import { initializeCommunity } from "./community-store.mjs";
import { initializeAdminSecurity } from "./admin-security.mjs";

let connection;

export function getMemberConfig(env = process.env) {
  const secret = env.MEMBERS_AUTH_SECRET;
  const file = env.MEMBERS_DB_PATH;
  let url;
  try { url = new URL(env.MEMBERS_AUTH_URL); } catch { throw new MemberError("AUTH_UNAVAILABLE", "账号服务尚未开通，请稍后再试。", 503); }
  const production = env.NODE_ENV === "production";
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!secret || secret.length < 32 || !file || !isAbsolute(file) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol) || (production && url.protocol !== "https:" && !loopback)) {
    throw new MemberError("AUTH_UNAVAILABLE", "账号服务尚未开通，请稍后再试。", 503);
  }
  const insideCheckout = !relative(process.cwd(), file).startsWith("..") && !isAbsolute(relative(process.cwd(), file));
  if (production && insideCheckout) throw new MemberError("AUTH_UNAVAILABLE", "账号存储配置不可用。", 503);
  const mode = env.MEMBERS_EMAIL_MODE || "disabled";
  if (!["disabled", "resend", "test"].includes(mode)) throw new MemberError("AUTH_UNAVAILABLE", "邮件配置不可用。", 503);
  if (mode === "test" && (production || !loopback || !env.MEMBERS_TEST_MAIL_DIR || !isAbsolute(env.MEMBERS_TEST_MAIL_DIR))) {
    throw new MemberError("AUTH_UNAVAILABLE", "测试邮件通道仅限本地开发。", 503);
  }
  return { secret, file, origin: url.origin, mode, testMailDir: env.MEMBERS_TEST_MAIL_DIR, resendKey: env.MEMBERS_RESEND_API_KEY, from: env.MEMBERS_EMAIL_FROM };
}

export function openMemberStore(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const fresh = !existsSync(file);
  const db = new DatabaseSync(file);
  if (fresh) chmodSync(file, 0o600);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS member_profiles (
      user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active', identity_status TEXT NOT NULL DEFAULT 'unrecorded',
      identity_channel TEXT, identity_checked_at TEXT, identity_checked_by TEXT,
      terms_version TEXT, terms_accepted_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_rate_buckets (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS member_mail_usage (period TEXT PRIMARY KEY, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS member_mail_deliveries (
      id TEXT PRIMARY KEY, recipient_hash TEXT NOT NULL, purpose TEXT NOT NULL,
      state TEXT NOT NULL, created_at INTEGER NOT NULL, provider_id TEXT
    );
    CREATE INDEX IF NOT EXISTS member_mail_created_idx ON member_mail_deliveries(created_at);
  `);
  return db;
}

export function getMemberStore() {
  if (!connection) {
    const candidate = openMemberStore(getMemberConfig().file);
    try { initializeCommunity(candidate); initializeAdminSecurity(candidate); } catch (error) { candidate.close(); throw error; }
    connection = candidate;
  }
  return connection;
}

export function privateBucket(value, secret = getMemberConfig().secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function take(db, key, limit, seconds, now) {
  const current = db.prepare("SELECT count, expires_at FROM member_rate_buckets WHERE key=?").get(key);
  if (current && current.expires_at > now && current.count >= limit) throw new MemberError("RATE_LIMITED", "操作较频繁，请稍后再试。", 429);
  db.prepare("INSERT INTO member_rate_buckets(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at>? THEN count+1 ELSE 1 END, expires_at=CASE WHEN expires_at>? THEN expires_at ELSE excluded.expires_at END").run(key, now + seconds * 1000, now, now);
}

export function limitMemberAttempt(db, key, limit, seconds, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    take(db, key, limit, seconds, now);
    db.prepare("DELETE FROM member_rate_buckets WHERE expires_at<=?").run(now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

// Reservations are conservative: a failed/ambiguous provider request still consumes local allowance.
// Both counters and recipient limits change in one transaction across processes.
export function reserveMemberEmail(db, { id, recipientHash, purpose, now = Date.now(), dailyLimit = 100, monthlyLimit = 3000 }) {
  const date = new Date(now).toISOString();
  const day = `day:${date.slice(0, 10)}`;
  const month = `month:${date.slice(0, 7)}`;
  dailyLimit = Math.min(100, Math.max(0, dailyLimit));
  monthlyLimit = Math.min(3000, Math.max(0, monthlyLimit));
  db.exec("BEGIN IMMEDIATE");
  try {
    take(db, `mail-minute:${recipientHash}`, 1, 60, now);
    take(db, `mail-day:${recipientHash}`, 5, 86400, now);
    const reserve = purpose === "registration" ? 5 : 0;
    for (const [period, maximum] of [[day, Math.max(0, dailyLimit - reserve)], [month, monthlyLimit]]) {
      const usage = db.prepare("SELECT count FROM member_mail_usage WHERE period=?").get(period);
      if ((usage?.count || 0) >= maximum) throw new MemberError("EMAIL_QUOTA_EXHAUSTED", "验证邮件发送额度暂时用尽，请稍后再试。", 429);
      db.prepare("INSERT INTO member_mail_usage(period,count) VALUES(?,1) ON CONFLICT(period) DO UPDATE SET count=count+1").run(period);
    }
    db.prepare("INSERT INTO member_mail_deliveries(id,recipient_hash,purpose,state,created_at) VALUES(?,?,?,'reserved',?)").run(id, recipientHash, purpose, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function getMemberProfile(userId) {
  return getMemberStore().prepare("SELECT * FROM member_profiles WHERE user_id=?").get(userId);
}
