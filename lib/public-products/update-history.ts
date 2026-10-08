import "server-only";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PublicRecentNewProductsFile } from "./types";

const RECENT_NEW_PATH = "data/generated/public-products/recent-new.json";
const historyCache = new Map<string, {
  expiresAt: number;
  batches: PublicRecentNewProductsFile[];
}>();

function parseBatch(raw: string): PublicRecentNewProductsFile | null {
  try {
    const batch = JSON.parse(raw);
    return typeof batch?.generatedAt === "string" && Array.isArray(batch.products)
      ? batch
      : null;
  } catch {
    return null;
  }
}

function uniqueBatches(batches: PublicRecentNewProductsFile[]) {
  return [...new Map(batches.map((batch) => [JSON.stringify(batch), batch])).values()];
}

/**
 * Each release replaces recent-new.json, including releases with zero new pipes.
 * The production checkout retains the committed batches; read that history
 * without modifying inventory data or the publication pipeline.
 */
export function getPublicRecentNewProductBatches(previousDate: string) {
  const root = process.cwd();
  const batches: PublicRecentNewProductsFile[] = [];
  try {
    const current = parseBatch(fs.readFileSync(path.join(root, RECENT_NEW_PATH), "utf8"));
    if (current) batches.push(current);
  } catch {
    // A missing current index must not prevent the previous day's fallback.
  }

  const cacheKey = `${root}:${previousDate}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return uniqueBatches([...batches, ...cached.batches]);

  const history: PublicRecentNewProductsFile[] = [];
  const options = {
    cwd: root,
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    timeout: 5000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  };
  try {
    // Shanghai midnight is 16:00 UTC on the preceding UTC calendar date.
    const since = new Date(`${previousDate}T00:00:00+08:00`).toISOString();
    const revisions = execFileSync("git", [
      "log", "--since-as-filter=" + since, "--format=%H", "--", RECENT_NEW_PATH,
    ], options).trim().split(/\r?\n/).filter(Boolean);

    for (const revision of revisions) {
      const batch = parseBatch(execFileSync("git", [
        "show", `${revision}:${RECENT_NEW_PATH}`,
      ], options));
      if (batch) history.push(batch);
    }
    historyCache.clear();
    historyCache.set(cacheKey, { expiresAt: Date.now() + 60_000, batches: history });
  } catch {
    // Current batches still work in checkouts that do not retain Git history.
    // Do not cache a transient history read failure.
  }
  return uniqueBatches([...batches, ...history]);
}
