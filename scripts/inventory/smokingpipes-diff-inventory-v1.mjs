import process from "node:process";
import {
  PATHS,
  arrayFromPayload,
  duplicateValues,
  isDirectExecution,
  normalizeText,
  readJson,
  relativePath,
  sortIds,
  writeJsonAtomic,
} from "./inventory-common-v1.mjs";

const SAFETY_THRESHOLDS = {
  minimumCurrentVsHistoricalAvailableRatio: 0.5,
  maximumDisappearedVsHistoricalAvailableRatio: 0.35,
  maximumNewVsExistingRatio: 0.25,
  maximumSuspiciousRatio: 0.05,
};

function productId(item) {
  const direct = normalizeText(item?.sourceProductId);
  if (direct) return direct;
  const sourceUrl = normalizeText(item?.sourceUrl || item?.href);
  return sourceUrl.match(/[?&]product_id=(\d+)/i)?.[1] || "";
}

function currentSuspiciousRecords(products) {
  const records = [];
  const duplicateIds = new Set(
    duplicateValues(products.map((item) => productId(item)))
  );
  const duplicateUrls = new Set(
    duplicateValues(products.map((item) => item.sourceUrl))
  );

  for (const item of products) {
    const id = productId(item);
    const sourceUrl = normalizeText(item.sourceUrl);
    const urlId = sourceUrl.match(/[?&]product_id=(\d+)/i)?.[1] || "";
    const reasons = [];

    if (!id || !/^\d+$/.test(id)) reasons.push("invalid-source-product-id");
    if (!sourceUrl) reasons.push("missing-source-url");
    if (id && urlId && id !== urlId) reasons.push("url-id-mismatch");
    if (duplicateIds.has(id)) reasons.push("duplicate-source-product-id");
    if (sourceUrl && duplicateUrls.has(sourceUrl)) {
      reasons.push("duplicate-source-url");
    }
    if (!normalizeText(item.title || item.rawTitle)) reasons.push("missing-title");

    const price = normalizeText(item.price);
    if (price && !/\$\s*[\d,]+(?:\.\d{1,2})?/.test(price)) {
      reasons.push("unrecognized-price");
    }

    if (reasons.length) {
      records.push({
        sourceProductId: id,
        sourceUrl,
        title: normalizeText(item.title || item.rawTitle),
        reasons,
      });
    }
  }

  return records;
}

