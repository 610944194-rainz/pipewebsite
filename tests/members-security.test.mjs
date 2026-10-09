import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base32 } from "@better-auth/utils/base32";
import { openMemberStore } from "../lib/members/store.mjs";
import { initializeCommunity, adminActor, adminGrantUntil } from "../lib/members/community-store.mjs";
import { initializeAdminSecurity, beginAdminFactor, confirmAdminFactor, verifyAdminFactor, verifyAdminPassword, adminFactorStatus, rotateAdminRecovery, createAdminOTP } from "../lib/members/admin-security.mjs";
import { backupMembers, restoreMembers } from "../lib/members/backup.mjs";
import { DatabaseSync } from "node:sqlite";

const secret = "synthetic-auth-secret-at-least-32-characters", actor = { id: "owner", sessionId: "session" };
process.env.MEMBERS_ADMIN_MFA_ENABLED = "true";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "members-security-")), db = openMemberStore(join(dir, "source.sqlite"));
  initializeCommunity(db); initializeAdminSecurity(db);
  db.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE account(userId TEXT,providerId TEXT,password TEXT);
    CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,expiresAt INTEGER); CREATE TABLE verification(id TEXT);
    INSERT INTO user VALUES('owner','owner@example.test'); INSERT INTO account VALUES('owner','credential','passwordhash');
    INSERT INTO verification VALUES('old-otp');`);
  db.prepare("INSERT INTO member_profiles(user_id,role,created_at) VALUES('owner','owner',?)").run(new Date().toISOString());
  db.prepare("INSERT INTO session VALUES('session','owner',?)").run(Date.now() + 3600000);
  return { dir, db };
}
async function enabled(db) {
  const setup = beginAdminFactor(db, actor, secret, "owner@example.test");
  const bytes = base32.decode(setup.setupKey);
  const result = await confirmAdminFactor(db, actor, secret, await (await createAdminOTP(bytes)).totp(), "passwordhash");
  return { bytes, result, setup };
}
test("RFC4226 HOTP reference vector via existing auth library", async () => {
  const otp = await createAdminOTP(Buffer.from("12345678901234567890"));
  for (const [step, expected] of ["755224", "287082", "359152", "969429", "338314"].entries()) assert.equal(await otp.hotp(step), expected);
});

test("password-only grants require current password, active staff session and expiry; re-enabling MFA rejects password grants", async () => {
  const { db } = fixture();
  process.env.MEMBERS_ADMIN_MFA_ENABLED = "false";
  try {
    assert.equal(adminFactorStatus(db, actor).mfaRequired, false);
    assert.throws(() => adminActor(db, actor), e => e.code === "REAUTH_REQUIRED");
    assert.throws(() => verifyAdminPassword(db, actor, "wronghash"), e => e.code === "REAUTH_REQUIRED");
    const unlocked = verifyAdminPassword(db, actor, "passwordhash");
    assert.equal(adminActor(db, actor).role, "owner");
    assert.equal(adminGrantUntil(db, actor), unlocked.grantUntil);
    assert.equal(db.prepare("SELECT factor_verified FROM member_admin_grants").get().factor_verified, 0);
    assert.equal(adminGrantUntil(db, actor, unlocked.grantUntil), 0);
    assert.throws(() => adminActor(db, { ...actor, sessionId: "another" }), e => e.status === 403);
    assert.throws(() => beginAdminFactor(db, actor, secret, "owner@example.test"), e => e.code === "FACTOR_DISABLED");
    await assert.rejects(confirmAdminFactor(db, actor, secret, "123456", "passwordhash"), e => e.code === "FACTOR_DISABLED");
    await assert.rejects(verifyAdminFactor(db, actor, secret, "123456", null, "passwordhash"), e => e.code === "FACTOR_DISABLED");
    assert.throws(() => rotateAdminRecovery(db, actor, secret, "passwordhash"), e => e.code === "FACTOR_DISABLED");
    process.env.MEMBERS_ADMIN_MFA_ENABLED = "true";
    assert.throws(() => verifyAdminPassword(db, actor, "passwordhash"), e => e.code === "FACTOR_REQUIRED");
    assert.throws(() => adminActor(db, actor), e => e.code === "REAUTH_REQUIRED");
    await enabled(db);
    assert.equal(adminActor(db, actor).role, "owner");
    process.env.MEMBERS_ADMIN_MFA_ENABLED = "false";
    db.prepare("UPDATE member_profiles SET role='member' WHERE user_id='owner'").run();
    assert.throws(() => verifyAdminPassword(db, actor, "passwordhash"), e => e.status === 403);
    db.prepare("UPDATE member_profiles SET role='owner',status='banned' WHERE user_id='owner'").run();
    assert.throws(() => adminActor(db, actor), e => e.status === 403);
    db.prepare("UPDATE member_profiles SET status='active' WHERE user_id='owner'").run();
    db.prepare("DELETE FROM session").run();
    assert.throws(() => verifyAdminPassword(db, actor, "passwordhash"), e => e.status === 403);
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM member_audit").all()).includes("passwordhash"));
  } finally { process.env.MEMBERS_ADMIN_MFA_ENABLED = "true"; db.close(); }
});
test("old password-only grants rejected; encrypted enrollment bound to session and expiry", async () => {
  const { db } = fixture();
  db.prepare("INSERT INTO member_admin_grants VALUES('session','owner',?,0)").run(Date.now() + 50000);
  assert.throws(() => adminActor(db, actor), e => e.code === "REAUTH_REQUIRED");
  const setup = beginAdminFactor(db, actor, secret, "owner@example.test");
  assert.ok(!db.prepare("SELECT secret FROM member_admin_factors").get().secret.includes(setup.setupKey));
  await assert.rejects(confirmAdminFactor(db, { ...actor, sessionId: "other" }, secret, "123456", "passwordhash"), e => e.code === "SETUP_EXPIRED");
  db.prepare("UPDATE member_admin_factors SET setup_expires=0").run();
  await assert.rejects(confirmAdminFactor(db, actor, secret, "123456", "passwordhash"), e => e.code === "SETUP_EXPIRED");
  db.close();
});
test("TOTP replay blocked across concurrent requests; wrong codes never grant access", async () => {
  const { db } = fixture(), { bytes } = await enabled(db);
  const step = Math.floor(Date.now() / 30000), otp = await createAdminOTP(bytes);
  await assert.rejects(verifyAdminFactor(db, actor, secret, await otp.hotp(step), null, "passwordhash"), e => e.code === "INVALID_FACTOR");
  const code = await otp.hotp(step + 1);
  const results = await Promise.allSettled([1, 2].map(() => verifyAdminFactor(db, actor, secret, code, null, "passwordhash")));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  db.prepare("DELETE FROM member_admin_grants").run();
  await assert.rejects(verifyAdminFactor(db, actor, secret, "invalid", null, "passwordhash"), e => e.code === "INVALID_FACTOR");
  assert.throws(() => adminActor(db, actor), e => e.code === "REAUTH_REQUIRED");
  db.close();
});
test("recovery codes single use, rotated hashes only, grants cleared on password change", async () => {
  const { db } = fixture(), { result } = await enabled(db);
  const code = result.recoveryCodes[0];
  assert.equal(result.recoveryCodes.length, 8);
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM member_admin_recovery").all()).includes(code));
  await verifyAdminFactor(db, actor, secret, null, code, "passwordhash");
  await assert.rejects(verifyAdminFactor(db, actor, secret, null, code, "passwordhash"), e => e.code === "INVALID_FACTOR");
  const rotated = rotateAdminRecovery(db, actor, secret, "passwordhash");
  await assert.rejects(verifyAdminFactor(db, actor, secret, null, result.recoveryCodes[1], "passwordhash"), e => e.code === "INVALID_FACTOR");
  db.prepare("UPDATE account SET password='changedhash'").run();
  await assert.rejects(verifyAdminFactor(db, actor, secret, null, rotated.recoveryCodes[0], "passwordhash"), e => e.code === "REAUTH_REQUIRED");
  assert.equal(db.prepare("SELECT count(*) n FROM member_admin_recovery").get().n, 8);
  db.close();
});
test("revoked sessions and roles cannot confirm or reuse recovery codes; audit has no secrets", async () => {
  const { db } = fixture(), { result, setup } = await enabled(db);
  db.prepare("DELETE FROM session").run();
  await assert.rejects(verifyAdminFactor(db, actor, secret, null, result.recoveryCodes[0], "passwordhash"), e => e.status === 403);
  const logs = JSON.stringify(db.prepare("SELECT * FROM member_audit").all());
  for (const value of [setup.setupKey, secret, ...result.recoveryCodes]) assert.ok(!logs.includes(value));
  db.close();
});
test("online encrypted backup includes WAL data; restore preserves content and revokes tokens", async () => {
  const { db, dir } = fixture(); await enabled(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO member_comments(id,user_id,blend_id,content,content_hash,created_at,updated_at) VALUES('c','owner','blend:test','WAL history','hash',?,?)").run(now, now);
  db.prepare("INSERT INTO member_favorites VALUES('owner','pipe:1','pipe','1','snapshot',?)").run(now);
  const file = join(dir, "encrypted.ymb"), restored = join(dir, "restored.sqlite"), key = "separate-backup-test-key-with-at-least-32-characters";
  await backupMembers(db, file, key);
  assert.ok(!readFileSync(file).includes(Buffer.from("WAL history")));
  await restoreMembers(file, restored, key);
  const recovered = new DatabaseSync(restored);
  assert.equal(recovered.prepare("SELECT content FROM member_comments").get().content, "WAL history");
  assert.equal(recovered.prepare("SELECT count(*) n FROM member_favorites").get().n, 1);
  for (const table of ["session", "verification", "member_admin_grants"]) assert.equal(recovered.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(recovered.prepare("SELECT enabled FROM member_admin_factors").get().enabled, 1);
  recovered.close();
  const original = readFileSync(restored);
  await assert.rejects(restoreMembers(file, restored, key));
  assert.deepEqual(readFileSync(restored), original);
  await assert.rejects(backupMembers(db, file, key));
  await assert.rejects(restoreMembers(file, join(dir, "wrong.sqlite"), "wrong-key-with-at-least-32-characters"));
  assert.equal(existsSync(join(dir, "wrong.sqlite")), false);
  const tampered = readFileSync(file); tampered[50] ^= 1; writeFileSync(join(dir, "tampered.ymb"), tampered);
  await assert.rejects(restoreMembers(join(dir, "tampered.ymb"), join(dir, "tampered.sqlite"), key));
  assert.equal(existsSync(join(dir, "tampered.sqlite")), false);
  db.close();
});
