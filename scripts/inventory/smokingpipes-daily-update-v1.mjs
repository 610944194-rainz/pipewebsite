import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { convertSmokingpipesCandidateDetails } from "../convert-smokingpipes-products-v2.mjs";
import { buildUnifiedProductsFromInputs } from "../build-unified-products-staging-v1.mjs";
import {
  buildPublicProductsFullCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";
import {
  acquireRunLock,
  buildDetailsQueue,
  classifyRunnerError,
  collectValidCachedDetails,
  collectValidQueueTempDetails,
  formatRunId,
  getRunnerPaths,
  readJsonIfExists,
  releaseRunLock,
  summarizeDetailsQueue,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  buildSmokingpipesApplyCandidate,
  validatePublicProductsNextCandidate,
} from "./smokingpipes-apply-dry-run-v1.mjs";
import {
  processSmokingpipesDetailsQueue,
  writeSmokingpipesQueueCheckpoint,
} from "./smokingpipes-details-queue-v1.mjs";
import { runSmokingpipesInventoryDryRun } from "./smokingpipes-update-dry-run-v1.mjs";
import {
  buildVerificationProbeTelemetry,
  buildVerificationTelemetryMarkdown,
} from "./smokingpipes-verification-telemetry-v1.mjs";
import { buildSmokingpipesBrowserDescriptor } from "../lib/smokingpipes-browser-profile-v1.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceProductId(item) {
  return text(item?.sourceProductId);
}

function isOutOfStock(item) {
  return /\b(?:out[\s-]+of[\s-]+stock|sold[\s-]+out|unavailable)\b/i.test(
    `${item?.rawListStatus || ""} ${item?.rawText || ""}`
  );
}

function sorted(values) {
  return [...values].sort((left, right) =>
    String(left).localeCompare(String(right), "en", { numeric: true })
  );
}

