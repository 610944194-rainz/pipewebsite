import { DatabaseSync } from "node:sqlite";
import { backupMembers, restoreMembers } from "../lib/members/backup.mjs";

const [action, source, destination] = process.argv.slice(2);
try {
  if (!["backup", "restore"].includes(action) || !source || !destination) throw new Error("Usage: members-backup.mjs backup|restore <absolute source> <new absolute destination>");
  const secret = process.env.MEMBERS_BACKUP_KEY;
  if (action === "backup") {
    const db = new DatabaseSync(source, { readOnly: true });
    try { await backupMembers(db, destination, secret); } finally { db.close(); }
  } else { await restoreMembers(source, destination, secret); }
  console.log(action === "backup" ? "Encrypted member backup complete." : "Restored to new destination; integrity verified; old sessions, grants and OTPs revoked.");
} catch { console.error("Member backup/recovery failed. Check private configuration, database schema, permissions and new destination; no existing database was overwritten."); process.exitCode = 1; }
