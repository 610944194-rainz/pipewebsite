import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemberError, normalizeEmail, safeReturnTo, validateNickname, validatePassword } from "../lib/members/policy.mjs";
import { getMemberConfig, getMemberStore, openMemberStore, reserveMemberEmail, limitMemberAttempt } from "../lib/members/store.mjs";
import { sendMemberOTP, withMemberMail } from "../lib/members/mail.mjs";

function database() { return openMemberStore(join(mkdtempSync(join(tmpdir(), "members-policy-")), "members.sqlite")); }
const instant = Date.UTC(2026, 9, 6, 12);
const base = { MEMBERS_AUTH_SECRET: "test-config-secret-with-at-least-32-chars", MEMBERS_DB_PATH: join(tmpdir(), "members-config.sqlite"), MEMBERS_AUTH_URL: "http://127.0.0.1:3106", NODE_ENV: "development" };

test("only local return paths can be used, including login-loop protection", () => {
  for (const path of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/login?returnTo=/login", "/api/auth/sign-out", "/\nevil.invalid"]) assert.equal(safeReturnTo(path), "/account");
  assert.equal(safeReturnTo("/products/abc?brand=abc#detail"), "/products/abc?brand=abc#detail");
});
test("email and nickname validation avoid malformed and privileged names", () => {
  assert.equal(normalizeEmail(" USER+tag@Example.com "), "user+tag@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), MemberError);
  assert.throws(() => validateNickname("管理员"), MemberError);
  assert.throws(() => validateNickname("<script>"), MemberError);
  assert.equal(validateNickname("斗友一号"), "斗友一号");
  assert.throws(() => validatePassword("short"), MemberError);
  assert.equal(validatePassword("abcdef"), "abcdef");
  assert.equal(validatePassword("long password with spaces"), "long password with spaces");
});
test("production cannot enable plaintext test delivery or put the member DB in checkout", () => {
  assert.equal(getMemberConfig(base).mode, "disabled");
  assert.throws(() => getMemberConfig({ ...base, NODE_ENV: "production", MEMBERS_EMAIL_MODE: "test", MEMBERS_TEST_MAIL_DIR: tmpdir() }), MemberError);
  assert.throws(() => getMemberConfig({ ...base, NODE_ENV: "production", MEMBERS_DB_PATH: join(process.cwd(), "members.sqlite") }), MemberError);
  assert.throws(() => getMemberConfig({ ...base, MEMBERS_EMAIL_MODE: "test", MEMBERS_AUTH_URL: "https://public.invalid", MEMBERS_TEST_MAIL_DIR: tmpdir() }), MemberError);
});
test("conservative free quota includes reservations, keeps safety reserve and rolls back failure", () => {
  const db = database();
  reserveMemberEmail(db, { id: "one", recipientHash: "recipient-a", purpose: "registration", now: instant, dailyLimit: 7 });
  reserveMemberEmail(db, { id: "two", recipientHash: "recipient-b", purpose: "registration", now: instant, dailyLimit: 7 });
  assert.throws(() => reserveMemberEmail(db, { id: "three", recipientHash: "recipient-c", purpose: "registration", now: instant, dailyLimit: 7 }), (e) => e.code === "EMAIL_QUOTA_EXHAUSTED");
  reserveMemberEmail(db, { id: "reset", recipientHash: "recipient-c", purpose: "forget-password", now: instant, dailyLimit: 7 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_mail_deliveries").get().n, 3);
  assert.equal(db.prepare("SELECT count FROM member_mail_usage WHERE period='month:2026-10'").get().count, 3);
  db.close();
});
test("recipient cooldown and daily guard are persistent across connections", () => {
  const db = database();
  reserveMemberEmail(db, { id: "a", recipientHash: "same", purpose: "registration", now: instant });
  assert.throws(() => reserveMemberEmail(db, { id: "b", recipientHash: "same", purpose: "registration", now: instant + 1000 }), (e) => e.code === "RATE_LIMITED");
  for (let i = 1; i < 5; i++) reserveMemberEmail(db, { id: `ok-${i}`, recipientHash: "same", purpose: "registration", now: instant + i * 61000 });
  assert.throws(() => reserveMemberEmail(db, { id: "six", recipientHash: "same", purpose: "registration", now: instant + 6 * 61000 }), (e) => e.code === "RATE_LIMITED");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_mail_deliveries").get().n, 5);
  const another = openMemberStore(String(db.prepare("PRAGMA database_list").get().file));
  assert.throws(() => reserveMemberEmail(another, { id: "other-process", recipientHash: "same", purpose: "registration", now: instant + 7 * 61000 }), (e) => e.code === "RATE_LIMITED");
  another.close();
  db.close();
});

test("mail failure reaches its request only, records failed delivery and conservatively retains quota", async () => {
  const config = { ...base, MEMBERS_DB_PATH: join(mkdtempSync(join(tmpdir(), "members-mail-")), "mail.sqlite"), MEMBERS_EMAIL_MODE: "resend", MEMBERS_RESEND_API_KEY: "synthetic-provider-key", MEMBERS_EMAIL_FROM: "test@example.test" };
  const saved = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  Object.assign(process.env, config);
  globalThis.fetch = async () => new Response("", { status: 500 });
  try {
    const outcomes = await Promise.allSettled([
      withMemberMail(async () => { await sendMemberOTP({ email: "synthetic@example.test", otp: "123456", type: "sign-in" }); return "library-success"; }),
      withMemberMail(async () => { await new Promise((resolve) => setImmediate(resolve)); return "another-request"; }),
    ]);
    assert.equal(outcomes[0].status, "rejected");
    assert.equal(outcomes[0].reason.code, "EMAIL_SEND_FAILED");
    assert.equal(outcomes[1].status, "fulfilled");
    assert.equal(outcomes[1].value, "another-request");
    const db = getMemberStore();
    assert.equal(db.prepare("SELECT state FROM member_mail_deliveries").get().state, "failed");
    assert.equal(db.prepare("SELECT count FROM member_mail_usage WHERE period LIKE 'day:%'").get().count, 1);
    assert.equal(db.prepare("SELECT count FROM member_mail_usage WHERE period LIKE 'month:%'").get().count, 1);
    db.close();
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
test("month limit persists even when a new day starts", () => {
  const db = database();
  reserveMemberEmail(db, { id: "a", recipientHash: "a", purpose: "forget-password", now: instant, monthlyLimit: 1 });
  assert.throws(() => reserveMemberEmail(db, { id: "b", recipientHash: "b", purpose: "forget-password", now: instant + 86400000, monthlyLimit: 1 }), (e) => e.code === "EMAIL_QUOTA_EXHAUSTED");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_mail_deliveries").get().n, 1);
  db.close();
});
test("attempt limit expires and never increments on rejected attempts", () => {
  const db = database();
  limitMemberAttempt(db, "login", 2, 60, instant);
  limitMemberAttempt(db, "login", 2, 60, instant);
  assert.throws(() => limitMemberAttempt(db, "login", 2, 60, instant), MemberError);
  limitMemberAttempt(db, "login", 2, 60, instant + 61000);
  assert.equal(db.prepare("SELECT count FROM member_rate_buckets WHERE key='login'").get().count, 1);
  db.close();
});
