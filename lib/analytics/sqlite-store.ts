import "server-only";
import { createHmac } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

let connection: DatabaseSync | undefined;

function db() {
  if (connection) return connection;
  const file = process.env.ANALYTICS_DB_PATH;
  if (!file || !isAbsolute(file)) throw new Error("ANALYTICS_DB_PATH must be an absolute persistent path");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const fresh = !existsSync(file);
  const database = new DatabaseSync(file);
  if (fresh) chmodSync(file, 0o600);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS views (
      id INTEGER PRIMARY KEY,
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      visitor TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS views_day_idx ON views(day);
    CREATE INDEX IF NOT EXISTS views_path_idx ON views(path);
    CREATE TABLE IF NOT EXISTS login_attempts (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  connection = database;
  return database;
}

function dayKey(date: Date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function visitorHash(visitor: string) {
  const secret = process.env.ANALYTICS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Analytics session secret is not configured");
  return createHmac("sha256", secret).update(visitor).digest("hex");
}

export function recordView(path: string, visitor: string) {
  db().prepare("INSERT INTO views (day, path, visitor) VALUES (?, ?, ?)")
    .run(dayKey(new Date()), path, visitorHash(visitor));
}

export function readStats() {
  const database = db();
  const now = new Date();
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - 29 + i);
    return dayKey(date);
  });
  const first7 = days[23];
  const first30 = days[0];
  const totals = database.prepare("SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM views").get() as { views: number; visitors: number };
  const period = database.prepare(`
    SELECT
      COUNT(*) AS views,
      COUNT(DISTINCT visitor) AS visitors,
      COUNT(*) FILTER (WHERE day >= ?) AS views7,
      COUNT(DISTINCT CASE WHEN day >= ? THEN visitor END) AS visitors7
    FROM views WHERE day >= ?
  `).get(first7, first7, first30) as { views: number; visitors: number; views7: number; visitors7: number };
  const rows = database.prepare("SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM views WHERE day >= ? GROUP BY day")
    .all(first30) as { day: string; views: number; visitors: number }[];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const topPages = database.prepare("SELECT path, COUNT(*) AS views FROM views GROUP BY path ORDER BY views DESC, path ASC LIMIT 10")
    .all() as { path: string; views: number }[];
  return {
    totalViews: totals.views,
    totalVisitors: totals.visitors,
    last7Views: period.views7,
    last7Visitors: period.visitors7,
    last30Views: period.views,
    last30Visitors: period.visitors,
    daily: days.map((date) => ({ date, views: byDay.get(date)?.views || 0, visitors: byDay.get(date)?.visitors || 0 })),
    topPages,
  };
}

export function loginAttempts(bucket: string) {
  const now = Date.now();
  db().prepare("DELETE FROM login_attempts WHERE expires_at < ?").run(now);
  const result = db().prepare(`
    INSERT INTO login_attempts (bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts
  `).get(bucket, now + 15 * 60 * 1000, now, now) as { attempts: number };
  return result.attempts;
}