function resolveDuplicateStats(summary = {}) {
  const duplicateIds = Array.isArray(summary?.duplicateSourceProductIds)
    ? [...new Set(summary.duplicateSourceProductIds.map(String).filter(Boolean))]
    : [];
  const suspiciousDuplicateIds = Array.isArray(
    summary?.suspiciousDuplicateSourceProductIds
  )
    ? [...new Set(summary.suspiciousDuplicateSourceProductIds.map(String).filter(Boolean))]
    : null;
  const raw = summary?.duplicateStats;
  const totalDuplicateIds = Number(raw?.totalDuplicateIds);
  const safeDuplicateCount = Number(raw?.safeDuplicateCount);
  const suspiciousDuplicateCount = Number(raw?.suspiciousDuplicateCount);
  const validClassification =
    raw &&
    Number.isInteger(totalDuplicateIds) &&
    Number.isInteger(safeDuplicateCount) &&
    Number.isInteger(suspiciousDuplicateCount) &&
    totalDuplicateIds === duplicateIds.length &&
    safeDuplicateCount >= 0 &&
    suspiciousDuplicateCount >= 0 &&
    safeDuplicateCount + suspiciousDuplicateCount === totalDuplicateIds &&
    Array.isArray(suspiciousDuplicateIds) &&
    suspiciousDuplicateIds.length === suspiciousDuplicateCount &&
    suspiciousDuplicateIds.every((id) => duplicateIds.includes(id));

  return validClassification
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

export function buildSmokingpipesDailyDiff({
  productionProducts,
  currentPayload,
  expectedPages = null,
  ignoredIds = [],
}) {
  const productionById = new Map(
    (productionProducts || []).map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const currentById = new Map(
    (currentPayload?.products || []).map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const ignored = new Set((ignoredIds || []).map(String));
  const summary = currentPayload?.summary || {};
  const duplicateStats = resolveDuplicateStats(summary);
  const pagesCompleted = Number(
    summary.pagesCompleted ?? summary.pagesScanned ?? 0
  );
  const pagesFailed = Array.isArray(summary.failedPages)
    ? summary.failedPages.length
    : Number(summary.pagesFailed || 0);
  const lastSuccessfulPage = Number(summary.lastSuccessfulPage || 0);
  const resolvedExpectedPages = Number(
    summary.expectedPages ??
      currentPayload?.config?.expectedPages ??
      expectedPages
  );
  const effectiveScannedPages = Number(
    summary.effectiveScannedPages ?? summary.pagesScanned ?? 0
  );
  const fullExpectedRangeScanned =
    summary.fullExpectedRangeScanned === true &&
    Number.isFinite(resolvedExpectedPages) &&
    resolvedExpectedPages > 0 &&
    Number.isFinite(effectiveScannedPages) &&
    effectiveScannedPages >= resolvedExpectedPages;
  const captchaDetected =
    summary.captchaDetected === true ||
    (summary.captchaPages || []).length > 0;

  const dailyNewIds = [];
  const stillAvailableIds = [];
  const newlySoldOutIds = [];
  const missingPriceButNotSoldIds = [];

  for (const [id, current] of currentById) {
    const production = productionById.get(id);
    if (!production) {
      if (!ignored.has(id)) dailyNewIds.push(id);
      continue;
    }
    if (isOutOfStock(current)) {
      if (
        !["sold", "unavailable"].includes(
          text(production.inventoryStatus).toLowerCase()
        )
      ) {
        newlySoldOutIds.push(id);
      }
      continue;
    }
    stillAvailableIds.push(id);
    if (!text(current.price)) missingPriceButNotSoldIds.push(id);
  }

  const disappearedIds = fullExpectedRangeScanned
    ? [...productionById]
        .filter(
          ([id, product]) =>
            !currentById.has(id) &&
            !["sold", "unavailable"].includes(
              text(product.inventoryStatus).toLowerCase()
            )
        )
        .map(([id]) => id)
    : [];
  const fatalWarnings = [];
  if (!fullExpectedRangeScanned) {
    fatalWarnings.push(
      `Daily update requires a complete ${resolvedExpectedPages}-page current-list scan.`
    );
  }
  if (captchaDetected) {
    fatalWarnings.push(
      "captcha/currentListVerificationDetected: Daily update current-list scan recorded strong verification."
    );
  }
  if (duplicateStats.suspiciousDuplicateCount > 0) {
    fatalWarnings.push(
      `${duplicateStats.suspiciousDuplicateCount} duplicate sourceProductId records have conflicting list fields.`
    );
  }
  const warnings = [];
  if (duplicateStats.safeDuplicateCount > 0) {
    warnings.push(
      `${duplicateStats.safeDuplicateCount} duplicate sourceProductId records were classified as safe pagination overlap.`
    );
  }

  const allowCandidateGeneration = fatalWarnings.length === 0;
  return {
    version: "smokingpipes-daily-diff-v1",
    generatedAt: new Date().toISOString(),
    source: "smokingpipes",
    productionWritten: false,
    coverage: {
      pagesScanned: Number(summary.pagesScanned || 0),
      pagesCompleted,
      pagesFailed,
      lastSuccessfulPage,
      expectedPages: resolvedExpectedPages,
      fullExpectedRangeScanned,
      captchaDetected,
    },
    counts: {
      production: productionById.size,
      current: currentById.size,
      dailyNew: dailyNewIds.length,
      stillAvailable: stillAvailableIds.length,
      newlySoldOut: newlySoldOutIds.length,
      disappeared: disappearedIds.length,
      missingPriceButNotSold: missingPriceButNotSoldIds.length,
      duplicateIds: duplicateStats.totalDuplicateIds,
      safeDuplicates: duplicateStats.safeDuplicateCount,
      suspiciousDuplicates: duplicateStats.suspiciousDuplicateCount,
    },
    dailyNewIds: sorted(dailyNewIds),
    newIds: sorted(dailyNewIds),
    stillAvailableIds: sorted(stillAvailableIds),
    newlySoldOutIds: sorted(newlySoldOutIds),
    disappearedIds: sorted(disappearedIds),
    missingPriceButNotSoldIds: sorted(missingPriceButNotSoldIds),
    fatalWarnings,
    warnings,
    duplicateStats,
    allowApply: allowCandidateGeneration,
    allowCandidateGeneration,
  };
}

export function evaluateSmokingpipesDailyGenerationGate({
  dailyDiff,
  queue,
}) {
  const summary = summarizeDetailsQueue(queue || { items: [] });
  const reasons = [];
  const dailyNewCount = Number(
    dailyDiff?.counts?.dailyNew ?? dailyDiff?.dailyNewIds?.length ?? 0
  );

  if (!dailyDiff?.coverage?.fullExpectedRangeScanned) {
    reasons.push("daily current-list scan is incomplete");
  }
  if (dailyDiff?.coverage?.captchaDetected) {
    reasons.push("daily current-list scan recorded CAPTCHA");
  }
  if ((dailyDiff?.fatalWarnings || []).length) {
    reasons.push(...dailyDiff.fatalWarnings);
  }
  if (summary.failed > 0) {
    reasons.push(`${summary.failed} daily new detail items failed`);
  }
  if (
    dailyNewCount > 0 &&
    (summary.remaining > 0 || summary.completed < dailyNewCount)
  ) {
    reasons.push(`${summary.remaining} daily new details remain incomplete`);
  }

  return {
    allowGenerate: reasons.length === 0,
    status:
      reasons.length === 0
        ? "daily-candidate-ready"
        : dailyDiff?.coverage?.captchaDetected
          ? "blocked"
          : dailyDiff?.coverage?.fullExpectedRangeScanned
          ? "details-pending"
          : "blocked",
    reasons,
    queue: summary,
    productionWritten: false,
  };
}

export function shouldPrepareDailyDetailsQueue(dailyDiff) {
  return (
    dailyDiff?.allowCandidateGeneration === true &&
    dailyDiff?.allowApply === true &&
    dailyDiff?.coverage?.fullExpectedRangeScanned === true &&
    dailyDiff?.coverage?.captchaDetected !== true &&
    (dailyDiff?.fatalWarnings || []).length === 0
  );
}

export function invalidateUntrustedDailyQueue({
  queue,
  currentPayload,
  now = new Date().toISOString(),
}) {
  const captchaDetected =
    currentPayload?.summary?.captchaDetected === true ||
    (currentPayload?.summary?.captchaPages || []).length > 0;
  const queueSourceAt = Date.parse(
    queue?.sourceCurrentListGeneratedAt ||
      queue?.diffGeneratedAt ||
      ""
  );
  const currentGeneratedAt = Date.parse(
    currentPayload?.generatedAt ||
      currentPayload?.completedAt ||
      ""
  );
  const sourceMatches =
    Number.isFinite(queueSourceAt) &&
    Number.isFinite(currentGeneratedAt) &&
    Math.abs(queueSourceAt - currentGeneratedAt) <=
      (queue?.sourceCurrentListGeneratedAt ? 1000 : 5 * 60 * 1000);
  if (!queue || !captchaDetected || !sourceMatches) {
    return {
      invalidated: false,
      invalidatedCount: 0,
      reason: "",
      queue,
    };
  }

  let invalidatedCount = 0;
  const reason =
    "previous queue invalidated because source current-list had captchaDetected=true";
  const items = (queue.items || []).map((item) => {
    if (
      item.active !== false &&
      ["pending", "in-progress", "blocked"].includes(item.status)
    ) {
      invalidatedCount += 1;
      return {
        ...item,
        active: false,
        status: "superseded",
        lastError: reason,
        updatedAt: now,
      };
    }
    return item;
  });
  const nextQueue = {
    ...queue,
    updatedAt: now,
    invalidatedAt: now,
    invalidatedReason: reason,
    sourceCurrentListTrusted: false,
    items,
  };
  nextQueue.summary = summarizeDetailsQueue(nextQueue);
  return {
    invalidated: invalidatedCount > 0,
    invalidatedCount,
    reason,
    queue: nextQueue,
  };
}

export function buildSmokingpipesDailyCandidate({
  productionProducts,
  currentPayload,
  dailyDiff,
  queue,
  convertedNewProducts,
  conversionFailures = [],
}) {
  const candidate = buildSmokingpipesApplyCandidate({
    existingProducts: productionProducts,
    currentPayload,
    diff: {
      ...dailyDiff,
      newIds: dailyDiff.dailyNewIds || dailyDiff.newIds || [],
      allowApply:
        dailyDiff.allowCandidateGeneration ?? dailyDiff.allowApply,
    },
    inventoryValidation: {
      status:
        dailyDiff.allowCandidateGeneration === false ? "blocked" : "passed",
      allowApply:
        dailyDiff.allowCandidateGeneration ?? dailyDiff.allowApply,
    },
    queue,
    convertedNewProducts,
    conversionFailures,
  });
  return {
    ...candidate,
    version: "smokingpipes-products-daily-next-dry-run-v1",
    dailyUpdate: true,
    productionWritten: false,
    allowFormalApply: false,
  };
}

export function buildSmokingpipesDailyAudit({
  productionProducts,
  currentPayload,
  dailyDiff,
  queue,
  candidate,
  publicPayloads,
  legacyCatalog = [],
}) {
  const catalog = publicPayloads?.catalog?.products || [];
  const recentNew = publicPayloads?.recentNew?.products || [];
  const catalogBySourceId = new Map(
    catalog
      .filter((item) => item.source === "smokingpipes")
      .map((item) => [sourceProductId(item), item])
  );
  const legacyIds = new Set((legacyCatalog || []).map((item) => item.id));
  const queueSummary = summarizeDetailsQueue(queue || { items: [] });
  const reviewOnlyCategories = new Set([
    "missingPrice",
    "inventoryConflict",
    "missingImage",
    "missingRequiredFields",
    "taxonomyNeedsReview",
    "publicationExcluded",
    "convertFailed",
  ]);
  const dailyProducts = candidate?.readiness?.products || [];
  const reviewOnlyInCatalog = dailyProducts.filter(
    (item) =>
      reviewOnlyCategories.has(
        text(
          item?.sourceSpecific?.smokingpipes?.baselineReadinessCategory
        )
      ) && catalogBySourceId.has(sourceProductId(item))
  );
  const inventoryConflictInCatalog = dailyProducts.filter(
    (item) =>
      text(
        item?.sourceSpecific?.smokingpipes?.baselineReadinessCategory
      ) === "inventoryConflict" &&
      catalogBySourceId.has(sourceProductId(item))
  );
  const dailyNewIds = new Set(
    (dailyDiff?.dailyNewIds || dailyDiff?.newIds || []).map(String)
  );
  const introducedCatalog = catalog.filter(
    (item) =>
      item.source === "smokingpipes" &&
      dailyNewIds.has(sourceProductId(item))
  );
  const missingImageIntroduced = introducedCatalog.filter(
    (item) => !text(item.mainImage)
  );
  const missingRequiredIntroduced = dailyProducts.filter(
    (item) =>
      text(
        item?.sourceSpecific?.smokingpipes?.baselineReadinessCategory
      ) === "missingRequiredFields" &&
      catalogBySourceId.has(sourceProductId(item))
  );
  const sellableBadPrice = catalog.filter(
    (item) =>
      item.publiclySellable === true &&
      (!(Number(item.sourcePriceAmount) > 0) ||
        !(Number(item.siteDisplayAmount) > 0) ||
        item.siteDisplayReady !== true)
  );
  const recentNewSold = recentNew.filter((item) =>
    ["sold", "unavailable"].includes(
      text(item.inventoryStatus).toLowerCase()
    )
  );
  const missingPriceWronglySold = (
    dailyDiff?.missingPriceButNotSoldIds || []
  ).filter((id) => {
    const product = candidate?.products?.find(
      (item) => sourceProductId(item) === String(id)
    );
    return ["sold", "unavailable"].includes(
      text(product?.inventoryStatus).toLowerCase()
    );
  });
  const expectedSoldIds = new Set([
    ...(dailyDiff?.newlySoldOutIds || []),
    ...(dailyDiff?.disappearedIds || []),
  ].map(String));
  const soldMissingFromCatalog = [...expectedSoldIds].filter((id) => {
    const product = catalogBySourceId.get(id);
    return !product || product.inventoryStatus !== "sold";
  });
  const legacyMissingImage = catalog.filter(
    (item) => legacyIds.has(item.id) && !text(item.mainImage)
  );

  const blockers = [];
  if (!dailyDiff?.coverage?.fullExpectedRangeScanned) {
    blockers.push("daily current-list scan is incomplete");
  }
  if (dailyDiff?.coverage?.captchaDetected) {
    blockers.push("daily current-list scan recorded CAPTCHA");
  }
  if (queueSummary.remaining > 0 || queueSummary.failed > 0) {
    blockers.push("daily new detail queue is incomplete");
  }
  if (reviewOnlyInCatalog.length) {
    blockers.push(`${reviewOnlyInCatalog.length} review-only products entered catalog`);
  }
  if (inventoryConflictInCatalog.length) {
    blockers.push(`${inventoryConflictInCatalog.length} inventory conflicts entered catalog`);
  }
  if (missingImageIntroduced.length) {
    blockers.push(`${missingImageIntroduced.length} new missing-image products entered catalog`);
  }
  if (missingRequiredIntroduced.length) {
    blockers.push(`${missingRequiredIntroduced.length} missing-required products entered catalog`);
  }
  if (sellableBadPrice.length) {
    blockers.push(`${sellableBadPrice.length} sellable products have invalid price`);
  }
  if (recentNewSold.length) {
    blockers.push(`${recentNewSold.length} sold products entered recent-new`);
  }
  if (missingPriceWronglySold.length) {
    blockers.push(`${missingPriceWronglySold.length} missing-price products were wrongly marked sold`);
  }
  if (soldMissingFromCatalog.length) {
    blockers.push(`${soldMissingFromCatalog.length} sold candidates are missing from catalog`);
  }
  const warnings = [];
  if (legacyMissingImage.length) {
    warnings.push(`${legacyMissingImage.length} legacy catalog products have no main image`);
  }
  const reviewOnlyNew =
    candidate?.readiness?.counts?.reviewOnly ||
    candidate?.readiness?.counts?.notPublicReady ||
    0;
  if (reviewOnlyNew) {
    warnings.push(`${reviewOnlyNew} daily new products remain review-only`);
  }

  const verdict = blockers.length
    ? "FAIL"
    : warnings.length
      ? "WARN"
      : "PASS";
  return {
    version: "smokingpipes-daily-update-audit-v1",
    generatedAt: new Date().toISOString(),
    verdict,
    blockers,
    warnings,
    productionWritten: false,
    allowFormalApply: blockers.length === 0,
    counts: {
      productionProducts: (productionProducts || []).length,
      currentList: (currentPayload?.products || []).length,
      pagesCompleted:
        Number(
          currentPayload?.summary?.pagesCompleted ??
            currentPayload?.summary?.pagesScanned ??
            0
        ),
      pagesFailed: Array.isArray(currentPayload?.summary?.failedPages)
        ? currentPayload.summary.failedPages.length
        : Number(currentPayload?.summary?.pagesFailed || 0),
      lastSuccessfulPage: Number(
        currentPayload?.summary?.lastSuccessfulPage || 0
      ),
      dailyNewIds: dailyNewIds.size,
      detailsCompleted: queueSummary.completed,
      detailsPending: queueSummary.pending + queueSummary.inProgress,
      detailsFailed: queueSummary.failed,
      dailyPublicReadyNew:
        candidate?.readiness?.counts?.publicReady || 0,
      dailyReviewOnlyNew: reviewOnlyNew,
      newlySoldOut: dailyDiff?.newlySoldOutIds?.length || 0,
      disappeared: dailyDiff?.disappearedIds?.length || 0,
      missingPriceButNotSold:
        dailyDiff?.missingPriceButNotSoldIds?.length || 0,
      inventoryConflict:
        candidate?.readiness?.counts?.inventoryConflict || 0,
      finalProductsDailyNext: candidate?.products?.length || 0,
      finalPublicCatalogDailyNext: catalog.length,
      finalRecentNew: recentNew.length,
      reviewOnlyInCatalog: reviewOnlyInCatalog.length,
      inventoryConflictInCatalog: inventoryConflictInCatalog.length,
      missingImageIntroduced: missingImageIntroduced.length,
      missingRequiredFieldsIntroduced: missingRequiredIntroduced.length,
      sellablePriceZeroOrInvalid: sellableBadPrice.length,
      recentNewSold: recentNewSold.length,
      missingPriceWronglySold: missingPriceWronglySold.length,
      soldCandidatesMissingFromCatalog: soldMissingFromCatalog.length,
      legacyMissingImage: legacyMissingImage.length,
    },
  };
}

function arrayPayload(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function priceText(product) {
  return (
    text(product?.price?.current?.rawText) ||
    text(product?.price?.rawText) ||
    (Number(product?.price?.current?.amount) > 0
      ? `$${Number(product.price.current.amount).toFixed(2)}`
      : "")
  );
}

function makeMockCurrentPayload(productionProducts, options) {
  const now = new Date().toISOString();
  const simulatedAverageMs =
    options.pageDelayMinMs >= 3000 ? 9045 : 4627;
  const completedAt = new Date(
    Date.parse(now) + options.maxPages * simulatedAverageMs
  ).toISOString();
  const existing = productionProducts.slice(0, 4);
  if (existing.length < 4) {
    throw new Error("Daily update mock requires at least four production products.");
  }
  const currentExisting = existing.slice(0, 3).map((product, index) => ({
    source: "smokingpipes",
    sourceProductId: sourceProductId(product),
    sourceUrl: product.sourceUrl,
    title:
      text(product.displayNameEn) ||
      text(product.fullTitle) ||
      text(product.rawTitle),
    rawTitle: text(product.rawTitle),
    brand: text(product.canonicalBrand),
    price: index === 2 ? "" : priceText(product) || "$125.00",
    mainImage: text(product.imageUrl),
    rawListStatus: index === 1 ? "OUT OF STOCK" : "In Stock",
    rawText: index === 1 ? "OUT OF STOCK" : "",
    listPage: 1,
    listPosition: index + 1,
    scrapedAt: now,
  }));
  const newProducts = ["990001", "990002"].map((id, index) => ({
    source: "smokingpipes",
    sourceProductId: id,
    sourceUrl: `https://example.invalid/smokingpipes/${id}`,
    title: `Savinelli Mock Billiard ${id}`,
    rawTitle: `Savinelli Mock Billiard ${id}`,
    brand: "Savinelli",
    price: `$${125 + index * 10}.00`,
    mainImage: `https://example.invalid/images/${id}.jpg`,
    rawListStatus: "In Stock",
    rawText: "",
    listPage: 1,
    listPosition: currentExisting.length + index + 1,
    scrapedAt: now,
  }));
  const products = [...currentExisting, ...newProducts];
  return {
    version: "smokingpipes-current-list-daily-mock-v1",
    generatedAt: completedAt,
    source: "smokingpipes",
    runId: `mock-${formatRunId()}`,
    config: {
      maxPages: options.maxPages,
      expectedPages: options.expectedPages,
      pageWarmupMinMs: options.pageWarmupMinMs,
      pageWarmupMaxMs: options.pageWarmupMaxMs,
      pageDelayMinMs: options.pageDelayMinMs,
      pageDelayMaxMs: options.pageDelayMaxMs,
      pageBatchSize: options.pageBatchSize,
      pageBatchCooldownMinMs: options.pageBatchCooldownMinMs,
      pageBatchCooldownMaxMs: options.pageBatchCooldownMaxMs,
      mock: true,
    },
    startedAt: now,
    completedAt,
    products,
    pages: [
      {
        page: 1,
        productCount: products.length,
        scrapedAt: now,
      },
    ],
    summary: {
      pagesRequested: options.maxPages,
      pagesScanned: options.maxPages,
      expectedPages: options.expectedPages,
      productsExtracted: products.length,
      uniqueProducts: products.length,
      duplicateSourceProductIds: [],
      fullExpectedRangeScanned:
        options.maxPages === options.expectedPages,
      captchaDetected: options.mockVerification === "strong",
      captchaPages:
        options.mockVerification === "strong" ? [73] : [],
    },
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function durationSeconds(startedAt, endedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(endedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return Math.round(((end - start) / 1000) * 1000) / 1000;
}

function averageSeconds(totalSeconds, count) {
  if (!(Number(count) > 0)) return 0;
  return Math.round((totalSeconds / Number(count)) * 1000) / 1000;
}

export function buildDailyTimingSummary({
  startedAt,
  listStartedAt,
  listEndedAt,
  pagesScanned = 0,
  detailStartedAt,
  detailEndedAt,
  detailsAttempted = 0,
  finishedAt,
}) {
  const listDurationSeconds = durationSeconds(
    listStartedAt,
    listEndedAt
  );
  const detailDurationSeconds = durationSeconds(
    detailStartedAt,
    detailEndedAt
  );
  return {
    list: {
      startedAt: listStartedAt || null,
      endedAt: listEndedAt || null,
      durationSeconds: listDurationSeconds,
      pagesScanned: Number(pagesScanned) || 0,
      avgSecondsPerPage: averageSeconds(
        listDurationSeconds,
        pagesScanned
      ),
    },
    details: {
      startedAt: detailStartedAt || null,
      endedAt: detailEndedAt || null,
      durationSeconds: detailDurationSeconds,
      detailsAttempted: Number(detailsAttempted) || 0,
      avgSecondsPerDetail: averageSeconds(
        detailDurationSeconds,
        detailsAttempted
      ),
    },
    totalDurationSeconds: durationSeconds(startedAt, finishedAt),
  };
}

function dailyMarkdown(report) {
  const counts = report.audit?.counts || report.dailyDiff?.counts || {};
  const blockers = report.audit?.blockers || report.blockers || [];
  const warnings = [
    ...new Set([
      ...(report.warnings || []),
      ...(report.audit?.warnings || []),
    ]),
  ];
  return `# Smokingpipes Daily Update V1

- runId: ${report.runId}
- startedAt: ${report.startedAt}
- finishedAt: ${report.finishedAt}
- status: ${report.status}
- riskLevel: ${report.riskLevel || "not evaluated"}
- mock: ${report.mock}
- refresh list: ${report.refreshList}
- requested browser channel: ${report.browser?.requestedBrowserChannel || "automatic"}
- effective browser channel: ${report.browser?.effectiveBrowserChannel || "automatic"}
- requested browser profile: ${report.browser?.requestedBrowserProfile || "none"}
- requested browser profile dir: ${report.browser?.requestedBrowserProfileDir || "none"}
- effective profile dir: ${report.browser?.profileDir || "none"}
- profile source: ${report.browser?.profileSource || "none"}
- persistent context: ${Boolean(report.browser?.persistentContext)}
- executable path: ${report.browser?.executablePath || "unavailable"}
- user data dir created: ${Boolean(report.browser?.userDataDirCreated)}
- manual verification allowed: ${Boolean(report.manualVerificationAllowed)}
- manual verification recovered: ${Boolean(report.manualVerificationRecovered)}
- list scan startedAt: ${report.timing?.list?.startedAt || "not started"}
- list scan endedAt: ${report.timing?.list?.endedAt || "not finished"}
- list scan durationSeconds: ${report.timing?.list?.durationSeconds ?? 0}
- pages scanned: ${report.timing?.list?.pagesScanned ?? 0}
- pages completed: ${counts.pagesCompleted ?? report.dailyDiff?.coverage?.pagesCompleted ?? 0}
- pages failed: ${counts.pagesFailed ?? report.dailyDiff?.coverage?.pagesFailed ?? 0}
- last successful page: ${counts.lastSuccessfulPage ?? report.dailyDiff?.coverage?.lastSuccessfulPage ?? 0}
- avg seconds per page: ${report.timing?.list?.avgSecondsPerPage ?? 0}
- detail fetch durationSeconds: ${report.timing?.details?.durationSeconds ?? 0}
- details attempted: ${report.timing?.details?.detailsAttempted ?? 0}
- avg seconds per detail: ${report.timing?.details?.avgSecondsPerDetail ?? 0}
- total durationSeconds: ${report.timing?.totalDurationSeconds ?? 0}
- full expected range scanned: ${Boolean(report.dailyDiff?.coverage?.fullExpectedRangeScanned)}
- CAPTCHA detected: ${Boolean(report.dailyDiff?.coverage?.captchaDetected || report.captchaRequired)}
- production products: ${counts.productionProducts ?? report.dailyDiff?.counts?.production ?? 0}
- current-list products: ${counts.currentList ?? report.dailyDiff?.counts?.current ?? 0}
- daily new: ${counts.dailyNewIds ?? report.dailyDiff?.counts?.dailyNew ?? 0}
- details completed: ${counts.detailsCompleted ?? report.queue?.completed ?? 0}
- details pending: ${counts.detailsPending ?? report.queue?.remaining ?? 0}
- details failed: ${counts.detailsFailed ?? report.queue?.failed ?? 0}
- newly sold out: ${counts.newlySoldOut ?? report.dailyDiff?.counts?.newlySoldOut ?? 0}
- disappeared: ${counts.disappeared ?? report.dailyDiff?.counts?.disappeared ?? 0}
- missing price but not sold: ${counts.missingPriceButNotSold ?? report.dailyDiff?.counts?.missingPriceButNotSold ?? 0}
- inventory conflict: ${counts.inventoryConflict ?? 0}
- final products daily next: ${counts.finalProductsDailyNext ?? 0}
- final public catalog daily next: ${counts.finalPublicCatalogDailyNext ?? 0}
- final recent-new: ${counts.finalRecentNew ?? 0}
- daily audit verdict: ${report.audit?.verdict || "not generated"}
- candidate outputs generated: ${Boolean(report.outputsGenerated)}
- formal apply performed: false
- production data written: false
- commit performed: false
- push performed: false

## Blockers

${blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- none"}

## Warnings

${warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- none"}

## Next step

${report.nextStep}
`;
}

function auditMarkdown(audit) {
  return `# Smokingpipes Daily Update Audit V1

- verdict: ${audit.verdict}
- generatedAt: ${audit.generatedAt}
- production data written: false
- allow formal apply review: ${audit.allowFormalApply}

## Counts

${Object.entries(audit.counts || {})
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

## Blockers

${audit.blockers.length ? audit.blockers.map((item) => `- ${item}`).join("\n") : "- none"}

## Warnings

${audit.warnings.length ? audit.warnings.map((item) => `- ${item}`).join("\n") : "- none"}
`;
}

function pendingDailyAudit(report) {
  const diffCounts = report.dailyDiff?.counts || {};
  const queue = report.queue || {};
  const blockers = [
    ...(report.blockers || []),
    ...(report.errors || []),
  ];
  return {
    version: "smokingpipes-daily-update-audit-v1",
    generatedAt: new Date().toISOString(),
    verdict: "FAIL",
    blockers:
      blockers.length > 0
        ? [...new Set(blockers)]
        : ["daily candidate generation did not complete"],
    warnings: [...(report.warnings || [])],
    productionWritten: false,
    allowFormalApply: false,
    counts: {
      productionProducts: diffCounts.production || 0,
      currentList: diffCounts.current || 0,
      pagesCompleted: Number(
        report.dailyDiff?.coverage?.pagesCompleted ??
          report.dailyDiff?.coverage?.pagesScanned ??
          0
      ),
      pagesFailed: Number(report.dailyDiff?.coverage?.pagesFailed || 0),
      lastSuccessfulPage: Number(
        report.dailyDiff?.coverage?.lastSuccessfulPage || 0
      ),
      dailyNewIds: diffCounts.dailyNew || 0,
      detailsCompleted: queue.completed || 0,
      detailsPending: queue.remaining || 0,
      detailsFailed: queue.failed || 0,
      dailyPublicReadyNew: 0,
      dailyReviewOnlyNew: 0,
      newlySoldOut: diffCounts.newlySoldOut || 0,
      disappeared: diffCounts.disappeared || 0,
      missingPriceButNotSold: diffCounts.missingPriceButNotSold || 0,
      inventoryConflict: 0,
      finalProductsDailyNext: 0,
      finalPublicCatalogDailyNext: 0,
      finalRecentNew: 0,
      reviewOnlyInCatalog: 0,
      inventoryConflictInCatalog: 0,
      missingImageIntroduced: 0,
      missingRequiredFieldsIntroduced: 0,
      sellablePriceZeroOrInvalid: 0,
      recentNewSold: 0,
      missingPriceWronglySold: 0,
      soldCandidatesMissingFromCatalog: 0,
      legacyMissingImage: 0,
    },
  };
}

async function writeDailyCandidateOutputs({
  paths,
  candidate,
  publicPayloads,
}) {
  const productionProducts = path.resolve(
    paths.root,
    "data/products/smokingpipes-products.json"
  );
  const productionPublicRoot = path.resolve(
    paths.root,
    "data/generated/public-products"
  );
  const targets = [
    paths.dailyProductsNext,
    paths.dailyPublicNextRoot,
  ].map((item) => path.resolve(item));
  if (
    targets[0] === productionProducts ||
    targets[1] === productionPublicRoot ||
    targets[1].startsWith(`${productionPublicRoot}${path.sep}`)
  ) {
    throw new Error("Refusing to write daily candidate outputs to production paths.");
  }

  const serialized = {
    catalog: stableJson(publicPayloads.catalog),
    filters: stableJson(publicPayloads.filters),
    brands: stableJson(publicPayloads.brands),
    recentNew: stableJson(publicPayloads.recentNew),
    lookup: stableJson(publicPayloads.lookup),
  };
  const manifest = {
    ...publicPayloads.manifest,
    productionWritten: false,
    fileHashes: Object.fromEntries(
      Object.entries(serialized).map(([key, value]) => [key, sha256(value)])
    ),
  };

  await writeJsonAtomic(paths.dailyProductsNext, candidate.products);
  await writeTextAtomic(
    path.join(paths.dailyPublicNextRoot, "catalog.json"),
    serialized.catalog
  );
  await writeTextAtomic(
    path.join(paths.dailyPublicNextRoot, "filters.json"),
    serialized.filters
  );
  await writeTextAtomic(
    path.join(paths.dailyPublicNextRoot, "brands.json"),
    serialized.brands
  );
  await writeTextAtomic(
    path.join(paths.dailyPublicNextRoot, "recent-new.json"),
    serialized.recentNew
  );
  await writeTextAtomic(
    path.join(paths.dailyPublicNextRoot, "detail-lookup.json"),
    serialized.lookup
  );
  await writeJsonAtomic(
    path.join(paths.dailyPublicNextRoot, "manifest.json"),
    manifest
  );
  for (const shard of publicPayloads.detailShards || []) {
    await writeJsonAtomic(
      path.join(paths.dailyPublicNextRoot, "details", `${shard.shard}.json`),
      shard.content
    );
  }
}

export async function runSmokingpipesDailyUpdate({
  root = process.cwd(),
  options,
}) {
  const paths = getRunnerPaths(root, { mock: options.mock });
  const runId = formatRunId();
  const startedAt = new Date().toISOString();
  const report = {
    version: "smokingpipes-daily-update-report-v1",
    runId,
    source: "smokingpipes",
    mode: "daily-update",
    startedAt,
    finishedAt: null,
    status: "running",
    mock: options.mock,
    refreshList: true,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
    captchaRequired: false,
    outputsGenerated: false,
    dailyDiff: null,
    queue: null,
    audit: null,
    blockers: [],
    warnings: [],
    errors: [],
    listScanStartedAt: null,
    listScanEndedAt: null,
    detailFetchStartedAt: null,
    detailFetchEndedAt: null,
    detailsAttempted: 0,
    timing: null,
    riskLevel: null,
    riskWarnings: [],
    browser: buildSmokingpipesBrowserDescriptor({
      root,
      browserChannel: options.browserChannel,
      browserProfile: options.browserProfile,
      browserProfileDir: options.browserProfileDir,
    }),
    manualVerificationAllowed:
      Boolean(options.allowManualVerification),
    manualVerificationRecovered: false,
    listPacing: {
      pageWarmupMinMs: options.pageWarmupMinMs,
      pageWarmupMaxMs: options.pageWarmupMaxMs,
      pageDelayMinMs: options.pageDelayMinMs,
      pageDelayMaxMs: options.pageDelayMaxMs,
      pageBatchSize: options.pageBatchSize,
      pageBatchCooldownMinMs: options.pageBatchCooldownMinMs,
      pageBatchCooldownMaxMs: options.pageBatchCooldownMaxMs,
    },
    detailPacing: {
      detailWarmupMinMs: options.detailWarmupMinMs,
      detailWarmupMaxMs: options.detailWarmupMaxMs,
      detailDelayMinMs: options.detailDelayMinMs,
      detailDelayMaxMs: options.detailDelayMaxMs,
      detailBatchSize: options.detailBatchSize,
      detailBatchCooldownMinMs: options.detailBatchCooldownMinMs,
      detailBatchCooldownMaxMs: options.detailBatchCooldownMaxMs,
    },
    nextStep: "Review the daily report before any formal apply.",
  };
  let lock = null;
  const verificationPages = [];

  const writeVerificationTelemetry = async ({
    endedAt = new Date().toISOString(),
    blockedReason = "",
  } = {}) => {
    const telemetryPages =
      verificationPages.length > 0
        ? verificationPages
        : report.dailyDiff
          ? Array.from(
              {
                length:
                  report.dailyDiff.coverage?.pagesScanned || 0,
              },
              (_, index) => {
                const page = index + 1;
                const strong =
                  report.dailyDiff.coverage?.captchaDetected &&
                  (
                    report.dailyDiff.coverage?.captchaPages || [73]
                  ).includes(page);
                return {
                  page,
                  url: `mock://smokingpipes-daily-update?page=${page}`,
                  startedAt: report.listScanStartedAt,
                  endedAt: report.listScanEndedAt,
                  durationMs: 0,
                  warmupMs: options.pageWarmupMinMs,
                  delayMs:
                    page <
                    report.dailyDiff.coverage.pagesScanned
                      ? options.pageDelayMinMs
                      : 0,
                  productsParsed: strong ? 0 : 48,
                  outOfStockProducts: 0,
                  missingPriceProducts: 0,
                  weakVerificationSignals: [],
                  strongVerificationSignals: strong
                    ? ["mock-strong-verification"]
                    : [],
                  finalClassification: strong
                    ? "strong-verification"
                    : "normal-content",
                  screenshotPath: null,
                  htmlSamplePath: null,
                };
              }
            )
          : [];
    const telemetry = buildVerificationProbeTelemetry({
      runId,
      mode: "daily-update",
      startedAt: report.listScanStartedAt || report.startedAt,
      endedAt,
      pagesRequested: options.maxPages,
      pacing: report.listPacing,
      pages: telemetryPages,
      blockedReason,
      candidateGenerated: report.outputsGenerated,
      detailsFetched: report.detailsAttempted > 0,
      browser: report.browser,
      manualVerificationAllowed:
        report.manualVerificationAllowed,
      manualVerificationRecovered:
        report.manualVerificationRecovered,
    });
    await writeJsonAtomic(paths.verificationTelemetry, telemetry);
    await writeTextAtomic(
      paths.verificationTelemetryReport,
      buildVerificationTelemetryMarkdown(telemetry)
    );
    report.riskLevel = telemetry.riskLevel;
    report.riskWarnings = telemetry.warnings || [];
    for (const warning of report.riskWarnings) {
      if (!report.warnings.includes(warning)) {
        report.warnings.push(warning);
      }
    }
    report.recommendedNextAction =
      telemetry.recommendedNextAction;
    return telemetry;
  };

  const writeReportsAndState = async () => {
    report.finishedAt ||= new Date().toISOString();
    report.timing = buildDailyTimingSummary({
      startedAt: report.startedAt,
      listStartedAt: report.listScanStartedAt,
      listEndedAt: report.listScanEndedAt,
      pagesScanned: report.dailyDiff?.coverage?.pagesScanned || 0,
      detailStartedAt: report.detailFetchStartedAt,
      detailEndedAt: report.detailFetchEndedAt,
      detailsAttempted: report.detailsAttempted,
      finishedAt: report.finishedAt,
    });
    report.audit ||= pendingDailyAudit(report);
    await writeVerificationTelemetry({
      endedAt: report.listScanEndedAt || report.finishedAt,
      blockedReason:
        report.dailyDiff?.coverage?.captchaDetected
          ? "captcha/currentListVerificationDetected"
          : report.status === "blocked"
            ? report.blockers.join("; ")
            : "",
    });
    await writeJsonAtomic(paths.dailyReportJson, report);
    await writeTextAtomic(paths.dailyReportMarkdown, dailyMarkdown(report));
    await writeJsonAtomic(paths.dailyAuditJson, report.audit);
    await writeTextAtomic(
      paths.dailyAuditMarkdown,
      auditMarkdown(report.audit)
    );
    await writeJsonAtomic(paths.dailyState, {
      source: "smokingpipes",
      lastRunAt: report.finishedAt,
      lastSuccessfulFetchAt:
        report.dailyDiff?.coverage?.fullExpectedRangeScanned &&
        !report.dailyDiff?.coverage?.captchaDetected
          ? report.finishedAt
          : null,
      lastSuccessfulApplyAt: null,
      status: report.status,
      lastStep: report.outputsGenerated
        ? "daily-candidate-generated"
        : report.status,
      lastError: report.errors.at(-1) || null,
      manualActionRequired: report.captchaRequired,
      captchaRequired: report.captchaRequired,
      currentRunId: null,
      latestReport: path
        .relative(root, paths.dailyReportMarkdown)
        .replaceAll("\\", "/"),
      productionWritten: false,
    });
  };

  try {
    lock = acquireRunLock(
      paths.dailyLock,
      { runId, source: "smokingpipes", mode: "daily-update" },
      options.forceUnlock
    );
    if (options.commit) {
      report.warnings.push(
        "--commit is ignored in daily-update V1; no commit or push is performed."
      );
    }
    if (options.deploy) {
      report.warnings.push(
        "Deployment is ignored in daily-update V1."
      );
    }
    if (options.pacingDowngraded) {
      report.warnings.push(
        "Fast list pacing was overridden with the conservative full-reconcile profile because max-pages exceeds 10."
      );
    }

    const productionPayload = readJsonIfExists(paths.existingProducts, []);
    const allProductionProducts = arrayPayload(productionPayload);
    const productionProducts = options.mock
      ? allProductionProducts.slice(0, 4)
      : allProductionProducts;
    const legacyCatalog = options.mock
      ? []
      : arrayPayload(
          readJsonIfExists(
            path.join(root, "data/generated/public-products/catalog.json"),
            []
          )
        );
    const danishProducts = options.mock
      ? []
      : arrayPayload(readJsonIfExists(paths.danishProducts, []));

    let currentPayload;
    report.listScanStartedAt = new Date().toISOString();
    if (options.mock) {
      if (options.verbose) {
        console.log(
          "daily-update mock: full refresh is simulated; no browser or network is used"
        );
      }
      currentPayload = makeMockCurrentPayload(productionProducts, options);
      await writeJsonAtomic(paths.currentList, currentPayload);
    } else {
      await runSmokingpipesInventoryDryRun({
        root,
        runId,
        mode: "daily-update",
        maxPages: options.maxPages,
        expectedPages: options.expectedPages,
        browserChannel: options.browserChannel,
        browserProfile: options.browserProfile,
        browserProfileDir: options.browserProfileDir,
        browserProfileLockPath: paths.browserProfileLock,
        allowManualVerification: options.allowManualVerification,
        manualVerificationTimeoutMs: options.manualVerificationTimeoutMs,
        pageDelayMinMs: options.pageDelayMinMs,
        pageDelayMaxMs: options.pageDelayMaxMs,
        pageWarmupMinMs: options.pageWarmupMinMs,
        pageWarmupMaxMs: options.pageWarmupMaxMs,
        pageBatchSize: options.pageBatchSize,
        pageBatchCooldownMinMs: options.pageBatchCooldownMinMs,
        pageBatchCooldownMaxMs: options.pageBatchCooldownMaxMs,
        captchaCooldownMs: options.captchaCooldownMs,
        verbose: options.verbose,
        onPageTelemetry: async (pageTelemetry) => {
          verificationPages.push(pageTelemetry);
        },
      });
      currentPayload = readJsonIfExists(paths.currentList);
    }
    if (!currentPayload) {
      throw new Error("Daily current-list output is missing.");
    }
    report.listScanStartedAt =
      currentPayload.startedAt || report.listScanStartedAt;
    report.listScanEndedAt =
      currentPayload.completedAt || new Date().toISOString();
    report.browser =
      currentPayload.config?.browser || report.browser;
    report.manualVerificationRecovered =
      currentPayload.summary
        ?.manualVerificationRecovered === true;

    const existingQueue = readJsonIfExists(paths.dailyQueue, null);
    const ignoredIds = (existingQueue?.items || [])
      .filter((item) =>
        ["ignored", "superseded"].includes(item.status)
      )
      .map((item) => item.sourceProductId);
    const dailyDiff = buildSmokingpipesDailyDiff({
      productionProducts,
      currentPayload,
      expectedPages: options.expectedPages,
      ignoredIds,
    });
    report.dailyDiff = dailyDiff;
    if (currentPayload.summary?.weakVerificationDetected) {
      report.warnings.push(
        `Weak verification signals were observed on pages ${(currentPayload.summary.weakVerificationPages || []).join(", ")}; product cards parsed normally, so these are warnings only.`
      );
    }
    await writeVerificationTelemetry({
      endedAt: report.listScanEndedAt,
      blockedReason: dailyDiff.coverage.captchaDetected
        ? "captcha/currentListVerificationDetected"
        : "",
    });

    if (!shouldPrepareDailyDetailsQueue(dailyDiff)) {
      const invalidation = invalidateUntrustedDailyQueue({
        queue: existingQueue,
        currentPayload,
      });
      if (invalidation.invalidated) {
        await writeSmokingpipesQueueCheckpoint(
          invalidation.queue,
          paths.dailyQueue,
          { verbose: options.verbose }
        );
        report.warnings.push(
          `${invalidation.reason}; ${invalidation.invalidatedCount} pending items were superseded.`
        );
        report.queue = summarizeDetailsQueue(invalidation.queue);
      } else {
        if (existingQueue) {
          report.warnings.push(
            "An existing daily detail queue was ignored because the current-list verification gate failed."
          );
        }
        report.queue = summarizeDetailsQueue({ items: [] });
      }
      const gate = evaluateSmokingpipesDailyGenerationGate({
        dailyDiff,
        queue: { items: [] },
      });
      report.blockers.push(...gate.reasons);
      report.status = "blocked";
      report.captchaRequired =
        dailyDiff.coverage.captchaDetected === true;
      report.nextStep =
        "Current-list verification made this run untrusted. No detail queue was created or reused, and no candidate output was generated.";
      await writeReportsAndState();
      return report;
    }

    const cachedDetails = options.mock
      ? new Map()
      : collectValidCachedDetails(
          paths.detailCaches
            .map((filePath) => readJsonIfExists(filePath, null))
            .filter(Boolean)
        );
    const tempRecovery = collectValidQueueTempDetails(paths.dailyQueue);
    for (const [id, detail] of tempRecovery.details) {
      cachedDetails.set(id, detail);
    }
    const reusableQueue =
      existingQueue?.sourceCurrentListTrusted === false
        ? null
        : existingQueue;
    let queue = buildDetailsQueue({
      existingQueue: reusableQueue,
      diff: {
        ...dailyDiff,
        newIds: dailyDiff.dailyNewIds,
      },
      currentProducts: currentPayload.products || [],
      existingProductIds: new Set(
        productionProducts.map(sourceProductId)
      ),
      cachedDetails,
    });
    queue.sourceRunId = currentPayload.runId || null;
    queue.sourceCurrentListGeneratedAt =
      currentPayload.generatedAt || currentPayload.completedAt || null;
    queue.sourceCurrentListTrusted = true;
    queue.sourceCurrentListCaptchaDetected = false;
    await writeSmokingpipesQueueCheckpoint(queue, paths.dailyQueue, {
      verbose: options.verbose,
    });

    if (options.fetchNewDetails) {
      report.detailFetchStartedAt = new Date().toISOString();
      const processed = await processSmokingpipesDetailsQueue({
        queue,
        queuePath: paths.dailyQueue,
        maxItems: options.dailyNewMaxDetails,
        batchSize: options.detailBatchSize,
        detailWarmupMinMs: options.detailWarmupMinMs,
        detailWarmupMaxMs: options.detailWarmupMaxMs,
        detailDelayMinMs: options.detailDelayMinMs,
        detailDelayMaxMs: options.detailDelayMaxMs,
        detailBatchCooldownMinMs: options.detailBatchCooldownMinMs,
        detailBatchCooldownMaxMs: options.detailBatchCooldownMaxMs,
        browserChannel: options.browserChannel,
        browserProfile: options.browserProfile,
        browserProfileDir: options.browserProfileDir,
        browserProfileLockPath: paths.browserProfileLock,
        runId,
        mode: "daily-update-details",
        allowManualVerification: options.allowManualVerification,
        manualVerificationTimeoutMs:
          options.manualVerificationTimeoutMs,
        verbose: options.verbose,
        mock: options.mock,
      });
      report.detailFetchEndedAt = new Date().toISOString();
      report.detailsAttempted = processed.result?.attempted || 0;
      report.browser =
        processed.result?.browser || report.browser;
      report.manualVerificationRecovered ||=
        processed.result?.manualVerificationRecovered === true;
      queue = processed.queue;
    }
    report.queue = summarizeDetailsQueue(queue);
    const gate = evaluateSmokingpipesDailyGenerationGate({
      dailyDiff,
      queue,
    });
    report.blockers.push(...gate.reasons);

    if (!gate.allowGenerate) {
      report.status = gate.status;
      report.nextStep =
        gate.status === "details-pending"
          ? "Run daily-update again with --fetch-new-details to finish only the remaining daily new detail queue."
          : "Resolve the incomplete scan or CAPTCHA, then rerun daily-update. No candidate or production data was written.";
      await writeReportsAndState();
      return report;
    }

    const dailyNewIds = new Set(dailyDiff.dailyNewIds.map(String));
    const completedDetails = (queue.items || [])
      .filter(
        (item) =>
          item.active !== false &&
          item.status === "completed" &&
          item.detail &&
          dailyNewIds.has(String(item.sourceProductId))
      )
      .map((item) => item.detail);
    const currentNewProducts = (currentPayload.products || []).filter(
      (item) => dailyNewIds.has(sourceProductId(item))
    );
    const conversion = convertSmokingpipesCandidateDetails(
      completedDetails,
      currentNewProducts
    );
    const candidate = buildSmokingpipesDailyCandidate({
      productionProducts,
      currentPayload,
      dailyDiff,
      queue,
      convertedNewProducts: conversion.products,
      conversionFailures: conversion.failures,
    });
    const unifiedRows = buildUnifiedProductsFromInputs({
      danishProducts,
      smokingpipesProducts: candidate.products,
    });
    const pricingContext = await loadPublicProductsPricingContext();
    const publicBase = buildPublicProductsFullCandidate(
      unifiedRows,
      pricingContext
    );
    const recentIds = new Set(
      candidate.recentNewProducts.map((item) => item.id)
    );
    const recentNew = {
      schemaVersion: 1,
      generatedAt: candidate.generatedAt,
      source: "smokingpipes",
      products: publicBase.catalog.products.filter((item) =>
        recentIds.has(item.id)
      ),
    };
    const validation = validatePublicProductsNextCandidate({
      ...publicBase,
      recentNew,
      smokingpipesProducts: candidate.products,
      publicReadyProducts: candidate.recentNewProducts,
    });
    const manifest = {
      schemaVersion: 1,
      generatorVersion: "smokingpipes-daily-update-v1",
      generatedAt: candidate.generatedAt,
      productionWritten: false,
      publicProductCount: publicBase.catalog.products.length,
      excludedProductCount: publicBase.excludedCount,
      brandCount: publicBase.brands.brands.length,
      detailCount: publicBase.details.length,
      detailShardCount: publicBase.detailShards.length,
      recentNewCount: recentNew.products.length,
      validationStatus: validation.status,
    };
    const publicPayloads = {
      ...publicBase,
      recentNew,
      manifest,
      validation,
    };
    const audit = buildSmokingpipesDailyAudit({
      productionProducts,
      currentPayload,
      dailyDiff,
      queue,
      candidate,
      publicPayloads,
      legacyCatalog,
    });
    if (validation.status !== "passed") {
      audit.blockers.push(...validation.errors);
      audit.verdict = "FAIL";
      audit.allowFormalApply = false;
    }
    report.audit = audit;

    if (audit.blockers.length) {
      report.status = "blocked";
      report.blockers.push(...audit.blockers);
      report.nextStep =
        "Fix the daily audit blockers and rerun. No final daily candidate or production data was written.";
      await writeReportsAndState();
      return report;
    }

    await writeDailyCandidateOutputs({
      paths,
      candidate,
      publicPayloads,
    });
    report.outputsGenerated = true;
    report.status = audit.verdict === "PASS" ? "daily-ready" : "daily-ready-with-warnings";
    report.nextStep =
      "Review the isolated daily candidate and audit. Formal apply remains a separate, explicit operation.";
    await writeReportsAndState();
    return report;
  } catch (error) {
    const classified = classifyRunnerError(error);
    const failedAt = new Date().toISOString();
    report.listScanEndedAt ||= report.listScanStartedAt ? failedAt : null;
    report.detailFetchEndedAt ||=
      report.detailFetchStartedAt ? failedAt : null;
    report.status = classified.status;
    if (classified.captchaRequired && !report.dailyDiff) {
      report.dailyDiff = {
        version: "smokingpipes-daily-diff-v1",
        generatedAt: failedAt,
        source: "smokingpipes",
        productionWritten: false,
        coverage: {
          pagesScanned: verificationPages.length,
          expectedPages: options.expectedPages,
          fullExpectedRangeScanned: false,
          captchaDetected: true,
          captchaPages: verificationPages
            .filter(
              (page) =>
                (page.strongVerificationSignals || []).length > 0
            )
            .map((page) => page.page),
        },
        counts: {
          production: 0,
          current: 0,
          dailyNew: 0,
          stillAvailable: 0,
          newlySoldOut: 0,
          disappeared: 0,
          missingPriceButNotSold: 0,
        },
        dailyNewIds: [],
        newIds: [],
        stillAvailableIds: [],
        newlySoldOutIds: [],
        disappearedIds: [],
        missingPriceButNotSoldIds: [],
        fatalWarnings: [
          "captcha/currentListVerificationDetected: strong verification stopped the current-list scan.",
        ],
        warnings: [],
        allowApply: false,
        allowCandidateGeneration: false,
      };
    }
    report.captchaRequired = classified.captchaRequired;
    report.errors.push(classified.message);
    report.nextStep = classified.captchaRequired
      ? "Strong verification stopped access. Review telemetry and retry later with a conservative probe; do not continue this run. No production data was written."
      : "Inspect the daily report, fix the error, and rerun. No production data was written.";
    await writeVerificationTelemetry({
      blockedReason: classified.captchaRequired
        ? "captcha/currentListVerificationDetected"
        : classified.message,
    }).catch(() => {});
    await writeReportsAndState().catch(() => {});
    throw error;
  } finally {
    if (lock && fs.existsSync(paths.dailyLock)) releaseRunLock(lock);
  }
}
