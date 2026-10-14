import "server-only";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PublicCatalogProduct, PublicRecentNewProductsFile, PublicSource } from "./types";

const RECENT_NEW_PATH = "data/generated/public-products/recent-new.json";
const CATALOG_PATH = "data/generated/public-products/catalog.json";
const SOURCE_PRODUCT_PATHS = [
  { source: "danish", path: "data/products/danish-products.json" },
  { source: "gqtobaccos", path: "data/products/gqtobaccos-products.json" },
] as const;
const historyCache = new Map<string, {
  expiresAt: number;
  batches: PublicRecentNewProductsFile[];
}>();
const previouslySeenCache = new Map<string, Set<string>>();

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

function sourceProductId(row: Record<string, unknown>, source: PublicSource) {
  const id = String(row.sourceProductId ?? row.id ?? "").trim();
  return id.startsWith(`${source}-`) ? id.slice(source.length + 1) : id;
}

function previouslySeenIds(parent: string, source: PublicSource, file: string, ids: Set<string>, options: Parameters<typeof execFileSync>[2]) {
  const key = `${options?.cwd}:${parent}:${source}:${[...ids].sort().join(",")}`;
  const cached = previouslySeenCache.get(key);
  if (cached) return cached;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alternatives = [...ids].flatMap((id) => [escape(id), escape(`${source}-${id}`)]).join("|");
  const numeric = [...ids].filter((id) => /^\d+$/.test(id)).join("|");
  const values = `"(${alternatives})"${numeric ? `|(${numeric})` : ""}`;
  const expression = `"(id|sourceProductId)"[[:space:]]*:[[:space:]]*(${values})[[:space:],}]`;
  const patches = execFileSync("git", [
    "log", "--first-parent", "--format=", "-p", "--unified=0", "-G", expression, parent, "--", file,
  ], options).toString();
  const seen = new Set<string>();
  for (const match of patches.matchAll(/"(?:id|sourceProductId)"\s*:\s*("(?:\\.|[^"\\])*"|\d+)\s*[,}]/g)) {
    const id = sourceProductId({ id: JSON.parse(match[1]) }, source);
    if (ids.has(id)) seen.add(id);
  }
  if (previouslySeenCache.size >= 128) previouslySeenCache.clear();
  previouslySeenCache.set(key, seen);
  return seen;
}

/** Other publishers update their source files without writing recent-new.json. */
function readSourceNewBatches(since: string, options: Parameters<typeof execFileSync>[2]) {
  const batches: PublicRecentNewProductsFile[] = [];
  const readAt = (revision: string, file: string) => JSON.parse(
    execFileSync("git", ["show", `${revision}:${file}`], options).toString()
  );
  for (const entry of SOURCE_PRODUCT_PATHS) {
    const revisions = execFileSync("git", [
      "log", "--first-parent", "--since-as-filter=" + since,
      "--format=%H%x09%cI", "--", entry.path,
    ], options).toString().trim().split(/\r?\n/).filter(Boolean);
    for (const record of revisions) {
      const [revision, generatedAt] = record.split("\t");
      const rows = readAt(revision, entry.path) as Record<string, unknown>[];
      const parent = execFileSync("git", [
        "rev-list", "--parents", "-n", "1", revision,
      ], options).toString().trim().split(/\s+/)[1];
      const previousFile = parent ? execFileSync("git", [
        "ls-tree", parent, "--", entry.path,
      ], options).toString().trim() : "";
      const previous = previousFile
        ? readAt(parent, entry.path) as Record<string, unknown>[]
        : [];
      const oldIds = new Set(previous.map((row) => sourceProductId(row, entry.source)));
      const newIds = new Set(rows.map((row) => sourceProductId(row, entry.source))
        .filter((id) => id && !oldIds.has(id)));
      if (!newIds.size) continue;
      if (parent) {
        // Disappeared rows can drop out of a source file. Their later return is
        // inventory movement, rather than a newly introduced product.
        for (const id of previouslySeenIds(parent, entry.source, entry.path, newIds, options)) newIds.delete(id);
      }
      if (!newIds.size) continue;
      const catalog = readAt(revision, CATALOG_PATH) as { products: PublicCatalogProduct[] };
      const products = catalog.products.filter((product) =>
        product.source === entry.source && newIds.has(product.sourceProductId)
      );
      if (products.length) batches.push({ schemaVersion: 1, generatedAt, source: entry.source, products });
    }
  }
  return batches;
}

/**
 * Each release replaces recent-new.json, including releases with zero new pipes.
 * The production checkout retains the committed batches; read that history
 * without modifying inventory data or the publication pipeline.
 */
export function getPublicRecentNewProductBatches(previousDate: string) {
  const recentNewPath = path.join(process.cwd(), RECENT_NEW_PATH);
  let root = process.cwd();
  try {
    // Application releases link their data directory to the publisher checkout.
    // Read history in that real checkout, rather than the Git-less build folder.
    const publicProductsRoot = fs.realpathSync(path.dirname(recentNewPath));
    root = path.resolve(publicProductsRoot, "..", "..", "..");
  } catch {
    // Ordinary checkouts still use their working directory if data is absent.
  }
  const batches: PublicRecentNewProductsFile[] = [];
  try {
    const current = parseBatch(fs.readFileSync(recentNewPath, "utf8"));
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
    maxBuffer: 128 * 1024 * 1024,
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
    history.push(...readSourceNewBatches(since, options));
    historyCache.clear();
    historyCache.set(cacheKey, { expiresAt: Date.now() + 60_000, batches: history });
  } catch {
    // Current batches still work in checkouts that do not retain Git history.
    // Do not cache a transient history read failure.
  }
  return uniqueBatches([...batches, ...history]);
}
