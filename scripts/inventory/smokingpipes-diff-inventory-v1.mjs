import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  PATHS,
  arrayFromPayload,
  duplicateValues,
  isDirectExecution,
  normalizeText,
  parseCliOptions,
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

export const LEGACY_DUPLICATE_SNAPSHOT_CONTRACT = Object.freeze({
  snapshotSha256:
    "CDC102110E0C6E682B28541558F7F3DD6EBED9E5475B35331F9726A4907FCD5D",
  pagesScanned: 111,
  expectedPages: 111,
  productsExtracted: 5327,
  uniqueProducts: 4993,
  duplicateCount: 334,
});
const DEFAULT_MAX_AUTO_APPLY = 1000;

function normalizeSha256(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : "";
}

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

function normalizeDuplicateStats(summary = {}) {
  const duplicateIds = Array.isArray(summary?.duplicateSourceProductIds)
    ? [...new Set(summary.duplicateSourceProductIds.map(String).filter(Boolean))]
    : [];
  const suspiciousDuplicateIds = Array.isArray(
    summary?.suspiciousDuplicateSourceProductIds
  )
    ? [
        ...new Set(
          summary.suspiciousDuplicateSourceProductIds.map(String).filter(Boolean)
        ),
      ]
    : null;
  const raw = summary?.duplicateStats;
  if (!raw || typeof raw !== "object") {
    return {
      totalDuplicateIds: duplicateIds.length,
      safeDuplicateCount: 0,
      suspiciousDuplicateCount: duplicateIds.length,
      suspiciousDuplicateIds: duplicateIds,
      classificationAvailable: false,
    };
  }

  const totalDuplicateIds = Number(raw.totalDuplicateIds);
  const safeDuplicateCount = Number(raw.safeDuplicateCount);
  const suspiciousDuplicateCount = Number(raw.suspiciousDuplicateCount);
  const countsAreConsistent =
    Number.isInteger(totalDuplicateIds) &&
    Number.isInteger(safeDuplicateCount) &&
    Number.isInteger(suspiciousDuplicateCount) &&
    totalDuplicateIds >= 0 &&
    safeDuplicateCount >= 0 &&
    suspiciousDuplicateCount >= 0 &&
    totalDuplicateIds === duplicateIds.length &&
    safeDuplicateCount + suspiciousDuplicateCount === totalDuplicateIds &&
    Array.isArray(suspiciousDuplicateIds) &&
    suspiciousDuplicateIds.length === suspiciousDuplicateCount &&
    suspiciousDuplicateIds.every((id) => duplicateIds.includes(id));

  return countsAreConsistent
    ? {
        totalDuplicateIds,
        safeDuplicateCount,
        suspiciousDuplicateCount,
        suspiciousDuplicateIds,
        classificationAvailable: true,
      }
    : {
        totalDuplicateIds: duplicateIds.length,
        safeDuplicateCount: 0,
        suspiciousDuplicateCount: duplicateIds.length,
        suspiciousDuplicateIds: duplicateIds,
        classificationAvailable: false,
      };
}

