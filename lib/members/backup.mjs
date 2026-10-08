import { backup, DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream, openSync, closeSync, readSync, statSync, mkdirSync, unlinkSync, chmodSync, appendFileSync, linkSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("YMB1");
function destination(path, secret) {
  if (!isAbsolute(path) || !secret || secret.length < 32) throw new Error("Absolute destination and a separate backup key of at least 32 characters required");
  const rel = relative(process.cwd(), path);
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("Backup and restored databases must stay outside the checkout");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}
function temporary(path) { return join(dirname(path), `.members-private-${randomBytes(16).toString("hex")}.sqlite`); }
function removeOwnTemporary(path) { try { unlinkSync(path); } catch (e) { if (e.code !== "ENOENT") throw e; } }
function validate(db) {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database integrity check failed");
  for (const table of ["user", "account", "session", "verification", "member_profiles", "member_favorites", "member_comments", "member_audit", "member_admin_factors", "member_admin_recovery", "member_admin_grants"]) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error("Incomplete member database");
  }
}
export async function backupMembers(db, path, secret) {
  destination(path, secret); validate(db);
  const snapshot = temporary(path), salt = randomBytes(16), iv = randomBytes(12), header = Buffer.concat([magic, salt, iv]);
  let outputCreated = false;
  try {
    const fd = openSync(snapshot, "wx", 0o600); closeSync(fd);
    await backup(db, snapshot);
    chmodSync(snapshot, 0o600);
    const cipher = createCipheriv("aes-256-gcm", scryptSync(secret, salt, 32), iv); cipher.setAAD(header);
    const outFd = openSync(path, "wx", 0o600); outputCreated = true;
    const out = createWriteStream(path, { fd: outFd }); out.write(header);
    await pipeline(createReadStream(snapshot), cipher, out);
    appendFileSync(path, cipher.getAuthTag());
    return { encrypted: true, bytes: statSync(path).size };
  } catch (e) { if (outputCreated) removeOwnTemporary(path); throw e; }
  finally { removeOwnTemporary(snapshot); }
}
export async function restoreMembers(path, target, secret) {
  destination(target, secret);
  const size = statSync(path).size;
  if (size < 49) throw new Error("Invalid encrypted backup");
  const header = Buffer.alloc(32), tag = Buffer.alloc(16), fd = openSync(path, "r");
  try { readSync(fd, header, 0, 32, 0); readSync(fd, tag, 0, 16, size - 16); } finally { closeSync(fd); }
  if (!header.subarray(0, 4).equals(magic)) throw new Error("Unsupported backup format");
  const scratch = temporary(target);
  try {
    const cipher = createDecipheriv("aes-256-gcm", scryptSync(secret, header.subarray(4, 20), 32), header.subarray(20));
    cipher.setAAD(header); cipher.setAuthTag(tag);
    await pipeline(createReadStream(path, { start: 32, end: size - 17 }), cipher, createWriteStream(scratch, { flags: "wx", mode: 0o600 }));
    const db = new DatabaseSync(scratch);
    try {
      validate(db);
      // A restored backup must never resurrect session tokens, grants or OTPs.
      db.exec("BEGIN IMMEDIATE; DELETE FROM session; DELETE FROM verification; DELETE FROM member_admin_grants; COMMIT;");
      validate(db); db.exec("PRAGMA journal_mode=DELETE");
    } finally { db.close(); }
    // link is exclusive: an existing target is never replaced, even in a race.
    linkSync(scratch, target); chmodSync(target, 0o600);
    return { integrity: "ok", sessionsRevoked: true };
  } finally { removeOwnTemporary(scratch); }
}
