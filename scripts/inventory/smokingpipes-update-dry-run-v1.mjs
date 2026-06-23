import process from "node:process";
import { fetchSmokingpipesCurrentList } from "./smokingpipes-fetch-current-list-v1.mjs";
import { diffSmokingpipesInventory } from "./smokingpipes-diff-inventory-v1.mjs";
import {
  PATHS,
  isDirectExecution,
  parseCliOptions,
  readJson,
  relativePath,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-common-v1.mjs";

function buildRecentNew(diff, currentPayload) {
  const currentById = new Map(
    (currentPayload.products || []).map((item) => [item.sourceProductId, item])
  );
  const newProducts = diff.newIds
    .map((sourceProductId) => currentById.get(sourceProductId))
    .filter(Boolean)
    .map((item) => ({
      id: `smokingpipes-${item.sourceProductId}`,
      sourceProductId: item.sourceProductId,
      brandName: item.brand || "",
      title: item.title || item.rawTitle || "",
      sourceUrl: item.sourceUrl || "",
      price: item.price || "",
      mainImage: item.mainImage || item.image || "",
    }));

  return {
    version: "recent-new-dry-run-v1",
    generatedAt: new Date().toISOString(),
    source: "smokingpipes",
    note: "List-level candidates only. Not connected to homepage UI and not applied to production data.",
    newProductIds: diff.newIds,
    newProducts,
  };
}

function reportList(ids, productById, limit = 20) {
  if (!ids.length) return "- none";

  return ids.slice(0, limit).map((id) => {
    const item = productById.get(id);
    if (!item) return `- ${id}`;
    const title =
      item.title ||
      item.rawTitle ||
      item.displayNameEn ||
      "(missing title)";
    const brand =
      item.brand ||
      item.brandName ||
      item.canonicalBrand ||
      item.rawBrand ||
      "(missing brand)";
    const price =
      item.price?.current?.rawText ||
      item.price ||
      "(missing price)";
    return `- ${id} | ${brand} | ${title} | ${
      typeof price === "string" ? price : JSON.stringify(price)
    }`;
  }).join("\n");
}

function buildMarkdownReport(diff, currentPayload, existingPayload) {
  const currentById = new Map(
    (currentPayload.products || []).map((item) => [item.sourceProductId, item])
  );
  const existingById = new Map(
    (Array.isArray(existingPayload) ? existingPayload : []).map((item) => [
      item.sourceProductId,
      item,
    ])
  );
  const fatalWarnings = diff.fatalWarnings.length
    ? diff.fatalWarnings.map((item) => `- ${item}`).join("\n")
    : "- none";
  const warnings = diff.warnings.length
    ? diff.warnings.map((item) => `- ${item}`).join("\n")
    : "- none";

  return `# Smokingpipes Inventory Update Dry-Run V1

## Run

- generatedAt: ${diff.generatedAt}
- mode: dry-run
- source: smokingpipes new pipes
- manualVerification: ${Boolean(
    currentPayload.config?.manualVerification
  )}
- captchaDetected: ${Boolean(currentPayload.summary?.captchaDetected)}
- captchaPages: ${(currentPayload.summary?.captchaPages || []).join(", ") || "none"}
- maxPages: ${currentPayload.config?.maxPages || 0}
- pages scanned: ${diff.coverage.pagesScanned}
- expected full-list pages: ${diff.coverage.expectedPages}
- current list products: ${diff.counts.currentAvailable}
- out-of-stock products observed: ${
    currentPayload.summary?.outOfStockProducts || 0
  }
- missing-price products observed: ${
    currentPayload.summary?.missingPriceProducts || 0
  }
- existing local products: ${diff.counts.existing}
- existing available products: ${diff.counts.existingAvailable}
- new candidates: ${diff.counts.new}
- new candidate classification: ${
    diff.coverage.fullExpectedRangeScanned
      ? "confirmed full-scan candidates"
      : "partial scan candidates; do not start detail fetching by default"
  }
- still available: ${diff.counts.stillAvailable}
- disappeared/sold candidates: ${diff.counts.disappeared}
- unchanged sold: ${diff.counts.unchangedSold}
- suspicious IDs: ${diff.counts.suspicious}
- allow apply: ${diff.allowApply ? "YES" : "NO"}
- allowApply: ${diff.allowApply}
- reason: ${
    diff.applyBlockedReasons.length
      ? diff.applyBlockedReasons.join("; ")
      : "all safety gates passed"
  }

## Safety Decision

This report never changes production data. Disappeared products are candidates only and must not be deleted. A future apply step may mark safe candidates as sold/reference only when this report says allow apply: YES.

### Fatal warnings

${fatalWarnings}

### Warnings

${warnings}

## First 20 New Candidates

${reportList(diff.newIds, currentById)}

## First 20 Disappeared / Sold Candidates

${reportList(diff.disappearedIds, existingById)}

## Output Files

- data/inventory/smokingpipes-current-list-dry-run.json
- data/inventory/smokingpipes-inventory-diff-dry-run.json
- data/inventory/recent-new-dry-run.json
- data/review/smokingpipes-inventory-update-report-v1.md
`;
}

export async function runSmokingpipesInventoryDryRun(options = {}) {
  const current = await fetchSmokingpipesCurrentList(options);
  const diff = await diffSmokingpipesInventory();
  const currentFromDisk = readJson(PATHS.currentList);
  const existingProducts = readJson(PATHS.existingProducts);
  const recentNew = buildRecentNew(diff, currentFromDisk);
  const report = buildMarkdownReport(
    diff,
    currentFromDisk,
    existingProducts
  );

  await writeJsonAtomic(PATHS.recentNew, recentNew);
  await writeTextAtomic(PATHS.report, report);

  const summary = {
    currentList: relativePath(PATHS.currentList),
    diff: relativePath(PATHS.diff),
    recentNew: relativePath(PATHS.recentNew),
    report: relativePath(PATHS.report),
    pagesScanned: current.summary.pagesScanned,
    counts: diff.counts,
    fatalWarnings: diff.fatalWarnings,
    warnings: diff.warnings,
    allowApply: diff.allowApply,
  };

  console.log(JSON.stringify(summary, null, 2));
  return { current, diff, recentNew, summary };
}

if (isDirectExecution(import.meta.url)) {
  const cli = parseCliOptions();
  await runSmokingpipesInventoryDryRun({
    maxPages: cli["max-pages"],
    expectedPages: cli["expected-pages"],
    displayNum: cli["display-num"],
    browserChannel: cli["browser-channel"],
    browserProfile: cli["browser-profile"],
    browserProfileDir: cli["browser-profile-dir"],
    pageDelayMs: cli["page-delay-ms"],
    pageDelayMinMs: cli["page-delay-min-ms"],
    pageDelayMaxMs: cli["page-delay-max-ms"],
    pageWarmupMinMs: cli["page-warmup-min-ms"],
    pageWarmupMaxMs: cli["page-warmup-max-ms"],
    pageBatchSize: cli["page-batch-size"],
    pageBatchCooldownMinMs: cli["page-batch-cooldown-min-ms"],
    pageBatchCooldownMaxMs: cli["page-batch-cooldown-max-ms"],
    captchaCooldownMs: cli["captcha-cooldown-ms"],
    allowManualVerification: cli["allow-manual-verification"],
    manualVerificationTimeoutMs: cli["manual-verification-timeout-ms"],
    verbose: cli.verbose,
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