export function evaluateLegacyDuplicateSnapshotOverride({
  currentPayload,
  snapshotSha256,
  authorizedSnapshotSha256,
} = {}) {
  const summary = currentPayload?.summary || {};
  const products = arrayFromPayload(currentPayload, ["products"]);
  const duplicateIds = Array.isArray(summary.duplicateSourceProductIds)
    ? [...new Set(summary.duplicateSourceProductIds.map(String).filter(Boolean))]
    : [];
  const actualSha256 = normalizeSha256(snapshotSha256);
  const requestedSha256 = normalizeSha256(authorizedSnapshotSha256);
  const productIds = products.map(productId).filter(Boolean);
  const uniqueProductIds = new Set(productIds);
  const failedPages = Array.isArray(summary.failedPages)
    ? summary.failedPages
    : ["invalid-failed-pages-metadata"];
  const summaryNumbersMatch =
    Number(summary.pagesScanned) === LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.pagesScanned &&
    Number(summary.expectedPages) === LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.expectedPages &&
    Number(summary.productsExtracted) === LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.productsExtracted &&
    Number(summary.uniqueProducts) === LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.uniqueProducts &&
    Number(summary.productsExtracted) - Number(summary.uniqueProducts) ===
      LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.duplicateCount &&
    duplicateIds.length === LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.duplicateCount;
  const dedupedProductsAreUnique =
    products.length === LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.uniqueProducts &&
    productIds.length === products.length &&
    uniqueProductIds.size === products.length;
  const metadataIsLegacyOnly =
    !summary.duplicateStats &&
    !Array.isArray(summary.suspiciousDuplicateSourceProductIds);
  const contractMatches =
    summaryNumbersMatch &&
    summary.fullExpectedRangeScanned === true &&
    failedPages.length === 0 &&
    dedupedProductsAreUnique &&
    metadataIsLegacyOnly;

  let reason = null;
  if (!requestedSha256) {
    reason = "explicit legacy duplicate snapshot SHA-256 authorization is required";
  } else if (
    requestedSha256 !== LEGACY_DUPLICATE_SNAPSHOT_CONTRACT.snapshotSha256
  ) {
    reason = "authorized legacy duplicate snapshot SHA-256 is not the single approved legacy snapshot";
  } else if (!actualSha256 || requestedSha256 !== actualSha256) {
    reason = "authorized legacy duplicate snapshot SHA-256 does not match the current List snapshot";
  } else if (!contractMatches) {
    reason = "current List snapshot does not match the exact one-time legacy duplicate contract";
  }

  return {
    authorized: false,
    eligible: reason === null,
    snapshotSha256: actualSha256 || null,
    requestedSnapshotSha256: requestedSha256 || null,
    duplicateCount: duplicateIds.length,
    reason,
    contract: {
      pagesScanned: Number(summary.pagesScanned || 0),
      expectedPages: Number(summary.expectedPages || 0),
      failedPages: failedPages.length,
      productsExtracted: Number(summary.productsExtracted || 0),
      uniqueProducts: Number(summary.uniqueProducts || 0),
      duplicateCount: duplicateIds.length,
      dedupedSourceProductIdsUnique: dedupedProductsAreUnique,
      duplicateClassificationAvailable: Boolean(summary.duplicateStats),
    },
  };
}

function snapshotSha256ForPath(snapshotPath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(snapshotPath))
    .digest("hex")
    .toUpperCase();
}