function ratio(numerator, denominator) {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export function buildInventoryDiff(currentPayload, existingPayload) {
  const currentProducts = arrayFromPayload(currentPayload, ["products"]);
  const existingProducts = arrayFromPayload(existingPayload, ["products"]);
  const currentById = new Map(
    currentProducts
      .map((item) => [productId(item), item])
      .filter(([id]) => id)
  );
  const existingById = new Map(
    existingProducts
      .map((item) => [productId(item), item])
      .filter(([id]) => id)
  );

  const currentIds = new Set(currentById.keys());
  const existingIds = new Set(existingById.keys());
  const existingAvailableIds = new Set(
    existingProducts
      .filter((item) => normalizeText(item.inventoryStatus) === "available")
      .map(productId)
      .filter(Boolean)
  );
  const existingSoldIds = new Set(
    existingProducts
      .filter((item) => normalizeText(item.inventoryStatus) === "sold")
      .map(productId)
      .filter(Boolean)
  );

  const newIds = sortIds([...currentIds].filter((id) => !existingIds.has(id)));
  const stillAvailableIds = sortIds(
    [...currentIds].filter((id) => existingIds.has(id))
  );
  const disappearedIds = sortIds(
    [...existingAvailableIds].filter((id) => !currentIds.has(id))
  );
  const unchangedSoldIds = sortIds(
    [...existingSoldIds].filter((id) => !currentIds.has(id))
  );
  const reappearedIds = sortIds(
    [...existingSoldIds].filter((id) => currentIds.has(id))
  );
  const suspiciousRecords = currentSuspiciousRecords(currentProducts);
  for (const duplicateId of currentPayload?.summary
    ?.duplicateSourceProductIds || []) {
    suspiciousRecords.push({
      sourceProductId: normalizeText(duplicateId),
      sourceUrl: "",
      title: "",
      reasons: ["duplicate-source-product-id-detected-during-fetch"],
    });
  }
  const suspiciousIds = sortIds(
    new Set(
      suspiciousRecords
        .map((item) => item.sourceProductId)
        .filter(Boolean)
    )
  );

  const pagesScanned = Number(currentPayload?.summary?.pagesScanned || 0);
  const pagesRequested = Number(currentPayload?.summary?.pagesRequested || 0);
  const expectedPages = Number(
    currentPayload?.summary?.expectedPages ||
      currentPayload?.config?.expectedPages ||
      0
  );
  const currentVsHistoricalRatio = ratio(
    currentIds.size,
    existingAvailableIds.size
  );
  const disappearedRatio = ratio(
    disappearedIds.length,
    existingAvailableIds.size
  );
  const newRatio = ratio(newIds.length, existingIds.size);
  const suspiciousRatio = ratio(suspiciousRecords.length, currentProducts.length);
  const fatalWarnings = [];
  const warnings = [];

  if (pagesScanned < pagesRequested) {
    fatalWarnings.push(
      `Only ${pagesScanned}/${pagesRequested} requested pages were scanned.`
    );
  }
  if (expectedPages > 0 && pagesScanned < expectedPages) {
    warnings.push(
      `Partial scan: ${pagesScanned}/${expectedPages} expected full-list pages.`
    );
  }
  if (
    currentVsHistoricalRatio <
    SAFETY_THRESHOLDS.minimumCurrentVsHistoricalAvailableRatio
  ) {
    fatalWarnings.push(
      `Current list is ${(currentVsHistoricalRatio * 100).toFixed(
        2
      )}% of historical available inventory; minimum is ${
        SAFETY_THRESHOLDS.minimumCurrentVsHistoricalAvailableRatio * 100
      }%.`
    );
  }
  if (
    disappearedRatio >
    SAFETY_THRESHOLDS.maximumDisappearedVsHistoricalAvailableRatio
  ) {
    fatalWarnings.push(
      `Disappeared candidates are ${(disappearedRatio * 100).toFixed(
        2
      )}% of historical available inventory; maximum is ${
        SAFETY_THRESHOLDS.maximumDisappearedVsHistoricalAvailableRatio * 100
      }%.`
    );
  }
  if (newRatio > SAFETY_THRESHOLDS.maximumNewVsExistingRatio) {
    fatalWarnings.push(
      `New candidate ratio ${(newRatio * 100).toFixed(
        2
      )}% exceeds maximum ${
        SAFETY_THRESHOLDS.maximumNewVsExistingRatio * 100
      }%.`
    );
  }
  if (suspiciousRatio > SAFETY_THRESHOLDS.maximumSuspiciousRatio) {
    fatalWarnings.push(
      `Suspicious record ratio ${(suspiciousRatio * 100).toFixed(
        2
      )}% exceeds maximum ${
        SAFETY_THRESHOLDS.maximumSuspiciousRatio * 100
      }%.`
    );
  } else if (suspiciousRecords.length) {
    warnings.push(
      `${suspiciousRecords.length} current-list records require manual review.`
    );
  }

  const fullExpectedRangeScanned =
    expectedPages > 0 && pagesScanned >= expectedPages;
  const allowApply =
    fatalWarnings.length === 0 &&
    fullExpectedRangeScanned &&
    suspiciousRecords.length === 0;
  const applyBlockedReasons = [];

  if (!fullExpectedRangeScanned) {
    applyBlockedReasons.push(
      `partial page coverage: ${pagesScanned}/${expectedPages} pages; full coverage is required`
    );
  }
  if (fatalWarnings.length) {
    applyBlockedReasons.push("fatal safety warnings are present");
  }
  if (suspiciousRecords.length) {
    applyBlockedReasons.push("suspicious records require manual review");
  }

  return {
    version: "smokingpipes-inventory-diff-dry-run-v1",
    generatedAt: new Date().toISOString(),
    source: "smokingpipes",
    mode: "dry-run",
    inputs: {
      currentList: "data/inventory/smokingpipes-current-list-dry-run.json",
      existingProducts: "data/products/smokingpipes-products.json",
    },
    thresholds: SAFETY_THRESHOLDS,
    coverage: {
      pagesRequested,
      pagesScanned,
      expectedPages,
      fullExpectedRangeScanned,
      currentVsHistoricalAvailableRatio: currentVsHistoricalRatio,
    },
    counts: {
      currentAvailable: currentIds.size,
      existing: existingIds.size,
      existingAvailable: existingAvailableIds.size,
      existingSold: existingSoldIds.size,
      new: newIds.length,
      stillAvailable: stillAvailableIds.length,
      disappeared: disappearedIds.length,
      unchangedSold: unchangedSoldIds.length,
      reappeared: reappearedIds.length,
      suspicious: suspiciousRecords.length,
      suspiciousIds: suspiciousIds.length,
      suspiciousRecords: suspiciousRecords.length,
    },
    ratios: {
      newVsExisting: newRatio,
      disappearedVsHistoricalAvailable: disappearedRatio,
      suspiciousVsCurrent: suspiciousRatio,
    },
    currentAvailableIds: sortIds(currentIds),
    existingIds: sortIds(existingIds),
    newIds,
    stillAvailableIds,
    disappearedIds,
    unchangedSoldIds,
    reappearedIds,
    suspiciousIds,
    suspiciousRecords,
    fatalWarnings,
    warnings,
    allowApply,
    applyBlockedReasons,
  };
}

export async function diffSmokingpipesInventory() {
  const currentPayload = readJson(PATHS.currentList);
  const existingPayload = readJson(PATHS.existingProducts);
  const diff = buildInventoryDiff(currentPayload, existingPayload);

  await writeJsonAtomic(PATHS.diff, diff);
  console.log(`Inventory diff dry-run written: ${relativePath(PATHS.diff)}`);
  console.log(
    JSON.stringify(
      {
        counts: diff.counts,
        allowApply: diff.allowApply,
        fatalWarnings: diff.fatalWarnings,
        warnings: diff.warnings,
      },
      null,
      2
    )
  );
  return diff;
}

if (isDirectExecution(import.meta.url)) {
  await diffSmokingpipesInventory().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
