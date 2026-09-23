import "server-only";

type RedisReply = { result?: unknown; error?: string };
type Command = (string | number)[];

function config() {
  const url = process.env.ANALYTICS_REDIS_REST_URL;
  const token = process.env.ANALYTICS_REDIS_REST_TOKEN;
  if (!url || !token || !/^https:\/\//.test(url)) throw new Error("Analytics storage is not configured");
  return { url: url.replace(/\/$/, ""), token };
}

async function pipeline(commands: Command[]): Promise<unknown[]> {
  const { url, token } = config();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Analytics storage HTTP ${response.status}`);
  const data = (await response.json()) as RedisReply[];
  if (!Array.isArray(data) || data.length !== commands.length || data.some((reply) => reply.error)) {
    throw new Error("Analytics storage command failed");
  }
  return data.map((reply) => reply.result);
}

// Use the site's China audience time zone, independent of the server's clock setting.
const dayKey = (date: Date) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function recordView(path: string, visitor: string) {
  if (process.env.ANALYTICS_DB_PATH) {
    (await import("./sqlite-store")).recordView(path, visitor);
    return;
  }
  const day = dayKey(new Date());
  const pageCount = `yd:analytics:views:${day}`;
  const visitors = `yd:analytics:visitors:${day}`;
  const pages = `yd:analytics:pages:${day}`;
  await pipeline([
    ["INCR", "yd:analytics:views:all"],
    ["PFADD", "yd:analytics:visitors:all", visitor],
    ["INCR", pageCount],
    ["PFADD", visitors, visitor],
    ["ZINCRBY", "yd:analytics:pages:all", 1, path],
    ["ZINCRBY", pages, 1, path],
  ]);
}

export async function readStats() {
  if (process.env.ANALYTICS_DB_PATH) return (await import("./sqlite-store")).readStats();
  const now = new Date();
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - 29 + i);
    return dayKey(date);
  });
  const results = await pipeline([
    ["GET", "yd:analytics:views:all"],
    ["PFCOUNT", "yd:analytics:visitors:all"],
    ...days.map((day) => ["GET", `yd:analytics:views:${day}`]),
    ...days.map((day) => ["PFCOUNT", `yd:analytics:visitors:${day}`]),
    ["ZREVRANGE", "yd:analytics:pages:all", 0, 9, "WITHSCORES"],
  ]);
  const daily = days.map((date, i) => ({
    date,
    views: Number(results[2 + i] || 0),
    visitors: Number(results[32 + i] || 0),
  }));
  const rawPages = (results[62] || []) as string[];
  const topPages = [];
  for (let i = 0; i < rawPages.length; i += 2) {
    topPages.push({ path: rawPages[i], views: Number(rawPages[i + 1]) });
  }
  return {
    totalViews: Number(results[0] || 0),
    totalVisitors: Number(results[1] || 0),
    last7Views: daily.slice(-7).reduce((sum, day) => sum + day.views, 0),
    last30Views: daily.reduce((sum, day) => sum + day.views, 0),
    // PFCOUNT across the daily sketches counts each visitor once over the period.
    last7Visitors: Number((await pipeline([["PFCOUNT", ...days.slice(-7).map((day) => `yd:analytics:visitors:${day}`)]]))[0] || 0),
    last30Visitors: Number((await pipeline([["PFCOUNT", ...days.map((day) => `yd:analytics:visitors:${day}`)]]))[0] || 0),
    daily,
    topPages,
  };
}

export async function loginAttempts(key: string) {
  if (process.env.ANALYTICS_DB_PATH) return (await import("./sqlite-store")).loginAttempts(key);
  const results = await pipeline([
    ["INCR", `yd:analytics:login:${key}`],
    ["EXPIRE", `yd:analytics:login:${key}`, 900, "NX"],
  ]);
  return Number(results[0]);
}
