import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSmokingpipesDailySafeDisplayNameEntries } from "../generate-product-displayname-zh-safe-candidates.mjs";
import {
  buildPublicProductsFullCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const HISTORICAL_BATCHES = [
  { commit: "3ec8f89", label: "2026-07-09" },
  { commit: "a0cd714", label: "2026-07-10" },
  { commit: "aa6b346", label: "2026-07-13" },
  { commit: "cc15958", label: "2026-07-18" },
];
const SAFE_INDEX_PATH = "data/i18n/product-displayname-zh-safe-candidates.json";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceItems(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function collectHistoricalIds() {
  const batches = [];
  const ids = new Set();
  for (const batch of HISTORICAL_BATCHES) {
    const content = execFileSync(
      "git",
      ["show", `${batch.commit}:data/generated/public-products/recent-new.json`],
      { cwd: ROOT, encoding: "utf8" }
    );
    const payload = JSON.parse(content);
    const batchIds = [...new Set(sourceItems(payload).map((item) => text(item.id)).filter(Boolean))];
    batchIds.forEach((id) => ids.add(id));
    batches.push({
      ...batch,
      generatedAt: text(payload.generatedAt),
      count: sourceItems(payload).length,
      uniqueCanonicalIds: batchIds.length,
    });
  }
  return { batches, ids };
}

function nextSafeIndex(existing, created) {
  const items = [...(Array.isArray(existing.items) ? existing.items : []), ...created];
  const bySource = {};
  for (const item of items) bySource[item.source] = (bySource[item.source] || 0) + 1;
  return {
    ...existing,
    summary: {
      ...(existing.summary || {}),
      total: items.length,
      bySource,
    },
    items,
  };
}

async function main() {
  const outputDir = argument("--output-dir");
  if (!outputDir) throw new Error("--output-dir is required");

  const outputRoot = path.resolve(outputDir);
  const safeIndex = await readJson(path.join(ROOT, SAFE_INDEX_PATH));
  const products = await readJson(path.join(ROOT, "data/products/smokingpipes-products.json"));
  const staging = await readJson(path.join(ROOT, "data/products/unified-products-staging.json"));
  const currentCatalog = await readJson(path.join(ROOT, "data/generated/public-products/catalog.json"));
  const brandFinal = await readJson(
    path.join(ROOT, "data/review/product-displayname-zh-brand-decisions-final-20260616.json")
  );
  const shapeFinal = await readJson(
    path.join(ROOT, "data/review/product-displayname-zh-shape-decisions-final-20260616.json")
  );
  const history = collectHistoricalIds();
  const catalogIds = new Set(sourceItems(currentCatalog).map((item) => text(item.id)));
  const publicHistoryIds = [...history.ids].filter((id) => catalogIds.has(id));
  const productsById = new Map(sourceItems(products).map((item) => [text(item.id), item]));
  const targets = publicHistoryIds.map((id) => productsById.get(id)).filter(Boolean);
  const preservedItems = (safeIndex.items || []).filter(
    (item) => !Array.isArray(item.warnings) || !item.warnings.includes("dailyGenerated")
  );
  const beforeById = new Map(preservedItems.map((item) => [text(item.id), item]));
  const missingBefore = targets.filter(
    (product) => !text(beforeById.get(text(product.id))?.safeDisplayNameZh)
  );
  const generated = buildSmokingpipesDailySafeDisplayNameEntries({
    products: missingBefore,
    existingItems: preservedItems,
    brandFinal,
    shapeFinal,
  });
  const nextIndex = nextSafeIndex({ ...safeIndex, items: preservedItems }, generated.created);
  const afterById = new Map(nextIndex.items.map((item) => [text(item.id), item]));
  const pricingContext = await loadPublicProductsPricingContext();
  const publicCandidate = buildPublicProductsFullCandidate(staging, pricingContext);
  const currentRecent = await readJson(path.join(ROOT, "data/generated/public-products/recent-new.json"));
  const recentIds = sourceItems(currentRecent).map((item) => text(item.id)).filter(Boolean);
  const catalogCandidateIds = new Set(publicCandidate.catalog.products.map((item) => text(item.id)));
  const duplicateRecentIds = recentIds.filter((id, index) => recentIds.indexOf(id) !== index);
  const recentMissingPublic = recentIds.filter((id) => !catalogCandidateIds.has(id));
  const recentMissingSafe = recentIds.filter(
    (id) => !text(afterById.get(id)?.safeDisplayNameZh)
  );
  const report = {
    version: "smokingpipes-daily-safe-name-backfill-v1",
    mode: "offline-candidate",
    productionWritten: false,
    batches: history.batches,
    counts: {
      batches: history.batches.length,
      historicalUniqueCanonicalIds: history.ids.size,
      currentPublicHistoricalIds: publicHistoryIds.length,
      currentPublicProductsFound: targets.length,
      safeNamesBefore: targets.length - missingBefore.length,
      safeNamesMissingBefore: missingBefore.length,
      generatedSafeNames: generated.created.length,
      reviewRequired: generated.review.length,
      safeNamesAfter: targets.filter((product) =>
        text(afterById.get(text(product.id))?.safeDisplayNameZh)
      ).length,
      duplicateCanonicalIds: duplicateRecentIds.length,
      recentNewMissingPublic: recentMissingPublic.length,
      recentNewMissingSafeName: recentMissingSafe.length,
    },
    review: generated.review,
    samples: generated.created.slice(0, 10).map((item) => ({
      id: item.id,
      originalName: item.originalName,
      safeDisplayNameZh: item.safeDisplayNameZh,
      quality: item.quality,
    })),
  };

  await writeJson(path.join(outputRoot, "safe-name-index-candidate.json"), nextIndex);
  await writeJson(path.join(outputRoot, "public-products", "catalog.json"), publicCandidate.catalog);
  await writeJson(path.join(outputRoot, "public-products", "recent-new.json"), currentRecent);
  await writeJson(path.join(outputRoot, "public-products", "detail-lookup.json"), publicCandidate.lookup);
  for (const shard of publicCandidate.detailShards || []) {
    await writeJson(path.join(outputRoot, "public-products", "details", `${shard.shard}.json`), shard.content);
  }
  await writeJson(path.join(outputRoot, "backfill-audit.json"), report);

  if (hasFlag("--apply-safe-index")) {
    if (recentMissingPublic.length || duplicateRecentIds.length || recentMissingSafe.length) {
      throw new Error("Refusing to apply: offline validator has unresolved blockers.");
    }
    await writeJson(path.join(ROOT, SAFE_INDEX_PATH), nextIndex);
    report.productionWritten = true;
    await writeJson(path.join(outputRoot, "backfill-audit.json"), report);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