export async function updateLegacyDuplicateOverrideAudit({
  root = process.cwd(),
  diff,
  snapshotPath = PATHS.currentList,
  defaultMaxAutoApply = DEFAULT_MAX_AUTO_APPLY,
  runScopedMaxAutoApply = DEFAULT_MAX_AUTO_APPLY,
  wouldApplyCount = null,
  finalGateDecision,
} = {}) {
  if (!diff?.legacyDuplicateOverride) return;
  const auditPath = path.join(
    root,
    "data",
    "audits",
    "smokingpipes-daily-fix",
    "legacy-duplicate-snapshot-override-latest.json"
  );
  const payload = {
    version: "smokingpipes-legacy-duplicate-snapshot-override-audit-v1",
    generatedAt: new Date().toISOString(),
    snapshotPath: path.relative(root, snapshotPath).replace(/\\/g, "/"),
    snapshotSha256: diff.legacyDuplicateOverride.snapshotSha256,
    legacyDuplicateCount: diff.legacyDuplicateOverride.duplicateCount,
    overrideAuthorized: diff.legacyDuplicateOverride.authorized === true,
    overrideReason: diff.legacyDuplicateOverride.reason,
    defaultMaxAutoApply,
    runScopedMaxAutoApply,
    wouldApplyCount,
    finalGateDecision,
  };
  await fs.promises.mkdir(path.dirname(auditPath), { recursive: true });
  const temporaryPath = `${auditPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(
    temporaryPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  await fs.promises.rename(temporaryPath, auditPath);
}

export function buildInventoryDiff(currentPayload, existingPayload, options = {}) {
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
  const soldByAbsenceAllowed =
    currentPayload?.summary?.soldByAbsenceAllowed !== false &&
    currentPayload?.summary?.disappearedApplyAllowed !== false;

  const newIds = sortIds([...currentIds].filter((id) => !existingIds.has(id)));
  const stillAvailableIds = sortIds(
    [...currentIds].filter((id) => existingIds.has(id))
  );
  const disappearedIds = soldByAbsenceAllowed
    ? sortIds([...existingAvailableIds].filter((id) => !currentIds.has(id)))
    : [];
  const unchangedSoldIds = soldByAbsenceAllowed
    ? sortIds([...existingSoldIds].filter((id) => !currentIds.has(id)))
    : [];
  const reappearedIds = sortIds(
    [...existingSoldIds].filter((id) => currentIds.has(id))
  );
  const duplicateStats = normalizeDuplicateStats(currentPayload?.summary);
  const legacyDuplicateOverride =
    duplicateStats.classificationAvailable === false &&
    duplicateStats.totalDuplicateIds > 0
      ? evaluateLegacyDuplicateSnapshotOverride({
          currentPayload,
          snapshotSha256: options.snapshotSha256,
          authorizedSnapshotSha256: options.legacyDuplicateSnapshotSha256,
        })
      : null;
  const suspiciousRecords = currentSuspiciousRecords(currentProducts);
  const baseSuspiciousRecords = [...suspiciousRecords];
  const failedPages = currentPayload?.summary?.failedPages || [];
  const pagesScanned = Number(currentPayload?.summary?.pagesScanned || 0);
  const effectiveScannedPages = Number(
    currentPayload?.summary?.effectiveScannedPages || pagesScanned
  );
  const pagesRequested = Number(currentPayload?.summary?.pagesRequested || 0);
  const expectedPages = Number(
    currentPayload?.summary?.expectedPages ||
      currentPayload?.summary?.detectedTotalPages ||
      currentPayload?.config?.expectedPages ||
      0
  );
  const fullExpectedRangeScanned =
    currentPayload?.summary?.fullExpectedRangeScanned === true &&
    expectedPages > 0 &&
    failedPages.length === 0 &&
    effectiveScannedPages >= expectedPages;
  const currentVsHistoricalRatio = ratio(
    currentIds.size,
    existingAvailableIds.size
  );
  const disappearedRatio = ratio(
    disappearedIds.length,
    existingAvailableIds.size
  );
  const newRatio = ratio(newIds.length, existingIds.size);
  const captchaDetected =
    currentPayload?.summary?.captchaDetected === true ||
    (currentPayload?.summary?.captchaPages || []).length > 0;
  const otherSafetyFatal =
    captchaDetected ||
    !fullExpectedRangeScanned ||
    !soldByAbsenceAllowed ||
    currentVsHistoricalRatio <
      SAFETY_THRESHOLDS.minimumCurrentVsHistoricalAvailableRatio ||
    disappearedRatio >
      SAFETY_THRESHOLDS.maximumDisappearedVsHistoricalAvailableRatio ||
    newRatio > SAFETY_THRESHOLDS.maximumNewVsExistingRatio ||
    baseSuspiciousRecords.length > 0;
  if (legacyDuplicateOverride?.eligible && !otherSafetyFatal) {
    legacyDuplicateOverride.authorized = true;
    legacyDuplicateOverride.reason =
      "explicit one-time authorization for legacy snapshot without duplicate event metadata";
  } else if (legacyDuplicateOverride?.eligible) {
    legacyDuplicateOverride.reason =
      "legacy duplicate authorization cannot apply while other safety gates are failing";
  }
  const duplicateIdsForSafety = legacyDuplicateOverride?.authorized
    ? []
    : duplicateStats.suspiciousDuplicateIds;
  for (const duplicateId of duplicateIdsForSafety) {
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

  const tailCacheUsed = currentPayload?.summary?.tailCacheUsed === true;
  const skippedOutOfStockTailPages =
    currentPayload?.summary?.skippedOutOfStockTailPages || [];
  const suspiciousRatio = ratio(suspiciousRecords.length, currentProducts.length);
  const fatalWarnings = [];
  const warnings = [];

  if (captchaDetected) {
    fatalWarnings.push(
      "captcha/currentListVerificationDetected: current-list verification was detected; this snapshot is not trusted."
    );
  }
  if (expectedPages > 0 && effectiveScannedPages < expectedPages) {
    warnings.push(
      `Partial scan: ${effectiveScannedPages}/${expectedPages} expected full-list pages.`
    );
  }
  if (!soldByAbsenceAllowed) {
    warnings.push(
      "sold-by-absence/disappeared apply disabled because out-of-stock tail pages were skipped."
    );
  }
  if (duplicateStats.safeDuplicateCount > 0) {
    warnings.push(
      `${duplicateStats.safeDuplicateCount} duplicate sourceProductId records were classified as safe pagination overlap.`
    );
  }
  if (legacyDuplicateOverride?.authorized) {
    warnings.push(
      `${legacyDuplicateOverride.duplicateCount} legacy duplicate sourceProductId metadata entries were allowed only by exact snapshot SHA-256 authorization.`
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

  const allowApply =
    fatalWarnings.length === 0 &&
    fullExpectedRangeScanned &&
    suspiciousRecords.length === 0 &&
    soldByAbsenceAllowed;
  const applyBlockedReasons = [];

  if (!fullExpectedRangeScanned) {
    applyBlockedReasons.push(
      `partial page coverage: ${effectiveScannedPages}/${expectedPages} pages; full coverage is required`
    );
  }
  if (!soldByAbsenceAllowed) {
    applyBlockedReasons.push(
      "sold-by-absence/disappeared apply is disabled because out-of-stock tail pages were skipped"
    );
  }
  if (captchaDetected) {
    applyBlockedReasons.push(
      "current-list verification was detected"
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
      effectiveScannedPages,
      expectedPages,
      failedPages,
      detectedTotalPages:
        currentPayload?.summary?.detectedTotalPages || expectedPages,
      fullExpectedRangeScanned,
      tailCacheUsed,
      skippedOutOfStockTailPages,
      soldByAbsenceAllowed,
      disappearedApplyAllowed: soldByAbsenceAllowed,
      captchaDetected,
      captchaPages: currentPayload?.summary?.captchaPages || [],
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
      duplicateIds: duplicateStats.totalDuplicateIds,
      safeDuplicates: duplicateStats.safeDuplicateCount,
      suspiciousDuplicates: duplicateStats.suspiciousDuplicateCount,
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
    duplicateStats,
    legacyDuplicateOverride,
    fatalWarnings,
    warnings,
    allowApply,
    applyBlockedReasons,
  };
}

export async function diffSmokingpipesInventory(options = {}) {
  const currentListPath = options.currentListPath
    ? path.resolve(options.currentListPath)
    : PATHS.currentList;
  const existingProductsPath = options.existingProductsPath
    ? path.resolve(options.existingProductsPath)
    : PATHS.existingProducts;
  const diffPath = options.diffPath ? path.resolve(options.diffPath) : PATHS.diff;
  const currentPayload = readJson(currentListPath);
  const existingPayload = readJson(existingProductsPath);
  const diff = buildInventoryDiff(currentPayload, existingPayload, {
    legacyDuplicateSnapshotSha256:
      options.legacyDuplicateSnapshotSha256,
    snapshotSha256: snapshotSha256ForPath(currentListPath),
  });

  await writeJsonAtomic(diffPath, diff);
  await updateLegacyDuplicateOverrideAudit({
    root: process.cwd(),
    snapshotPath: currentListPath,
    diff,
    runScopedMaxAutoApply:
      Number(options.maxAutoApply) > 0
        ? Number(options.maxAutoApply)
        : DEFAULT_MAX_AUTO_APPLY,
    finalGateDecision: diff.allowApply ? "diff-allowed" : "diff-blocked",
  });
  console.log(`Inventory diff dry-run written: ${relativePath(diffPath)}`);
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
  const cli = parseCliOptions();
  await diffSmokingpipesInventory({
    currentListPath: cli["current-list"],
    existingProductsPath: cli["existing-products"],
    diffPath: cli.diff,
    legacyDuplicateSnapshotSha256:
      cli["legacy-duplicate-snapshot-sha256"],
    maxAutoApply: cli["max-auto-apply"],
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
