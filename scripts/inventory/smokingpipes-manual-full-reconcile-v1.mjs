import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  convertSmokingpipesCandidateDetails,
} from "../convert-smokingpipes-products-v2.mjs";
import {
  addParsedMeasurements,
  detectSmokingpipesVerification,
  extractDetailProduct,
  isNormalSmokingpipesDetail,
  launchSmokingpipesContext,
} from "../lib/smokingpipes-utils.mjs";
import {
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  createProgressiveDailyState,
  readProgressiveDailyState,
  validateProgressiveDailyState,
  writeProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  classifyProgressiveCandidatePublicStatus,
  buildProgressiveStateSummary,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  randomDelayMs,
} from "./smokingpipes-fetch-current-list-v1.mjs";

export const MANUAL_FULL_RECONCILE_VERSION =
  "smokingpipes-manual-full-reconcile-v1";

const ROOT = process.cwd();
const DEFAULT_PATHS = {
  currentList: path.join(
    ROOT,
    "data/inventory/smokingpipes-current-list-dry-run.json"
  ),
  diff: path.join(
    ROOT,
    "data/inventory/smokingpipes-inventory-diff-dry-run.json"
  ),
  production: path.join(
    ROOT,
    "data/products/smokingpipes-products.json"
  ),
  state: path.join(
    ROOT,
    "data/inventory/smokingpipes-progressive-daily-state.json"
  ),
  planJson: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-plan.json"
  ),
  planMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-plan.md"
  ),
  rebuildJson: path.join(
    ROOT,
    "data/review/smokingpipes-progressive-state-rebuild-report.json"
  ),
  rebuildMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-progressive-state-rebuild-report.md"
  ),
  detailBatchJson: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-detail-batch-report.json"
  ),
  detailBatchMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-detail-batch-report.md"
  ),
  promoteNextBatchJson: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-promote-next-batch-report.json"
  ),
  promoteNextBatchMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-promote-next-batch-report.md"
  ),
  detailSoldParserAuditJson: path.join(
    ROOT,
    "data/review/smokingpipes-detail-sold-parser-audit-report.json"
  ),
  detailSoldParserAuditMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-detail-sold-parser-audit-report.md"
  ),
  stateInconsistencyJson: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-state-inconsistency-report.json"
  ),
  stateInconsistencyMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-state-inconsistency-report.md"
  ),
  stateRepairJson: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-state-repair-report.json"
  ),
  stateRepairMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-manual-full-reconcile-state-repair-report.md"
  ),
};

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function productId(value) {
  return text(value?.sourceProductId || value?.id).replace(
    /^smokingpipes-/,
    ""
  );
}

function rows(payload) {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.products)
      ? payload.products
      : [];
}

function numericPrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0
      ? value
      : null;
  }
  const parsed = Number.parseFloat(
    text(value).replace(/[^0-9.]/g, "")
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

function productionPrice(product) {
  return (
    numericPrice(product?.price?.current?.amount) ||
    numericPrice(product?.price?.current?.rawText) ||
    numericPrice(product?.price?.listPrice?.amount) ||
    numericPrice(product?.sourcePriceUsd)
  );
}

function productImage(product) {
  return text(
    product?.mainImage ||
      product?.image ||
      product?.imageUrl ||
      product?.mainImageUrl ||
      product?.detailImageUrl
  );
}

function productBrand(product) {
  return text(
    product?.brand ||
      product?.canonicalBrand ||
      product?.rawBrand
  );
}

function productCode(product) {
  return text(product?.productCode).toLowerCase();
}

function sourceUrl(product) {
  return text(product?.sourceUrl || product?.href).toLowerCase();
}

function isExplicitOutOfStock(product) {
  return /\b(?:out[\s-]*of[\s-]*stock|sold[\s-]*out|unavailable)\b/i.test(
    `${product?.rawListStatus || ""} ${product?.rawText || ""}`
  );
}

function isSold(product) {
  return ["sold", "unavailable", "out-of-stock"].includes(
    text(product?.inventoryStatus).toLowerCase()
  );
}

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8").replace(/^\ufeff/, "")
  );
}

function readJsonIfExists(filePath, fallback = null) {
  return fs.existsSync(filePath)
    ? readJson(filePath)
    : fallback;
}

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function countUnknown(currentProducts) {
  return currentProducts.filter(
    (item) => !productId(item) || !sourceUrl(item)
  ).length;
}

function snapshotTrust(currentList, diff) {
  const summary = currentList?.summary || {};
  const coverage = diff?.coverage || {};
  const pagesScanned = Number(
    summary.pagesScanned || coverage.pagesScanned || 0
  );
  const expectedPages = Number(
    summary.expectedPages || coverage.expectedPages || 107
  );
  const captchaDetected =
    summary.captchaDetected === true ||
    coverage.captchaDetected === true ||
    (summary.captchaPages || []).length > 0 ||
    (coverage.captchaPages || []).length > 0;
  const verificationDetected =
    Boolean(summary.verificationDetectedAt) ||
    summary.verificationDetected === true ||
    coverage.verificationDetected === true ||
    [...(diff?.fatalWarnings || []), ...(diff?.warnings || [])].some(
      (item) =>
        /captcha|verification|challenge/i.test(String(item))
    );
  const fullExpectedRangeScanned =
    summary.fullExpectedRangeScanned === true &&
    coverage.fullExpectedRangeScanned !== false &&
    pagesScanned >= expectedPages;
  const reasons = [];
  if (!fullExpectedRangeScanned) {
    reasons.push("current-list snapshot is incomplete");
  }
  if (captchaDetected) {
    reasons.push("current-list snapshot detected CAPTCHA");
  }
  if (verificationDetected) {
    reasons.push("current-list snapshot detected verification");
  }
  return {
    trusted: reasons.length === 0,
    pagesScanned,
    expectedPages,
    fullExpectedRangeScanned,
    captchaDetected,
    verificationDetected,
    reasons,
  };
}

function duplicateEvidence({
  current,
  productionByCode,
  productionByUrl,
}) {
  const id = productId(current);
  const code = productCode(current);
  const url = sourceUrl(current);
  const codeMatch = code
    ? productionByCode.get(code)
    : null;
  const urlMatch = url ? productionByUrl.get(url) : null;
  const conflicting = [codeMatch, urlMatch].find(
    (item) => item && productId(item) !== id
  );
  return conflicting
    ? {
        suspected: true,
        existingSourceProductId: productId(conflicting),
        reason: codeMatch === conflicting
          ? `productCode matches production ${productId(conflicting)}`
          : `sourceUrl matches production ${productId(conflicting)}`,
      }
    : {
        suspected: false,
        existingSourceProductId: null,
        reason: null,
      };
}

function classifyNewProduct({
  current,
  previous,
  productionByCode,
  productionByUrl,
}) {
  const missingPrice = !numericPrice(current?.price);
  const missingImage = !productImage(current);
  const brandNeedsReview = !productBrand(current);
  const duplicate = duplicateEvidence({
    current,
    productionByCode,
    productionByUrl,
  });
  const issues = [];
  if (missingPrice) issues.push("missing-price");
  if (missingImage) issues.push("missing-image");
  if (brandNeedsReview) issues.push("brand-needs-review");
  if (duplicate.suspected) {
    issues.push("suspected-duplicate");
  }
  const reviewOnly = issues.length > 0;
  const preservedComplete = Boolean(
    previous?.detailStatus === "complete" &&
      previous?.detail &&
      previous?.convertedProduct
  );
  const lowPriority =
    !reviewOnly &&
    !/\bfresh\b/i.test(
      `${current?.rawText || ""} ${current?.title || ""}`
    );
  return {
    sourceProductId: productId(current),
    sourceUrl: text(current?.sourceUrl || current?.href),
    title: text(current?.title || current?.rawTitle),
    brand: productBrand(current),
    price: numericPrice(current?.price),
    image: productImage(current),
    productCode: text(current?.productCode),
    listPage: Number(current?.listPage || 0),
    missingPrice,
    missingImage,
    brandNeedsReview,
    suspectedDuplicate: duplicate.suspected,
    duplicateExistingSourceProductId:
      duplicate.existingSourceProductId,
    issues,
    reviewOnly,
    eligibleForDetail: !reviewOnly,
    lowPriority,
    preservedComplete,
    queueDisposition: reviewOnly
      ? "review-only"
      : preservedComplete
        ? "no-detail-required"
        : "unassigned",
  };
}

function broadPromotionClassification(priceChanges) {
  const distribution = {};
  for (const item of priceChanges) {
    const key = item.ratio.toFixed(2);
    distribution[key] = (distribution[key] || 0) + 1;
  }
  const [dominantRatioText, dominantCount] =
    Object.entries(distribution).sort(
      (left, right) => right[1] - left[1]
    )[0] || [null, 0];
  const dominantRatio = dominantRatioText
    ? Number(dominantRatioText)
    : null;
  const dominantShare = priceChanges.length
    ? dominantCount / priceChanges.length
    : 0;
  const detected =
    dominantCount >= 100 &&
    dominantShare >= 0.5 &&
    dominantRatio >= 0.84 &&
    dominantRatio <= 0.86;
  const likelyPromotionIds = new Set(
    detected
      ? priceChanges
          .filter(
            (item) =>
              Math.abs(item.ratio - dominantRatio) <= 0.01
          )
          .map((item) => item.sourceProductId)
      : []
  );
  return {
    detected,
    dominantRatio,
    dominantCount,
    dominantShare,
    distribution,
    likelyPromotionIds,
  };
}

function currentRecord(current, changeTypes) {
  return {
    sourceProductId: productId(current),
    sourceUrl: text(current?.sourceUrl || current?.href),
    title: text(current?.title || current?.rawTitle),
    brand: productBrand(current),
    listPrice: text(current?.price),
    listPrimaryImage: productImage(current),
    inventoryStatus: isExplicitOutOfStock(current)
      ? "sold"
      : "available",
    changeTypes,
  };
}

export function buildSmokingpipesManualFullReconcilePlan({
  currentList,
  diff,
  productionProducts = [],
  previousState = null,
  detailMax = 30,
  now = new Date().toISOString(),
}) {
  const cappedDetailMax = Math.min(
    30,
    Math.max(1, Number(detailMax) || 30)
  );
  const currentProducts = rows(currentList);
  const productionRows = rows(productionProducts);
  const trust = snapshotTrust(currentList, diff);
  const currentIds = currentProducts.map(productId).filter(Boolean);
  const uniqueCurrentIds = new Set(currentIds);
  if (uniqueCurrentIds.size !== currentIds.length) {
    trust.trusted = false;
    trust.reasons.push(
      "current-list snapshot contains duplicate sourceProductIds"
    );
  }
  const productionById = new Map(
    productionRows.map((item) => [productId(item), item])
  );
  const productionByCode = new Map(
    productionRows
      .filter((item) => productCode(item))
      .map((item) => [productCode(item), item])
  );
  const productionByUrl = new Map(
    productionRows
      .filter((item) => sourceUrl(item))
      .map((item) => [sourceUrl(item), item])
  );
  const previousById = new Map(
    (previousState?.candidates || []).map((item) => [
      productId(item),
      item,
    ])
  );
  const newIds = new Set(uniqueStrings(diff?.newIds));
  const reappearedIds = new Set(
    uniqueStrings(diff?.reappearedIds)
  );
  const disappearedIds = uniqueStrings(diff?.disappearedIds);
  const newClassifications = currentProducts
    .filter((item) => newIds.has(productId(item)))
    .map((current) =>
      classifyNewProduct({
        current,
        previous: previousById.get(productId(current)),
        productionByCode,
        productionByUrl,
      })
    );
  const detailEligible = newClassifications
    .filter(
      (item) =>
        item.eligibleForDetail && !item.preservedComplete
    )
    .sort(
      (left, right) =>
        Number(left.lowPriority) -
          Number(right.lowPriority) ||
        left.listPage - right.listPage ||
        left.sourceProductId.localeCompare(
          right.sourceProductId,
          "en"
        )
    );
  const firstBatch = trust.trusted
    ? detailEligible.slice(0, cappedDetailMax)
    : [];
  const firstBatchIds = new Set(
    firstBatch.map((item) => item.sourceProductId)
  );
  for (const item of newClassifications) {
    if (
      item.reviewOnly ||
      item.preservedComplete
    ) {
      continue;
    }
    item.queueDisposition = firstBatchIds.has(
      item.sourceProductId
    )
      ? "eligible-this-batch"
      : "queued-later";
  }
  const newClassificationById = new Map(
    newClassifications.map((item) => [
      item.sourceProductId,
      item,
    ])
  );
  const previousPendingIds = (
    previousState?.candidates || []
  )
    .filter((item) => item.detailStatus === "pending")
    .map(productId)
    .filter(Boolean);
  const previousPendingTriage = {
    total: previousPendingIds.length,
    firstBatch: 0,
    deferred: 0,
    reviewOnly: 0,
    preservedComplete: 0,
    noLongerNewOrMissing: 0,
    accountedFor: 0,
  };
  for (const id of previousPendingIds) {
    const classification = newClassificationById.get(id);
    if (!classification) {
      previousPendingTriage.noLongerNewOrMissing += 1;
    } else if (
      classification.queueDisposition ===
      "eligible-this-batch"
    ) {
      previousPendingTriage.firstBatch += 1;
    } else if (
      classification.queueDisposition === "queued-later"
    ) {
      previousPendingTriage.deferred += 1;
    } else if (
      classification.queueDisposition === "review-only"
    ) {
      previousPendingTriage.reviewOnly += 1;
    } else if (
      classification.preservedComplete
    ) {
      previousPendingTriage.preservedComplete += 1;
    }
  }
  previousPendingTriage.accountedFor =
    previousPendingTriage.firstBatch +
    previousPendingTriage.deferred +
    previousPendingTriage.reviewOnly +
    previousPendingTriage.preservedComplete +
    previousPendingTriage.noLongerNewOrMissing;

  const priceChanges = [];
  const explicitOutOfStock = [];
  const reappeared = [];
  const noOp = [];
  const actionIds = new Set(newIds);
  for (const current of currentProducts) {
    const id = productId(current);
    if (!id || newIds.has(id)) continue;
    const production = productionById.get(id);
    if (!production) {
      noOp.push(id);
      continue;
    }
    const currentPrice = numericPrice(current?.price);
    const oldPrice = productionPrice(production);
    const changeTypes = [];
    if (
      currentPrice &&
      oldPrice &&
      Math.abs(currentPrice - oldPrice) > 0.0001
    ) {
      priceChanges.push({
        sourceProductId: id,
        oldPrice,
        currentPrice,
        ratio: currentPrice / oldPrice,
      });
      changeTypes.push("price-change");
    }
    if (
      isExplicitOutOfStock(current) &&
      !isSold(production)
    ) {
      explicitOutOfStock.push(id);
      changeTypes.push("explicit-out-of-stock");
    }
    if (reappearedIds.has(id) && isSold(production)) {
      reappeared.push(id);
      changeTypes.push("reappeared");
    }
    if (changeTypes.length) {
      actionIds.add(id);
    } else {
      noOp.push(id);
    }
  }
  const promotion =
    broadPromotionClassification(priceChanges);
  const likelyPromotion = priceChanges.filter((item) =>
    promotion.likelyPromotionIds.has(item.sourceProductId)
  );
  const realPriceChange = priceChanges.filter(
    (item) =>
      !promotion.likelyPromotionIds.has(item.sourceProductId)
  );
  const noOpAlreadyCurrent = (
    previousState?.candidates || []
  ).filter((candidate) => {
    if (
      !(candidate.changeTypes || []).includes("price-change")
    ) {
      return false;
    }
    const current = currentProducts.find(
      (item) => productId(item) === productId(candidate)
    );
    const production = productionById.get(productId(candidate));
    const currentPrice = numericPrice(current?.price);
    const oldPrice = productionPrice(production);
    return Boolean(
      current &&
        production &&
        currentPrice &&
        oldPrice &&
        Math.abs(currentPrice - oldPrice) <= 0.0001
    );
  });

  const actionRecords = [];
  for (const item of newClassifications) {
    actionRecords.push({
      ...item,
      changeTypes: ["new-product"],
    });
  }
  for (const current of currentProducts) {
    const id = productId(current);
    if (!id || newIds.has(id)) continue;
    const changeTypes = [];
    if (
      priceChanges.some(
        (item) => item.sourceProductId === id
      )
    ) {
      changeTypes.push("price-change");
    }
    if (explicitOutOfStock.includes(id)) {
      changeTypes.push("explicit-out-of-stock");
    }
    if (reappeared.includes(id)) {
      changeTypes.push("reappeared");
    }
    if (changeTypes.length) {
      actionRecords.push(currentRecord(current, changeTypes));
    }
  }

  return {
    version: MANUAL_FULL_RECONCILE_VERSION,
    source: "smokingpipes",
    mode: "plan-only",
    generatedAt: now,
    networkAccessed: false,
    detailsFetched: false,
    productionWritten: false,
    snapshot: {
      ...trust,
      totalProducts: currentProducts.length,
      uniqueProducts: uniqueCurrentIds.size,
      completedAt:
        currentList?.completedAt ||
        currentList?.summary?.completedAt ||
        null,
    },
    production: {
      totalProducts: productionRows.length,
    },
    diffCounts: {
      newProduct: newClassifications.length,
      priceChange: priceChanges.length,
      explicitOutOfStock: explicitOutOfStock.length,
      reappeared: reappeared.length,
      disappeared: disappearedIds.length,
      noOp: noOp.length,
      unknown: countUnknown(currentProducts),
    },
    newProduct: {
      eligibleForDetail: newClassifications.filter(
        (item) => item.eligibleForDetail
      ).length,
      lowPriority: newClassifications.filter(
        (item) => item.lowPriority
      ).length,
      missingPrice: newClassifications.filter(
        (item) => item.missingPrice
      ).length,
      missingImage: newClassifications.filter(
        (item) => item.missingImage
      ).length,
      brandNeedsReview: newClassifications.filter(
        (item) => item.brandNeedsReview
      ).length,
      suspectedDuplicate: newClassifications.filter(
        (item) => item.suspectedDuplicate
      ).length,
      reviewOnly: newClassifications.filter(
        (item) => item.reviewOnly
      ).length,
      preservedComplete: newClassifications.filter(
        (item) => item.preservedComplete
      ).length,
      classifications: newClassifications,
    },
    priceChange: {
      likelyPromotion: likelyPromotion.length,
      realPriceChange: realPriceChange.length,
      noOpAlreadyCurrent: noOpAlreadyCurrent.length,
      promotionDetected: promotion.detected,
      dominantRatio: promotion.dominantRatio,
      dominantCount: promotion.dominantCount,
      dominantShare: promotion.dominantShare,
      likelyPromotionSourceProductIds:
        likelyPromotion.map((item) => item.sourceProductId),
      realPriceChangeSourceProductIds:
        realPriceChange.map((item) => item.sourceProductId),
      noOpAlreadyCurrentSourceProductIds:
        noOpAlreadyCurrent.map(productId),
    },
    explicitOutOfStock: {
      count: explicitOutOfStock.length,
      sourceProductIds: explicitOutOfStock,
    },
    reappeared: {
      count: reappeared.length,
      sourceProductIds: reappeared,
    },
    disappeared: {
      disappearedApplyDisabled: disappearedIds.length,
      needsManualReview: disappearedIds.length,
      applyAllowed: false,
      sourceProductIds: disappearedIds,
    },
    detailQueue: {
      totalPending: detailEligible.length,
      eligibleThisBatch: firstBatch.length,
      deferred: Math.max(
        0,
        detailEligible.length - firstBatch.length
      ),
      blocked: newClassifications.filter(
        (item) => item.reviewOnly
      ).length,
      detailMax: cappedDetailMax,
      requiresTriage: detailEligible.length > 300,
    },
    previousPendingTriage,
    firstDetailBatchSourceProductIds: firstBatch.map(
      (item) => item.sourceProductId
    ),
    gates: {
      allowDetailFetch:
        trust.trusted && firstBatch.length > 0,
      allowProductionApply: false,
      allowDailyTaskResume: false,
      refreshSnapshotRequired: false,
    },
    actionRecords,
    warnings: [
      ...(promotion.detected
        ? [
            `${likelyPromotion.length} price changes match a broad 15% promotion and must not trigger detail fetches.`,
          ]
        : []),
      ...(disappearedIds.length
        ? [
            `${disappearedIds.length} disappeared products are recorded with apply disabled.`,
          ]
        : []),
      ...(detailEligible.length > 300
        ? [
            `${detailEligible.length} detail candidates require triage; only the first ${firstBatch.length} are eligible in this batch.`,
          ]
        : []),
    ],
  };
}

function baseCandidate({
  record,
  previous,
  production,
  runId,
  now,
}) {
  return {
    sourceProductId: record.sourceProductId,
    sourceUrl: record.sourceUrl,
    listTitle: record.title,
    listPrice: record.listPrice || (
      record.price ? `$${record.price.toFixed(2)}` : ""
    ),
    listPrimaryImage:
      record.listPrimaryImage || record.image || "",
    inventoryStatus: record.inventoryStatus || "available",
    discoveredAt: previous?.discoveredAt || now,
    firstSeenRunId: previous?.firstSeenRunId || runId,
    lastSeenRunId: runId,
    lastSeenAt: now,
    changeTypes: [...record.changeTypes],
    detailStatus: "complete",
    publicStatus: "ready",
    detailAttempts: Number(previous?.detailAttempts || 0),
    retryCount: Number(previous?.retryCount || 0),
    lastAttemptAt: previous?.lastAttemptAt || null,
    lastSuccessfulDetailRunId:
      previous?.lastSuccessfulDetailRunId || null,
    lastAppliedAt: previous?.lastAppliedAt || null,
    appliedInCommit: previous?.appliedInCommit || null,
    lastError: null,
    priority: record.changeTypes.includes("new-product")
      ? 100
      : 50,
    blockedCount: Number(previous?.blockedCount || 0),
    lastBlockedAt: previous?.lastBlockedAt || null,
    lastBlockedReason: previous?.lastBlockedReason || null,
    nextEligibleAt: null,
    detail: previous?.detail || null,
    convertedProduct: previous?.convertedProduct || null,
    productionProductId:
      production?.id ||
      previous?.productionProductId ||
      null,
    lastBuiltAt: previous?.lastBuiltAt || null,
    queueDisposition: "no-detail-required",
    manualReconcile: {
      classification: "explicit-list-change",
      rebuiltAt: now,
    },
  };
}

export function rebuildSmokingpipesProgressiveState({
  plan,
  currentList,
  productionProducts = [],
  previousState,
  now = new Date().toISOString(),
}) {
  if (plan?.version !== MANUAL_FULL_RECONCILE_VERSION) {
    throw new Error("manual full reconcile plan is invalid");
  }
  if (plan?.snapshot?.trusted !== true) {
    throw new Error(
      "manual full reconcile state rebuild requires a trusted snapshot"
    );
  }
  const runId = `manual-reconcile-${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const next = createProgressiveDailyState({
    dailyRunId: runId,
    expectedPages: plan.snapshot.expectedPages,
    now,
  });
  const currentById = new Map(
    rows(currentList).map((item) => [productId(item), item])
  );
  const productionById = new Map(
    rows(productionProducts).map((item) => [
      productId(item),
      item,
    ])
  );
  const previousById = new Map(
    (previousState?.candidates || []).map((item) => [
      productId(item),
      item,
    ])
  );
  const firstBatchIds = new Set(
    plan.firstDetailBatchSourceProductIds || []
  );
  let preservedComplete = 0;
  let pending = 0;
  let deferred = 0;
  let reviewOnly = 0;
  let noDetailRequired = 0;

  for (const record of plan.actionRecords || []) {
    const id = record.sourceProductId;
    const previous = previousById.get(id);
    const current = currentById.get(id) || record;
    const candidate = baseCandidate({
      record: {
        ...record,
        sourceUrl:
          record.sourceUrl || text(current?.sourceUrl),
        title:
          record.title ||
          text(current?.title || current?.rawTitle),
        listPrice:
          record.listPrice || text(current?.price),
        listPrimaryImage:
          record.listPrimaryImage || productImage(current),
        inventoryStatus:
          record.inventoryStatus ||
          (isExplicitOutOfStock(current)
            ? "sold"
            : "available"),
      },
      previous,
      production: productionById.get(id),
      runId,
      now,
    });
    if (record.changeTypes.includes("new-product")) {
      if (record.reviewOnly) {
        candidate.detailStatus = "review-only";
        candidate.publicStatus = "review-only";
        candidate.queueDisposition = "review-only";
        candidate.lastError =
          record.issues.join(", ") ||
          "manual reconcile review required";
        candidate.manualReconcile.classification =
          "review-only";
        reviewOnly += 1;
      } else if (
        record.preservedComplete &&
        previous?.detail &&
        previous?.convertedProduct
      ) {
        candidate.detailStatus = "complete";
        candidate.publicStatus =
          previous.publicStatus === "published"
            ? "published"
            : previous.publicStatus || "ready";
        candidate.queueDisposition =
          "no-detail-required";
        candidate.manualReconcile.classification =
          "preserved-complete";
        preservedComplete += 1;
      } else if (firstBatchIds.has(id)) {
        candidate.detailStatus = "pending";
        candidate.publicStatus = "not-public";
        candidate.queueDisposition =
          "eligible-this-batch";
        candidate.detail = null;
        candidate.convertedProduct = null;
        candidate.manualReconcile.classification =
          "first-detail-batch";
        pending += 1;
      } else {
        candidate.detailStatus = "deferred";
        candidate.publicStatus = "not-public";
        candidate.queueDisposition = "queued-later";
        candidate.detail = null;
        candidate.convertedProduct = null;
        candidate.manualReconcile.classification =
          "queued-later";
        deferred += 1;
      }
    } else {
      noDetailRequired += 1;
    }
    next.candidates.push(candidate);
  }

  next.listSnapshotStatus = "complete";
  next.pagesScanned = plan.snapshot.pagesScanned;
  next.expectedPages = plan.snapshot.expectedPages;
  next.fullExpectedRangeScanned = true;
  next.captchaDetected = false;
  next.verificationDetected = false;
  next.currentListPath =
    "data/inventory/smokingpipes-current-list-dry-run.json";
  next.diffPath =
    "data/inventory/smokingpipes-inventory-diff-dry-run.json";
  next.globalReconcile = {
    allowed: true,
    applyAllowed: false,
    disappearedIds: [
      ...(plan.disappeared?.sourceProductIds || []),
    ],
  };
  next.manualFullReconcile = {
    version: MANUAL_FULL_RECONCILE_VERSION,
    mode: "rebuild-state",
    rebuiltAt: now,
    planGeneratedAt: plan.generatedAt,
    detailMax: plan.detailQueue.detailMax,
    firstDetailBatchSourceProductIds: [
      ...plan.firstDetailBatchSourceProductIds,
    ],
    allowProductionApply: false,
    allowDailyTaskResume: false,
  };
  next.updatedAt = now;
  next.summary = buildProgressiveStateSummary(next, now);
  next.productionWritten = false;
  const validation = validateProgressiveDailyState(next);
  if (!validation.valid) {
    throw new Error(
      `rebuilt progressive state is invalid: ${validation.errors.join("; ")}`
    );
  }
  return {
    state: next,
    report: {
      version:
        "smokingpipes-progressive-state-rebuild-report-v1",
      source: "smokingpipes",
      generatedAt: now,
      previousCandidates:
        previousState?.candidates?.length || 0,
      rebuiltCandidates: next.candidates.length,
      preservedComplete,
      pending,
      deferred,
      reviewOnly,
      noDetailRequired,
      disappearedRecorded:
        next.globalReconcile.disappearedIds.length,
      disappearedApplyAllowed: false,
      staleSummaryCleared: true,
      previousSummary: previousState?.summary || null,
      rebuiltSummary: next.summary,
      stateValidation: validation,
      productionWritten: false,
      dailyTaskResumeAllowed: false,
    },
  };
}

export function selectManualFullReconcileDetailBatchCandidates({
  state,
  detailMax = 30,
}) {
  const cappedDetailMax = Math.min(
    30,
    Math.max(1, Number(detailMax) || 30)
  );
  return (state?.candidates || [])
    .filter(
      (item) =>
        (item.changeTypes || []).includes("new-product") &&
        item.detailStatus === "pending" &&
        item.publicStatus === "not-public" &&
        item.queueDisposition === "eligible-this-batch"
    )
    .slice(0, cappedDetailMax);
}

export function buildManualFullReconcileStateConsistencyReport({
  state,
  generatedAt = new Date().toISOString(),
} = {}) {
  const candidates = Array.isArray(state?.candidates)
    ? state.candidates
    : [];
  const count = (predicate) =>
    candidates.filter(predicate).length;
  const sample = (predicate) =>
    candidates
      .filter(predicate)
      .slice(0, 30)
      .map((item) => ({
        sourceProductId: productId(item),
        queueDisposition: text(item?.queueDisposition),
        detailStatus: text(item?.detailStatus),
        publicStatus: text(item?.publicStatus),
      }));
  const allowedQueueDispositions = new Set([
    "eligible-this-batch",
    "queued-later",
    "review-only",
    "no-detail-required",
  ]);
  const counts = {
    totalCandidates: candidates.length,
    eligibleThisBatch: count(
      (item) => item.queueDisposition === "eligible-this-batch"
    ),
    pending: count((item) => item.detailStatus === "pending"),
    eligiblePending: count(
      (item) =>
        item.queueDisposition === "eligible-this-batch" &&
        item.detailStatus === "pending"
    ),
    queuedLater: count(
      (item) => item.queueDisposition === "queued-later"
    ),
    queuedLaterDeferred: count(
      (item) =>
        item.queueDisposition === "queued-later" &&
        item.detailStatus === "deferred"
    ),
    reviewOnlyDisposition: count(
      (item) => item.queueDisposition === "review-only"
    ),
    reviewOnlyStatus: count(
      (item) => item.detailStatus === "review-only"
    ),
    reviewOnlyAligned: count(
      (item) =>
        item.queueDisposition === "review-only" &&
        item.detailStatus === "review-only" &&
        item.publicStatus === "review-only"
    ),
    noDetailRequired: count(
      (item) => item.queueDisposition === "no-detail-required"
    ),
    invalidQueueDisposition: count(
      (item) =>
        !allowedQueueDispositions.has(
          text(item?.queueDisposition)
        )
    ),
  };
  const blockers = [];
  if (counts.eligibleThisBatch !== counts.pending) {
    blockers.push(
      `eligible-this-batch count ${counts.eligibleThisBatch} does not equal pending count ${counts.pending}`
    );
  }
  if (counts.eligibleThisBatch !== counts.eligiblePending) {
    blockers.push(
      "eligible-this-batch contains non-pending candidates"
    );
  }
  if (counts.pending !== counts.eligiblePending) {
    blockers.push(
      "pending candidates exist outside eligible-this-batch"
    );
  }
  if (counts.queuedLater !== counts.queuedLaterDeferred) {
    blockers.push(
      "queued-later candidates must keep detailStatus=deferred"
    );
  }
  if (counts.reviewOnlyDisposition !== counts.reviewOnlyAligned) {
    blockers.push(
      "review-only queue candidates must keep detailStatus=review-only and publicStatus=review-only"
    );
  }
  if (counts.invalidQueueDisposition > 0) {
    blockers.push(
      "state contains queueDisposition values outside the Manual Full Reconcile V1 model"
    );
  }
  return {
    version:
      "smokingpipes-manual-full-reconcile-state-consistency-v1",
    source: "smokingpipes",
    mode: "state-consistency",
    generatedAt,
    status: blockers.length ? "blocked" : "passed",
    canFetchDetailBatch: blockers.length === 0,
    smokingpipesAccessed: false,
    productionWritten: false,
    counts,
    blockers,
    samples: {
      eligibleNonPending: sample(
        (item) =>
          item.queueDisposition === "eligible-this-batch" &&
          item.detailStatus !== "pending"
      ),
      pendingOutsideEligible: sample(
        (item) =>
          item.detailStatus === "pending" &&
          item.queueDisposition !== "eligible-this-batch"
      ),
      queuedLaterNonDeferred: sample(
        (item) =>
          item.queueDisposition === "queued-later" &&
          item.detailStatus !== "deferred"
      ),
      reviewOnlyMisaligned: sample(
        (item) =>
          item.queueDisposition === "review-only" &&
          (item.detailStatus !== "review-only" ||
            item.publicStatus !== "review-only")
      ),
      invalidQueueDisposition: sample(
        (item) =>
          !allowedQueueDispositions.has(
            text(item?.queueDisposition)
          )
      ),
    },
  };
}

export function repairManualFullReconcileState({
  state,
  now = new Date().toISOString(),
} = {}) {
  const before =
    buildManualFullReconcileStateConsistencyReport({
      state,
      generatedAt: now,
    });
  const next = structuredClone(state);
  let eligibleRestoredToPending = 0;
  let queuedLaterRestoredToDeferred = 0;
  let reviewOnlyRestored = 0;
  let preservedCompleteDispositionRewritten = 0;
  let cachedDetailCleared = 0;
  for (const candidate of next.candidates || []) {
    if (candidate.queueDisposition === "preserved-complete") {
      candidate.queueDisposition = "no-detail-required";
      preservedCompleteDispositionRewritten += 1;
    }
    if (candidate.queueDisposition === "eligible-this-batch") {
      if (candidate.detail || candidate.convertedProduct) {
        cachedDetailCleared += 1;
      }
      candidate.detailStatus = "pending";
      candidate.publicStatus = "not-public";
      candidate.detail = null;
      candidate.convertedProduct = null;
      candidate.lastSuccessfulDetailRunId = null;
      candidate.lastError = null;
      candidate.nextEligibleAt = null;
      candidate.manualReconcile = {
        ...(candidate.manualReconcile || {}),
        classification: "first-detail-batch",
        repairedAt: now,
      };
      eligibleRestoredToPending += 1;
    } else if (candidate.queueDisposition === "queued-later") {
      candidate.detailStatus = "deferred";
      candidate.publicStatus = "not-public";
      candidate.detail = null;
      candidate.convertedProduct = null;
      queuedLaterRestoredToDeferred += 1;
    } else if (candidate.queueDisposition === "review-only") {
      candidate.detailStatus = "review-only";
      candidate.publicStatus = "review-only";
      reviewOnlyRestored += 1;
    }
  }
  next.updatedAt = now;
  next.manualFullReconcile = {
    ...(next.manualFullReconcile || {}),
    mode: "repair-state",
    stateRepair: {
      repairedAt: now,
      eligibleRestoredToPending,
      queuedLaterRestoredToDeferred,
      reviewOnlyRestored,
      preservedCompleteDispositionRewritten,
      cachedDetailCleared,
      smokingpipesAccessed: false,
      productionWritten: false,
    },
    allowProductionApply: false,
    allowDailyTaskResume: false,
  };
  next.productionWritten = false;
  next.summary = buildProgressiveStateSummary(next, now);
  const after =
    buildManualFullReconcileStateConsistencyReport({
      state: next,
      generatedAt: now,
    });
  return {
    state: next,
    report: {
      version:
        "smokingpipes-manual-full-reconcile-state-repair-report-v1",
      source: "smokingpipes",
      mode: "repair-state",
      generatedAt: now,
      before,
      after,
      eligibleRestoredToPending,
      queuedLaterRestoredToDeferred,
      reviewOnlyRestored,
      preservedCompleteDispositionRewritten,
      cachedDetailCleared,
      smokingpipesAccessed: false,
      productionWritten: false,
    },
  };
}

function candidateListPrice(candidate) {
  return numericPrice(
    candidate?.listPrice ||
      candidate?.price ||
      candidate?.priceRaw
  );
}

function candidatePrimaryImage(candidate) {
  return text(
    candidate?.listPrimaryImage ||
      candidate?.image ||
      candidate?.imageUrl ||
      candidate?.mainImage ||
      candidate?.mainImageUrl
  );
}

function candidateRecognizedBrand(candidate) {
  return text(
    candidate?.brand ||
      candidate?.canonicalBrand ||
      candidate?.listBrand ||
      candidate?.rawBrand ||
      candidate?.manualReconcile?.brand
  );
}

function candidateHasMissingPriceSignal(candidate) {
  return /missing[-\s]*price|price\s*(?:missing|unknown|unavailable)/i.test(
    `${candidate?.lastError || ""} ${candidate?.reviewReason || ""} ${candidate?.manualReconcile?.classification || ""}`
  );
}

function candidateHasInventoryConflict(candidate) {
  return /inventory\s+conflict|detail page says sold/i.test(
    `${candidate?.lastError || ""} ${candidate?.reviewReason || ""}`
  );
}

function isManualPromotableQueuedLaterCandidate(candidate) {
  return Boolean(
    (candidate?.changeTypes || []).includes("new-product") &&
      candidate?.queueDisposition === "queued-later" &&
      candidate?.detailStatus === "deferred" &&
      candidate?.publicStatus === "not-public" &&
      !candidateHasInventoryConflict(candidate)
  );
}

function manualPromotePriority(candidate) {
  const hasValidPrice = Boolean(candidateListPrice(candidate));
  const hasImage = Boolean(candidatePrimaryImage(candidate));
  const hasBrand = Boolean(candidateRecognizedBrand(candidate));
  const missingPrice = candidateHasMissingPriceSignal(candidate);
  return {
    hasValidPrice,
    hasImage,
    hasBrand,
    missingPrice,
    score:
      Number(hasValidPrice) * 1000 +
      Number(hasImage) * 100 +
      Number(hasBrand) * 10 -
      Number(missingPrice) * 500,
  };
}

export function selectManualFullReconcilePromoteCandidates({
  state,
  detailMax = 30,
}) {
  const cappedDetailMax = Math.min(
    30,
    Math.max(1, Number(detailMax) || 30)
  );
  return (state?.candidates || [])
    .filter(isManualPromotableQueuedLaterCandidate)
    .map((candidate, index) => ({
      candidate,
      originalIndex: index,
      priority: manualPromotePriority(candidate),
    }))
    .sort(
      (left, right) =>
        right.priority.score - left.priority.score ||
        Number(left.priority.missingPrice) -
          Number(right.priority.missingPrice) ||
        text(left.candidate.listTitle).localeCompare(
          text(right.candidate.listTitle),
          "en"
        ) ||
        productId(left.candidate).localeCompare(
          productId(right.candidate),
          "en"
        )
    )
    .slice(0, cappedDetailMax)
    .map((item) => item.candidate);
}

export function buildManualFullReconcilePromoteNextBatchReport({
  beforeState,
  afterState,
  promoted = [],
  batchLimit = 30,
  generatedAt = new Date().toISOString(),
  status = "promoted",
  beforeConsistency = null,
  afterConsistency = null,
  blockers = [],
} = {}) {
  const cappedBatchLimit = Math.min(
    30,
    Math.max(1, Number(batchLimit) || 30)
  );
  const count = (state, predicate) =>
    (state?.candidates || []).filter(predicate).length;
  return {
    version:
      "smokingpipes-manual-full-reconcile-promote-next-batch-report-v1",
    source: "smokingpipes",
    mode: "promote-next-batch",
    generatedAt,
    status,
    batchLimit: cappedBatchLimit,
    promotedCount: promoted.length,
    remainingQueuedLaterCount: count(
      afterState || beforeState,
      (item) => item.queueDisposition === "queued-later"
    ),
    pendingCountAfter: count(
      afterState || beforeState,
      (item) =>
        item.queueDisposition === "eligible-this-batch" &&
        item.detailStatus === "pending"
    ),
    reviewOnlyCount: count(
      afterState || beforeState,
      (item) =>
        item.queueDisposition === "review-only" ||
        item.detailStatus === "review-only" ||
        item.publicStatus === "review-only"
    ),
    completeCount: count(
      afterState || beforeState,
      (item) => item.detailStatus === "complete"
    ),
    beforeCounts: beforeConsistency?.counts || null,
    afterCounts: afterConsistency?.counts || null,
    promotedSourceProductIds: promoted.map(productId),
    promotedItems: promoted.map((item) => {
      const priority = manualPromotePriority(item);
      return {
        sourceProductId: productId(item),
        sourceUrl: text(item.sourceUrl),
        title: text(item.listTitle),
        listPrice: text(item.listPrice),
        hasValidPrice: priority.hasValidPrice,
        hasImage: priority.hasImage,
        hasBrand: priority.hasBrand,
        missingPrice: priority.missingPrice,
        score: priority.score,
      };
    }),
    blockers,
    smokingpipesAccessed: false,
    productionWritten: false,
  };
}

export function promoteManualFullReconcileNextBatch({
  state,
  detailMax = 30,
  now = new Date().toISOString(),
} = {}) {
  const beforeConsistency =
    buildManualFullReconcileStateConsistencyReport({
      state,
      generatedAt: now,
    });
  if (!beforeConsistency.canFetchDetailBatch) {
    const report =
      buildManualFullReconcilePromoteNextBatchReport({
        beforeState: state,
        afterState: state,
        promoted: [],
        batchLimit: detailMax,
        generatedAt: now,
        status: "state-inconsistent",
        beforeConsistency,
        afterConsistency: beforeConsistency,
        blockers: beforeConsistency.blockers,
      });
    return {
      status: "state-inconsistent",
      state,
      report,
      consistency: beforeConsistency,
      productionWritten: false,
    };
  }
  const validation = validateProgressiveDailyState(state);
  if (!validation.valid) {
    throw Object.assign(
      new Error(
        `Manual PromoteNextBatch blocked by invalid state: ${validation.errors.join("; ")}`
      ),
      {
        code: "MANUAL_RECONCILE_STATE_INVALID",
        errors: validation.errors,
      }
    );
  }
  const cappedDetailMax = Math.min(
    30,
    Math.max(1, Number(detailMax) || 30)
  );
  const next = structuredClone(state);
  const selected = selectManualFullReconcilePromoteCandidates({
    state: next,
    detailMax: cappedDetailMax,
  });
  const selectedIds = new Set(selected.map(productId));
  for (const candidate of next.candidates || []) {
    if (!selectedIds.has(productId(candidate))) continue;
    candidate.queueDisposition = "eligible-this-batch";
    candidate.detailStatus = "pending";
    candidate.publicStatus = "not-public";
    candidate.detail = null;
    candidate.convertedProduct = null;
    candidate.lastError = null;
    candidate.reviewReason = null;
    candidate.nextEligibleAt = null;
    candidate.manualReconcile = {
      ...(candidate.manualReconcile || {}),
      classification: "promoted-next-batch",
      promotedAt: now,
    };
  }
  next.updatedAt = now;
  next.manualFullReconcile = {
    ...(next.manualFullReconcile || {}),
    mode: "promote-next-batch",
    promoteNextBatch: {
      promotedAt: now,
      detailMax: cappedDetailMax,
      promotedSourceProductIds: [...selectedIds],
      smokingpipesAccessed: false,
      productionWritten: false,
    },
    allowProductionApply: false,
    allowDailyTaskResume: false,
  };
  next.latestRun = {
    runId: next.dailyRunId,
    mode: "manual-full-reconcile-promote-next-batch",
    finishedAt: now,
    selected: selected.length,
    attempted: 0,
    completedThisRun: 0,
    failedThisRun: 0,
    blockedReason: null,
    recommendedNextRunAt: null,
    productionWritten: false,
  };
  next.productionWritten = false;
  next.summary = buildProgressiveStateSummary(next, now);
  const afterConsistency =
    buildManualFullReconcileStateConsistencyReport({
      state: next,
      generatedAt: now,
    });
  if (!afterConsistency.canFetchDetailBatch) {
    const report =
      buildManualFullReconcilePromoteNextBatchReport({
        beforeState: state,
        afterState: next,
        promoted: selected,
        batchLimit: cappedDetailMax,
        generatedAt: now,
        status: "state-inconsistent",
        beforeConsistency,
        afterConsistency,
        blockers: afterConsistency.blockers,
      });
    return {
      status: "state-inconsistent",
      state,
      report,
      consistency: afterConsistency,
      productionWritten: false,
    };
  }
  const nextValidation = validateProgressiveDailyState(next);
  if (!nextValidation.valid) {
    throw new Error(
      `Manual PromoteNextBatch produced invalid state: ${nextValidation.errors.join("; ")}`
    );
  }
  const report =
    buildManualFullReconcilePromoteNextBatchReport({
      beforeState: state,
      afterState: next,
      promoted: selected,
      batchLimit: cappedDetailMax,
      generatedAt: now,
      status: selected.length
        ? "promoted"
        : "no-queued-later-candidates",
      beforeConsistency,
      afterConsistency,
    });
  return {
    status: selected.length
      ? "batch-promoted"
      : "no-queued-later-candidates",
    state: next,
    report,
    consistency: afterConsistency,
    productionWritten: false,
  };
}

function manualDetailPrice(candidate) {
  return (
    text(candidate?.detail?.price) ||
    text(candidate?.convertedProduct?.price?.current?.rawText) ||
    text(candidate?.listPrice)
  );
}

function manualDetailHasPrice(candidate) {
  return Boolean(numericPrice(manualDetailPrice(candidate)));
}

function manualListSaysAvailable(candidate) {
  return (
    text(candidate?.inventoryStatus).toLowerCase() === "available" ||
    text(candidate?.rawListStatus).toLowerCase() === "available" ||
    text(candidate?.convertedProduct?.rawListStatus).toLowerCase() === "available" ||
    text(candidate?.convertedProduct?.inventoryEvidence?.rawListStatus).toLowerCase() === "available"
  );
}

function manualSoldEvidence(candidate) {
  const evidence = [
    ...(candidate?.detail?.statusEvidence?.soldEvidence || []),
    ...(candidate?.convertedProduct?.inventoryEvidence?.soldEvidence || []),
  ]
    .map(text)
    .filter(Boolean);
  if (
    text(candidate?.detail?.status).toLowerCase() === "sold" &&
    !evidence.length
  ) {
    evidence.push(
      "weak/legacy-detail-status-sold-without-source-evidence"
    );
  }
  return uniqueStrings(evidence);
}

function manualAvailableEvidence(candidate) {
  const evidence = [
    ...(candidate?.detail?.statusEvidence?.availableEvidence || []),
    ...(candidate?.convertedProduct?.inventoryEvidence?.availableEvidence || []),
  ]
    .map(text)
    .filter(Boolean);
  if (manualDetailHasPrice(candidate)) {
    evidence.push("detail-price-present");
  }
  if (manualListSaysAvailable(candidate)) {
    evidence.push("current-list-available");
  }
  return uniqueStrings(evidence);
}

function manualRawStatusSource(candidate) {
  return (
    text(candidate?.detail?.rawStatusSource) ||
    text(candidate?.detail?.statusEvidence?.rawStatusSource) ||
    text(candidate?.convertedProduct?.inventoryEvidence?.rawStatusSource) ||
    (text(candidate?.detail?.status).toLowerCase() === "sold"
      ? "legacy-global-raw-text-match-likely"
      : "unknown")
  );
}

function isDetailSoldParserAuditCandidate(candidate) {
  return Boolean(
    /Detail page says sold while the product remains in the active list range/i.test(
      `${candidate?.lastError || ""} ${candidate?.reviewReason || ""} ${(candidate?.convertedProduct?.inventoryReviewReasons || []).join(" ")}`
    ) ||
      (text(candidate?.detail?.status).toLowerCase() === "sold" &&
        manualDetailHasPrice(candidate) &&
        manualListSaysAvailable(candidate))
  );
}

function detailSoldParserAuditRow(candidate) {
  const soldEvidence = manualSoldEvidence(candidate);
  const availableEvidence = manualAvailableEvidence(candidate);
  return {
    sourceProductId: productId(candidate),
    sourceUrl: text(candidate?.sourceUrl),
    topInventoryStatus: text(candidate?.inventoryStatus),
    detailStatus: text(candidate?.detail?.status),
    parsedPrice: manualDetailPrice(candidate),
    convertedInventoryStatus: text(
      candidate?.convertedProduct?.inventoryStatus
    ),
    reviewReason: text(
      candidate?.lastError ||
        candidate?.reviewReason ||
        (candidate?.convertedProduct?.inventoryReviewReasons || []).join(" | ")
    ),
    soldEvidence,
    availableEvidence,
    rawStatusSource: manualRawStatusSource(candidate),
    whetherPriceExists: manualDetailHasPrice(candidate),
    whetherListSaysAvailable: manualListSaysAvailable(candidate),
  };
}

function shouldRepairDetailSoldFalsePositive(row) {
  const strongSoldEvidence = (row.soldEvidence || []).filter(
    (item) => !String(item).startsWith("weak/")
  );
  return Boolean(
    row.detailStatus === "sold" &&
      row.whetherPriceExists &&
      row.whetherListSaysAvailable &&
      strongSoldEvidence.length === 0
  );
}

export function buildManualFullReconcileDetailSoldParserAuditReport({
  state,
  generatedAt = new Date().toISOString(),
  repairedRows = [],
  mode = "audit",
} = {}) {
  const rows = (state?.candidates || [])
    .filter(isDetailSoldParserAuditCandidate)
    .map(detailSoldParserAuditRow);
  return {
    version:
      "smokingpipes-detail-sold-parser-audit-report-v1",
    source: "smokingpipes",
    mode,
    generatedAt,
    auditedCount: rows.length,
    repairableFalsePositiveCount: rows.filter(
      shouldRepairDetailSoldFalsePositive
    ).length,
    trueOrStrongSoldCount: rows.filter(
      (row) =>
        row.detailStatus === "sold" &&
        !shouldRepairDetailSoldFalsePositive(row)
    ).length,
    repairedCount: repairedRows.length,
    rows,
    repairedRows,
    smokingpipesAccessed: false,
    productionWritten: false,
  };
}

function manualListItemForCandidate(candidate) {
  return {
    sourceProductId: productId(candidate),
    sourceUrl: text(candidate?.sourceUrl),
    title: text(candidate?.listTitle),
    price: text(candidate?.listPrice || manualDetailPrice(candidate)),
    imageUrl: text(candidate?.listPrimaryImage),
    status: manualListSaysAvailable(candidate)
      ? "available"
      : text(candidate?.inventoryStatus),
    inventoryStatus: text(candidate?.inventoryStatus),
  };
}

export function repairManualFullReconcileDetailSoldFalsePositives({
  state,
  now = new Date().toISOString(),
} = {}) {
  const next = structuredClone(state);
  const beforeReport =
    buildManualFullReconcileDetailSoldParserAuditReport({
      state: next,
      generatedAt: now,
      mode: "repair-before",
    });
  const repairedRows = [];
  for (const candidate of next.candidates || []) {
    if (!isDetailSoldParserAuditCandidate(candidate)) continue;
    const beforeRow = detailSoldParserAuditRow(candidate);
    if (!shouldRepairDetailSoldFalsePositive(beforeRow)) continue;
    const repairedDetail = {
      ...(candidate.detail || {}),
      status: "available",
      statusEvidence: {
        status: "available",
        rawStatusSource:
          "repair-available-evidence-overrides-legacy-sold",
        soldEvidence: beforeRow.soldEvidence,
        availableEvidence: beforeRow.availableEvidence,
        warning:
          "sold status has available evidence; treating sold signal as weak.",
      },
      rawStatusSource:
        "repair-available-evidence-overrides-legacy-sold",
    };
    const conversion = convertSmokingpipesCandidateDetails(
      [repairedDetail],
      [manualListItemForCandidate(candidate)]
    );
    const convertedProduct = conversion.products[0] || null;
    if (
      !convertedProduct ||
      convertedProduct.inventoryStatus === "needs-review" ||
      conversion.failures.length
    ) {
      repairedRows.push({
        ...beforeRow,
        repairStatus: "not-repaired",
        repairReason:
          conversion.failures[0]?.reason ||
          "conversion still requires review",
      });
      continue;
    }
    candidate.detail = repairedDetail;
    candidate.convertedProduct = convertedProduct;
    candidate.detailStatus = "complete";
    candidate.queueDisposition = "no-detail-required";
    candidate.reviewReason = null;
    candidate.lastError = null;
    candidate.readyReason = null;
    Object.assign(
      candidate,
      classifyProgressiveCandidatePublicStatus(candidate)
    );
    repairedRows.push({
      ...beforeRow,
      repairStatus: "repaired",
      repairedDetailStatus: candidate.detail.status,
      repairedInventoryStatus:
        candidate.convertedProduct.inventoryStatus,
      repairedPublicStatus: candidate.publicStatus,
      repairedReviewReason: candidate.reviewReason || null,
    });
  }
  next.updatedAt = now;
  next.manualFullReconcile = {
    ...(next.manualFullReconcile || {}),
    mode: "repair-detail-sold-false-positives",
    detailSoldFalsePositiveRepair: {
      repairedAt: now,
      auditedCount: beforeReport.auditedCount,
      repairedCount: repairedRows.filter(
        (row) => row.repairStatus === "repaired"
      ).length,
      smokingpipesAccessed: false,
      productionWritten: false,
    },
    allowProductionApply: false,
    allowDailyTaskResume: false,
  };
  next.productionWritten = false;
  next.summary = buildProgressiveStateSummary(next, now);
  const validation = validateProgressiveDailyState(next);
  if (!validation.valid) {
    throw new Error(
      `Manual detail sold false-positive repair produced invalid state: ${validation.errors.join("; ")}`
    );
  }
  const afterReport =
    buildManualFullReconcileDetailSoldParserAuditReport({
      state: next,
      generatedAt: now,
      repairedRows,
      mode: "repair-after",
    });
  return {
    status: "detail-sold-false-positives-repaired",
    state: next,
    report: {
      ...afterReport,
      beforeAuditedCount: beforeReport.auditedCount,
      beforeRepairableFalsePositiveCount:
        beforeReport.repairableFalsePositiveCount,
      repairedCount: repairedRows.filter(
        (row) => row.repairStatus === "repaired"
      ).length,
      notRepairedCount: repairedRows.filter(
        (row) => row.repairStatus !== "repaired"
      ).length,
    },
    productionWritten: false,
  };
}

function countManualDetailStatus(state, predicate) {
  return (state?.candidates || []).filter(predicate).length;
}

function manualVerificationAction({
  blockedItem,
  browser = {},
}) {
  return blockedItem
    ? {
        object: "Smokingpipes",
        location: "运行任务的电脑",
        browser: "Chrome profile sp-chrome",
        page:
          blockedItem.verificationPageUrl ||
          blockedItem.sourceUrl ||
          "已打开的 Smokingpipes 详情页或列表页",
        nextStep:
          "完成验证后手动重跑 FetchDetailBatch，不要恢复 daily task。",
        requestedBrowserChannel:
          browser.browserChannel || browser.effectiveBrowserChannel || "chrome",
        requestedBrowserProfile:
          browser.browserProfile || "sp-chrome",
      }
    : null;
}

export function buildManualFullReconcileDetailBatchReport({
  state,
  startedAt,
  finishedAt = new Date().toISOString(),
  batchLimit = 30,
  attemptedResults = [],
  smokingpipesAccessed = false,
  productionWritten = false,
  browser = {},
  stateConsistency = null,
  blockers = [],
  nextStep = null,
}) {
  const cappedBatchLimit = Math.min(
    30,
    Math.max(1, Number(batchLimit) || 30)
  );
  const items = attemptedResults.map((item) => ({
    sourceProductId: text(item.sourceProductId),
    sourceUrl: text(item.sourceUrl),
    title: text(item.title || item.listTitle),
    detailStatus: text(item.detailStatus),
    publicStatus: text(item.publicStatus),
    error: text(item.error),
    verificationPageUrl: text(item.verificationPageUrl),
  }));
  const blockedItem = items.find(
    (item) => item.detailStatus === "blocked"
  );
  return {
    version:
      "smokingpipes-manual-full-reconcile-detail-batch-report-v1",
    source: "smokingpipes",
    mode: "fetch-detail-batch",
    startedAt,
    finishedAt,
    batchLimit: cappedBatchLimit,
    attemptedCount: items.length,
    completedCount: items.filter(
      (item) => item.detailStatus === "complete"
    ).length,
    failedCount: items.filter(
      (item) => item.detailStatus === "failed"
    ).length,
    blockedCount: items.filter(
      (item) => item.detailStatus === "blocked"
    ).length,
    remainingPendingCount: countManualDetailStatus(
      state,
      (item) =>
        item.detailStatus === "pending" &&
        item.queueDisposition === "eligible-this-batch"
    ),
    deferredCount: countManualDetailStatus(
      state,
      (item) =>
        item.detailStatus === "deferred" ||
        item.queueDisposition === "queued-later"
    ),
    reviewOnlyCount: countManualDetailStatus(
      state,
      (item) =>
        item.detailStatus === "review-only" ||
        item.publicStatus === "review-only"
    ),
    smokingpipesAccessed: Boolean(smokingpipesAccessed),
    productionWritten: Boolean(productionWritten) && false,
    browser: {
      browserChannel:
        browser.browserChannel ||
        browser.effectiveBrowserChannel ||
        "chrome",
      browserProfile: browser.browserProfile || "sp-chrome",
      profileDir: browser.profileDir || null,
    },
    blockedManualAction: manualVerificationAction({
      blockedItem,
      browser,
    }),
    stateConsistency,
    blockers,
    nextStep,
    items,
  };
}

export async function runSmokingpipesManualFetchDetailBatch({
  state,
  detailMax = 30,
  now = new Date().toISOString(),
  processDetail,
  checkpoint = async () => {},
  networkAccessed = true,
  browser = {
    browserChannel: "chrome",
    browserProfile: "sp-chrome",
  },
  retryDelayMs = 90 * 60 * 1000,
  afterItem = async () => {},
}) {
  if (typeof processDetail !== "function") {
    throw new Error("FetchDetailBatch requires processDetail");
  }
  const consistency =
    buildManualFullReconcileStateConsistencyReport({
      state,
      generatedAt: now,
    });
  if (!consistency.canFetchDetailBatch) {
    const report = buildManualFullReconcileDetailBatchReport({
      state,
      startedAt: now,
      finishedAt: now,
      batchLimit: detailMax,
      attemptedResults: [],
      smokingpipesAccessed: false,
      productionWritten: false,
      browser,
      stateConsistency: consistency,
    });
    return {
      status: "state-inconsistent",
      state,
      report,
      consistency,
      productionWritten: false,
    };
  }
  const validation = validateProgressiveDailyState(state);
  if (!validation.valid) {
    throw Object.assign(
      new Error(
        `Manual FetchDetailBatch blocked by invalid state: ${validation.errors.join("; ")}`
      ),
      {
        code: "MANUAL_RECONCILE_STATE_INVALID",
        errors: validation.errors,
      }
    );
  }
  const cappedDetailMax = Math.min(
    30,
    Math.max(1, Number(detailMax) || 30)
  );
  const next = structuredClone(state);
  const selected = selectManualFullReconcileDetailBatchCandidates({
    state: next,
    detailMax: cappedDetailMax,
  });
  const promoteRequired =
    selected.length === 0 &&
    consistency.counts.pending === 0 &&
    consistency.counts.queuedLater > 0;
  const promoteRequiredMessage =
    "当前没有待抓详情，但仍有 queued-later 商品。请先运行 PromoteNextBatch。";
  const attemptedResults = [];
  let blockedReason = null;
  let recommendedNextRunAt = null;

  for (let index = 0; index < selected.length; index += 1) {
    const selectedItem = selected[index];
    const candidate = next.candidates.find(
      (item) =>
        item.sourceProductId === selectedItem.sourceProductId
    );
    candidate.detailAttempts += 1;
    candidate.lastAttemptAt = now;
    try {
      const result = await processDetail(
        structuredClone(candidate),
        index
      );
      candidate.detail = result.detail || null;
      candidate.convertedProduct =
        result.convertedProduct || null;
      candidate.detailStatus = "complete";
      candidate.queueDisposition = "no-detail-required";
      candidate.lastSuccessfulDetailRunId =
        next.dailyRunId || "manual-full-reconcile";
      candidate.nextEligibleAt = null;
      Object.assign(
        candidate,
        classifyProgressiveCandidatePublicStatus(candidate)
      );
      if (result.reviewOnly === true) {
        candidate.detailStatus = "review-only";
        candidate.queueDisposition = "review-only";
        candidate.publicStatus = "review-only";
        candidate.reviewReason =
          result.reviewReason ||
          "manual detail batch marked product review-only";
        candidate.lastError = candidate.reviewReason;
      }
      attemptedResults.push({
        sourceProductId: candidate.sourceProductId,
        sourceUrl: candidate.sourceUrl,
        title: candidate.listTitle,
        detailStatus:
          candidate.detailStatus === "review-only"
            ? "complete"
            : candidate.detailStatus,
        publicStatus: candidate.publicStatus,
        error: candidate.lastError || null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      candidate.lastError = message;
      if (error?.code === "CAPTCHA_REQUIRED") {
        candidate.detailStatus = "blocked";
        candidate.queueDisposition = "no-detail-required";
        candidate.publicStatus = "not-public";
        candidate.blockedCount += 1;
        candidate.lastBlockedAt = now;
        candidate.lastBlockedReason = message;
        candidate.nextEligibleAt = new Date(
          Date.parse(now) + retryDelayMs
        ).toISOString();
        next.verificationDetected = true;
        next.blockedAt = now;
        next.blockedReason = message;
        blockedReason = message;
        recommendedNextRunAt = candidate.nextEligibleAt;
        attemptedResults.push({
          sourceProductId: candidate.sourceProductId,
          sourceUrl: candidate.sourceUrl,
          title: candidate.listTitle,
          detailStatus: "blocked",
          publicStatus: candidate.publicStatus,
          error: message,
          verificationPageUrl:
            error.verificationPageUrl || candidate.sourceUrl,
        });
        next.updatedAt = new Date().toISOString();
        next.summary = buildProgressiveStateSummary(
          next,
          next.updatedAt
        );
        await checkpoint(next);
        break;
      }
      candidate.detailStatus = "failed";
      candidate.queueDisposition = "no-detail-required";
      candidate.publicStatus = "not-public";
      attemptedResults.push({
        sourceProductId: candidate.sourceProductId,
        sourceUrl: candidate.sourceUrl,
        title: candidate.listTitle,
        detailStatus: "failed",
        publicStatus: candidate.publicStatus,
        error: message,
      });
    }
    next.updatedAt = new Date().toISOString();
    next.summary = buildProgressiveStateSummary(next, next.updatedAt);
    await checkpoint(next);
    await afterItem({
      index,
      selectedCount: selected.length,
      blocked: Boolean(blockedReason),
    });
    if (blockedReason) break;
  }

  next.latestRun = {
    runId: next.dailyRunId,
    mode: "manual-full-reconcile-fetch-detail-batch",
    finishedAt: new Date().toISOString(),
    selected: selected.length,
    attempted: attemptedResults.length,
    completedThisRun: attemptedResults.filter(
      (item) => item.detailStatus === "complete"
    ).length,
    failedThisRun: attemptedResults.filter(
      (item) => item.detailStatus === "failed"
    ).length,
    blockedReason,
    recommendedNextRunAt,
    productionWritten: false,
  };
  next.manualFullReconcile = {
    ...(next.manualFullReconcile || {}),
    mode: "fetch-detail-batch",
    detailBatch: {
      startedAt: now,
      finishedAt: next.latestRun.finishedAt,
      batchLimit: cappedDetailMax,
      attemptedCount: attemptedResults.length,
      completedCount: next.latestRun.completedThisRun,
      failedCount: next.latestRun.failedThisRun,
      blockedCount: attemptedResults.filter(
        (item) => item.detailStatus === "blocked"
      ).length,
      productionWritten: false,
    },
    allowProductionApply: false,
    allowDailyTaskResume: false,
  };
  next.productionWritten = false;
  next.summary = buildProgressiveStateSummary(next, next.updatedAt);
  const report = buildManualFullReconcileDetailBatchReport({
    state: next,
    startedAt: now,
    finishedAt: next.latestRun.finishedAt,
    batchLimit: cappedDetailMax,
    attemptedResults,
    smokingpipesAccessed: networkAccessed,
    productionWritten: false,
    browser,
    stateConsistency:
      buildManualFullReconcileStateConsistencyReport({
        state: next,
        generatedAt: next.latestRun.finishedAt,
      }),
    blockers: promoteRequired
      ? [promoteRequiredMessage]
      : [],
    nextStep: promoteRequired
      ? "Run PromoteNextBatch before FetchDetailBatch."
      : null,
  });
  return {
    status: blockedReason
      ? "blocked"
      : attemptedResults.length
        ? "batch-complete"
        : promoteRequired
          ? "promote-next-batch-required"
          : "no-eligible-candidates",
    state: next,
    report,
    productionWritten: false,
  };
}

function detailBatchMarkdown(report) {
  const items = report.items.length
    ? report.items
        .map(
          (item) =>
            `- ${item.sourceProductId}: ${item.detailStatus} / ${item.publicStatus || "not-public"}${item.error ? ` - ${item.error}` : ""}`
        )
        .join("\n")
    : "- none";
  const blocked = report.blockedManualAction
    ? [
        `- verificationObject: ${report.blockedManualAction.object}`,
        `- verificationLocation: ${report.blockedManualAction.location}`,
        `- 浏览器: ${report.blockedManualAction.browser}`,
        `- verificationPage: ${report.blockedManualAction.page}`,
        `- nextStep: ${report.blockedManualAction.nextStep}`,
      ].join("\n")
    : "- 无";
  const blockers = report.blockers?.length
    ? report.blockers.map((item) => `- ${item}`).join("\n")
    : "- none";
  return `# Smokingpipes Manual Full Reconcile Detail Batch Report

- batchLimit: ${report.batchLimit}
- attemptedCount: ${report.attemptedCount}
- completedCount: ${report.completedCount}
- failedCount: ${report.failedCount}
- blockedCount: ${report.blockedCount}
- remainingPendingCount: ${report.remainingPendingCount}
- deferredCount: ${report.deferredCount}
- reviewOnlyCount: ${report.reviewOnlyCount}
- smokingpipesAccessed: ${report.smokingpipesAccessed}
- productionWritten: ${report.productionWritten}

## Blockers

${blockers}

## Next Step

${report.nextStep || "none"}

## Blocked Manual Action

${blocked}

## Items

${items}
`;
}

function promoteNextBatchMarkdown(report) {
  const blockers = report.blockers.length
    ? report.blockers.map((item) => `- ${item}`).join("\n")
    : "- none";
  const promoted = report.promotedItems.length
    ? report.promotedItems
        .map(
          (item) =>
            `- ${item.sourceProductId}: ${item.title || "(untitled)"} / ${item.listPrice || "price unknown"} / image=${item.hasImage} / brand=${item.hasBrand}`
        )
        .join("\n")
    : "- none";
  return `# Smokingpipes Manual Full Reconcile Promote Next Batch Report

- status: ${report.status}
- generatedAt: ${report.generatedAt}
- batchLimit: ${report.batchLimit}
- promotedCount: ${report.promotedCount}
- remainingQueuedLaterCount: ${report.remainingQueuedLaterCount}
- pendingCountAfter: ${report.pendingCountAfter}
- reviewOnlyCount: ${report.reviewOnlyCount}
- completeCount: ${report.completeCount}
- smokingpipesAccessed: false
- productionWritten: false

## Blockers

${blockers}

## Promoted Source Product IDs

${promoted}
`;
}

function detailSoldParserAuditMarkdown(report) {
  const rows = report.rows.length
    ? report.rows
        .map(
          (item) =>
            `- ${item.sourceProductId}: top=${item.topInventoryStatus || "(empty)"} detail=${item.detailStatus || "(empty)"} price=${item.parsedPrice || "(empty)"} converted=${item.convertedInventoryStatus || "(empty)"} priceExists=${item.whetherPriceExists} listAvailable=${item.whetherListSaysAvailable} source=${item.rawStatusSource}`
        )
        .join("\n")
    : "- none";
  const repaired = report.repairedRows?.length
    ? report.repairedRows
        .map(
          (item) =>
            `- ${item.sourceProductId}: ${item.repairStatus} -> ${item.repairedInventoryStatus || "(unchanged)"} / ${item.repairedPublicStatus || "(unchanged)"}`
        )
        .join("\n")
    : "- none";
  return `# Smokingpipes Detail Sold Parser Audit Report

- mode: ${report.mode}
- generatedAt: ${report.generatedAt}
- auditedCount: ${report.auditedCount}
- repairableFalsePositiveCount: ${report.repairableFalsePositiveCount}
- trueOrStrongSoldCount: ${report.trueOrStrongSoldCount}
- repairedCount: ${report.repairedCount}
- smokingpipesAccessed: false
- productionWritten: false

## Rows

${rows}

## Repaired Rows

${repaired}
`;
}

function stateConsistencyMarkdown(report) {
  const blockers = report.blockers.length
    ? report.blockers.map((item) => `- ${item}`).join("\n")
    : "- none";
  const samples = Object.entries(report.samples || {})
    .map(([name, values]) => {
      const rows = values.length
        ? values
            .map(
              (item) =>
                `  - ${item.sourceProductId}: ${item.queueDisposition} / ${item.detailStatus} / ${item.publicStatus}`
            )
            .join("\n")
        : "  - none";
      return `### ${name}\n\n${rows}`;
    })
    .join("\n\n");
  return `# Smokingpipes Manual Full Reconcile State Inconsistency Report

- status: ${report.status}
- canFetchDetailBatch: ${report.canFetchDetailBatch}
- smokingpipesAccessed: false
- productionWritten: false

## Counts

- eligibleThisBatch: ${report.counts.eligibleThisBatch}
- pending: ${report.counts.pending}
- eligiblePending: ${report.counts.eligiblePending}
- queuedLater: ${report.counts.queuedLater}
- queuedLaterDeferred: ${report.counts.queuedLaterDeferred}
- reviewOnlyDisposition: ${report.counts.reviewOnlyDisposition}
- reviewOnlyStatus: ${report.counts.reviewOnlyStatus}
- reviewOnlyAligned: ${report.counts.reviewOnlyAligned}
- noDetailRequired: ${report.counts.noDetailRequired}
- invalidQueueDisposition: ${report.counts.invalidQueueDisposition}

## Blockers

${blockers}

## Samples

${samples}
`;
}

function stateRepairMarkdown(report) {
  return `# Smokingpipes Manual Full Reconcile State Repair Report

- generatedAt: ${report.generatedAt}
- eligibleRestoredToPending: ${report.eligibleRestoredToPending}
- queuedLaterRestoredToDeferred: ${report.queuedLaterRestoredToDeferred}
- reviewOnlyRestored: ${report.reviewOnlyRestored}
- preservedCompleteDispositionRewritten: ${report.preservedCompleteDispositionRewritten}
- cachedDetailCleared: ${report.cachedDetailCleared}
- smokingpipesAccessed: false
- productionWritten: false

## Before

- status: ${report.before.status}
- eligibleThisBatch: ${report.before.counts.eligibleThisBatch}
- pending: ${report.before.counts.pending}
- eligiblePending: ${report.before.counts.eligiblePending}
- invalidQueueDisposition: ${report.before.counts.invalidQueueDisposition}

## After

- status: ${report.after.status}
- eligibleThisBatch: ${report.after.counts.eligibleThisBatch}
- pending: ${report.after.counts.pending}
- eligiblePending: ${report.after.counts.eligiblePending}
- invalidQueueDisposition: ${report.after.counts.invalidQueueDisposition}
- canFetchDetailBatch: ${report.after.canFetchDetailBatch}
`;
}

async function createManualDetailProcessor({
  detailWarmupMinMs = 1000,
  detailWarmupMaxMs = 3000,
  detailDelayMinMs = 3000,
  detailDelayMaxMs = 8000,
  browserChannel = "chrome",
  browserProfile = "sp-chrome",
  browserProfileDir = null,
  allowManualVerification = true,
  verbose = false,
  runId = null,
}) {
  process.env.SMOKINGPIPES_HEADLESS = allowManualVerification
    ? "false"
    : process.env.SMOKINGPIPES_HEADLESS || "true";
  const session = await launchSmokingpipesContext({
    root: ROOT,
    browserChannel,
    browserProfile,
    browserProfileDir,
    runId,
    mode: "manual-full-reconcile-fetch-detail-batch",
  });
  const page =
    session.context.pages()[0] ||
    (await session.context.newPage());
  return {
    browser: {
      ...session.browser,
      browserChannel,
      browserProfile,
    },
    async process(candidate, index) {
      if (verbose) {
        console.log(
          `manual reconcile detail ${index + 1}: ${candidate.sourceProductId}`
        );
      }
      const response = await page.goto(candidate.sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const warmupMs = randomDelayMs(
        detailWarmupMinMs,
        detailWarmupMaxMs
      );
      if (verbose) {
        console.log(`manual detail warmup delay: ${warmupMs} ms`);
      }
      if (warmupMs > 0) {
        await page.waitForTimeout(warmupMs);
      }
      const detection = await detectSmokingpipesVerification(page, {
        pageKind: "detail",
        httpStatus: response?.status() || 0,
      });
      if (detection.verificationBlocked) {
        throw Object.assign(
          new Error(
            `Smokingpipes strong verification detected at ${candidate.sourceProductId}.`
          ),
          {
            code: "CAPTCHA_REQUIRED",
            verificationPageUrl: page.url() || candidate.sourceUrl,
          }
        );
      }
      const detail = addParsedMeasurements(
        await extractDetailProduct(page, candidate, "new")
      );
      if (
        !isNormalSmokingpipesDetail(
          detail,
          candidate.sourceProductId
        )
      ) {
        throw new Error(
          `detail parse failed for ${candidate.sourceProductId}`
        );
      }
      const conversion = convertSmokingpipesCandidateDetails(
        [detail],
        [
          {
            sourceProductId: candidate.sourceProductId,
            sourceUrl: candidate.sourceUrl,
            title: candidate.listTitle,
            price: candidate.listPrice,
            imageUrl: candidate.listPrimaryImage,
          },
        ]
      );
      const convertedProduct = conversion.products[0] || null;
      if (!convertedProduct || conversion.failures.length) {
        return {
          detail,
          convertedProduct,
          reviewOnly: true,
          reviewReason:
            conversion.failures[0]?.reason ||
            "detail conversion failed",
        };
      }
      return {
        detail,
        convertedProduct,
      };
    },
    async afterItem({ index, selectedCount, blocked }) {
      if (blocked || index + 1 >= selectedCount) return;
      const delayMs = randomDelayMs(
        detailDelayMinMs,
        detailDelayMaxMs
      );
      if (verbose) {
        console.log(`manual detail next delay: ${delayMs} ms`);
      }
      if (delayMs > 0) await page.waitForTimeout(delayMs);
    },
    close: () => session.close(),
  };
}

function planMarkdown(plan) {
  return `# Smokingpipes Manual Full Reconcile V1 Plan

## 结论

- 模式: PlanOnly
- 快照可信: ${plan.snapshot.trusted}
- 网络访问: false
- 详情抓取: false
- production 写入: false
- 可恢复 daily task: false

## Snapshot

- current-list: ${plan.snapshot.totalProducts}
- unique: ${plan.snapshot.uniqueProducts}
- pages: ${plan.snapshot.pagesScanned}/${plan.snapshot.expectedPages}
- production: ${plan.production.totalProducts}

## Diff

- new-product: ${plan.diffCounts.newProduct}
- price-change: ${plan.diffCounts.priceChange}
- explicit-out-of-stock: ${plan.diffCounts.explicitOutOfStock}
- reappeared: ${plan.diffCounts.reappeared}
- disappeared: ${plan.diffCounts.disappeared}
- no-op: ${plan.diffCounts.noOp}
- unknown: ${plan.diffCounts.unknown}

## New Product Triage

- eligibleForDetail: ${plan.newProduct.eligibleForDetail}
- lowPriority: ${plan.newProduct.lowPriority}
- missingPrice: ${plan.newProduct.missingPrice}
- missingImage: ${plan.newProduct.missingImage}
- brandNeedsReview: ${plan.newProduct.brandNeedsReview}
- suspectedDuplicate: ${plan.newProduct.suspectedDuplicate}
- reviewOnly: ${plan.newProduct.reviewOnly}
- preservedComplete: ${plan.newProduct.preservedComplete}

## Price Change Triage

- likelyPromotion: ${plan.priceChange.likelyPromotion}
- realPriceChange: ${plan.priceChange.realPriceChange}
- noOpAlreadyCurrent: ${plan.priceChange.noOpAlreadyCurrent}
- dominantRatio: ${plan.priceChange.dominantRatio ?? "none"}

## Disappeared

- disappearedApplyDisabled: ${plan.disappeared.disappearedApplyDisabled}
- needsManualReview: ${plan.disappeared.needsManualReview}

## Detail Queue

- totalPending: ${plan.detailQueue.totalPending}
- eligibleThisBatch: ${plan.detailQueue.eligibleThisBatch}
- deferred: ${plan.detailQueue.deferred}
- blocked: ${plan.detailQueue.blocked}
- allowDetailFetch: ${plan.gates.allowDetailFetch}
- allowProductionApply: ${plan.gates.allowProductionApply}
- allowDailyTaskResume: ${plan.gates.allowDailyTaskResume}

## Previous Pending Triage

- total: ${plan.previousPendingTriage.total}
- firstBatch: ${plan.previousPendingTriage.firstBatch}
- deferred: ${plan.previousPendingTriage.deferred}
- reviewOnly: ${plan.previousPendingTriage.reviewOnly}
- preservedComplete: ${plan.previousPendingTriage.preservedComplete}
- noLongerNewOrMissing: ${plan.previousPendingTriage.noLongerNewOrMissing}
- accountedFor: ${plan.previousPendingTriage.accountedFor}

## 第一批 Detail 建议（最多 30）

${plan.firstDetailBatchSourceProductIds.length ? plan.firstDetailBatchSourceProductIds.map((id) => `- ${id}`).join("\n") : "- none"}

## Warnings

${plan.warnings.length ? plan.warnings.map((item) => `- ${item}`).join("\n") : "- none"}
`;
}

function rebuildMarkdown(report) {
  return `# Smokingpipes Progressive State Rebuild Report

- generatedAt: ${report.generatedAt}
- previousCandidates: ${report.previousCandidates}
- rebuiltCandidates: ${report.rebuiltCandidates}
- preservedComplete: ${report.preservedComplete}
- pending: ${report.pending}
- deferred: ${report.deferred}
- reviewOnly: ${report.reviewOnly}
- noDetailRequired: ${report.noDetailRequired}
- disappearedRecorded: ${report.disappearedRecorded}
- disappearedApplyAllowed: false
- staleSummaryCleared: ${report.staleSummaryCleared}
- productionWritten: false
- dailyTaskResumeAllowed: false
- validation: ${report.stateValidation.status}
`;
}

function parseArguments(argv) {
  const args = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    args.set(key, rest.length ? rest.join("=") : "true");
  }
  const booleanValue = (value, fallback = false) => {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    return /^(1|true|yes|y)$/i.test(String(value));
  };
  const detailMax = Math.min(
    30,
    Math.max(1, Number(args.get("detail-max")) || 30)
  );
  return {
    mode: text(args.get("mode") || "plan-only").toLowerCase(),
    detailMax,
    stateBackupPath: args.get("state-backup")
      ? path.resolve(args.get("state-backup"))
      : null,
    browserChannel: text(args.get("browser-channel") || "chrome"),
    browserProfile: text(args.get("browser-profile") || "sp-chrome"),
    browserProfileDir: args.get("browser-profile-dir")
      ? path.resolve(args.get("browser-profile-dir"))
      : null,
    allowManualVerification: booleanValue(
      args.get("allow-manual-verification"),
      true
    ),
    verbose: booleanValue(args.get("verbose"), false),
    detailWarmupMinMs: Math.max(
      0,
      Number(args.get("detail-warmup-min-ms") || 1000)
    ),
    detailWarmupMaxMs: Math.max(
      0,
      Number(args.get("detail-warmup-max-ms") || 3000)
    ),
    detailDelayMinMs: Math.max(
      0,
      Number(args.get("detail-delay-min-ms") || 3000)
    ),
    detailDelayMaxMs: Math.max(
      0,
      Number(args.get("detail-delay-max-ms") || 8000)
    ),
  };
}

async function writePlan(plan) {
  await writeJsonAtomic(DEFAULT_PATHS.planJson, plan);
  await writeTextAtomic(
    DEFAULT_PATHS.planMarkdown,
    `\ufeff${planMarkdown(plan)}`
  );
}

async function writeDetailBatchReport(report) {
  await writeJsonAtomic(DEFAULT_PATHS.detailBatchJson, report);
  await writeTextAtomic(
    DEFAULT_PATHS.detailBatchMarkdown,
    `\ufeff${detailBatchMarkdown(report)}`
  );
}

async function writePromoteNextBatchReport(report) {
  await writeJsonAtomic(DEFAULT_PATHS.promoteNextBatchJson, report);
  await writeTextAtomic(
    DEFAULT_PATHS.promoteNextBatchMarkdown,
    `\ufeff${promoteNextBatchMarkdown(report)}`
  );
}

async function writeDetailSoldParserAuditReport(report) {
  await writeJsonAtomic(DEFAULT_PATHS.detailSoldParserAuditJson, report);
  await writeTextAtomic(
    DEFAULT_PATHS.detailSoldParserAuditMarkdown,
    `\ufeff${detailSoldParserAuditMarkdown(report)}`
  );
}

async function writeStateConsistencyReport(report) {
  await writeJsonAtomic(DEFAULT_PATHS.stateInconsistencyJson, report);
  await writeTextAtomic(
    DEFAULT_PATHS.stateInconsistencyMarkdown,
    `\ufeff${stateConsistencyMarkdown(report)}`
  );
}

async function writeStateRepairReport(report) {
  await writeJsonAtomic(DEFAULT_PATHS.stateRepairJson, report);
  await writeTextAtomic(
    DEFAULT_PATHS.stateRepairMarkdown,
    `\ufeff${stateRepairMarkdown(report)}`
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (
    ![
      "plan-only",
      "rebuild-state",
      "fetch-detail-batch",
      "repair-state",
      "promote-next-batch",
      "repair-detail-sold-false-positives",
    ].includes(
      options.mode
    )
  ) {
    throw new Error(
      `Unsupported offline manual reconcile mode: ${options.mode}`
    );
  }
  if (options.mode === "promote-next-batch") {
    if (!fs.existsSync(DEFAULT_PATHS.state)) {
      throw new Error(
        `Manual PromoteNextBatch requires an existing state: ${DEFAULT_PATHS.state}`
      );
    }
    const result = promoteManualFullReconcileNextBatch({
      state: readJson(DEFAULT_PATHS.state),
      detailMax: options.detailMax,
    });
    if (result.status === "state-inconsistent") {
      await writeStateConsistencyReport(result.consistency);
      await writePromoteNextBatchReport(result.report);
      console.log(
        JSON.stringify(
          {
            status: result.status,
            mode: options.mode,
            blockers: result.report.blockers,
            counts: result.consistency.counts,
            smokingpipesAccessed: false,
            productionWritten: false,
            promoteReportJson: path.relative(
              ROOT,
              DEFAULT_PATHS.promoteNextBatchJson
            ),
            inconsistencyReportJson: path.relative(
              ROOT,
              DEFAULT_PATHS.stateInconsistencyJson
            ),
          },
          null,
          2
        )
      );
      return;
    }
    await writeProgressiveDailyState(
      DEFAULT_PATHS.state,
      result.state
    );
    await writePromoteNextBatchReport(result.report);
    console.log(
      JSON.stringify(
        {
          status: result.status,
          mode: options.mode,
          batchLimit: result.report.batchLimit,
          promotedCount: result.report.promotedCount,
          remainingQueuedLaterCount:
            result.report.remainingQueuedLaterCount,
          pendingCountAfter: result.report.pendingCountAfter,
          reviewOnlyCount: result.report.reviewOnlyCount,
          completeCount: result.report.completeCount,
          smokingpipesAccessed: false,
          productionWritten: false,
          promoteReportJson: path.relative(
            ROOT,
            DEFAULT_PATHS.promoteNextBatchJson
          ),
        },
        null,
        2
      )
    );
    return;
  }
  if (options.mode === "repair-detail-sold-false-positives") {
    if (!fs.existsSync(DEFAULT_PATHS.state)) {
      throw new Error(
        `Manual RepairDetailSoldFalsePositives requires an existing state: ${DEFAULT_PATHS.state}`
      );
    }
    const result =
      repairManualFullReconcileDetailSoldFalsePositives({
        state: readJson(DEFAULT_PATHS.state),
      });
    await writeProgressiveDailyState(
      DEFAULT_PATHS.state,
      result.state
    );
    await writeDetailSoldParserAuditReport(result.report);
    console.log(
      JSON.stringify(
        {
          status: result.status,
          mode: options.mode,
          auditedCount: result.report.beforeAuditedCount,
          repairableFalsePositiveCount:
            result.report.beforeRepairableFalsePositiveCount,
          repairedCount: result.report.repairedCount,
          notRepairedCount: result.report.notRepairedCount,
          remainingAuditedCount: result.report.auditedCount,
          trueOrStrongSoldCount: result.report.trueOrStrongSoldCount,
          smokingpipesAccessed: false,
          productionWritten: false,
          auditReportJson: path.relative(
            ROOT,
            DEFAULT_PATHS.detailSoldParserAuditJson
          ),
        },
        null,
        2
      )
    );
    return;
  }
  if (options.mode === "repair-state") {
    if (!fs.existsSync(DEFAULT_PATHS.state)) {
      throw new Error(
        `Manual RepairState requires an existing state: ${DEFAULT_PATHS.state}`
      );
    }
    const repaired = repairManualFullReconcileState({
      state: readJson(DEFAULT_PATHS.state),
    });
    const validation = validateProgressiveDailyState(
      repaired.state
    );
    if (!validation.valid) {
      throw new Error(
        `Manual RepairState produced invalid state: ${validation.errors.join("; ")}`
      );
    }
    await writeProgressiveDailyState(
      DEFAULT_PATHS.state,
      repaired.state
    );
    await writeStateRepairReport(repaired.report);
    await writeStateConsistencyReport(repaired.report.after);
    console.log(
      JSON.stringify(
        {
          status: "state-repaired",
          mode: options.mode,
          before: repaired.report.before.counts,
          after: repaired.report.after.counts,
          canFetchDetailBatch:
            repaired.report.after.canFetchDetailBatch,
          eligibleRestoredToPending:
            repaired.report.eligibleRestoredToPending,
          smokingpipesAccessed: false,
          productionWritten: false,
          repairReportJson: path.relative(
            ROOT,
            DEFAULT_PATHS.stateRepairJson
          ),
        },
        null,
        2
      )
    );
    return;
  }
  if (options.mode === "fetch-detail-batch") {
    const rawState = readJson(DEFAULT_PATHS.state);
    const consistency =
      buildManualFullReconcileStateConsistencyReport({
        state: rawState,
      });
    if (!consistency.canFetchDetailBatch) {
      const result = await runSmokingpipesManualFetchDetailBatch({
        state: rawState,
        detailMax: options.detailMax,
        networkAccessed: false,
        browser: {
          browserChannel: options.browserChannel,
          browserProfile: options.browserProfile,
        },
        processDetail: async () => {
          throw new Error("state inconsistent");
        },
      });
      await writeStateConsistencyReport(consistency);
      await writeDetailBatchReport(result.report);
      console.log(
        JSON.stringify(
          {
            status: "state-inconsistent",
            mode: options.mode,
            blockers: consistency.blockers,
            counts: consistency.counts,
            smokingpipesAccessed: false,
            productionWritten: false,
            inconsistencyReportJson: path.relative(
              ROOT,
              DEFAULT_PATHS.stateInconsistencyJson
            ),
          },
          null,
          2
        )
      );
      return;
    }
    const validation = validateProgressiveDailyState(rawState);
    if (!validation.valid) {
      throw new Error(
        `Manual FetchDetailBatch blocked by state validation: ${validation.errors.join("; ")}`
      );
    }
    const selected = selectManualFullReconcileDetailBatchCandidates({
      state: rawState,
      detailMax: options.detailMax,
    });
    if (!selected.length) {
      const result = await runSmokingpipesManualFetchDetailBatch({
        state: rawState,
        detailMax: options.detailMax,
        networkAccessed: false,
        browser: {
          browserChannel: options.browserChannel,
          browserProfile: options.browserProfile,
        },
        processDetail: async () => {
          throw new Error("no eligible candidates");
        },
      });
      await writeProgressiveDailyState(
        DEFAULT_PATHS.state,
        result.state
      );
      await writeDetailBatchReport(result.report);
      console.log(
        JSON.stringify(
          {
            status: result.status,
            mode: options.mode,
            batchLimit: result.report.batchLimit,
            attemptedCount: 0,
            completedCount: 0,
            failedCount: 0,
            blockedCount: 0,
            remainingPendingCount:
              result.report.remainingPendingCount,
            deferredCount: result.report.deferredCount,
            reviewOnlyCount: result.report.reviewOnlyCount,
            smokingpipesAccessed: false,
            productionWritten: false,
            reportJson: path.relative(
              ROOT,
              DEFAULT_PATHS.detailBatchJson
            ),
          },
          null,
          2
        )
      );
      return;
    }
    const runId = `manual-detail-${new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14)}`;
    const processor = await createManualDetailProcessor({
      detailWarmupMinMs: options.detailWarmupMinMs,
      detailWarmupMaxMs: options.detailWarmupMaxMs,
      detailDelayMinMs: options.detailDelayMinMs,
      detailDelayMaxMs: options.detailDelayMaxMs,
      browserChannel: options.browserChannel,
      browserProfile: options.browserProfile,
      browserProfileDir: options.browserProfileDir,
      allowManualVerification: options.allowManualVerification,
      verbose: options.verbose,
      runId,
    });
    let result;
    try {
      result = await runSmokingpipesManualFetchDetailBatch({
        state: rawState,
        detailMax: options.detailMax,
        networkAccessed: true,
        browser: processor.browser,
        processDetail: processor.process,
        afterItem: processor.afterItem,
        checkpoint: async (state) => {
          await writeProgressiveDailyState(
            DEFAULT_PATHS.state,
            state
          );
        },
      });
    } finally {
      await processor.close();
    }
    await writeProgressiveDailyState(
      DEFAULT_PATHS.state,
      result.state
    );
    await writeDetailBatchReport(result.report);
    console.log(
      JSON.stringify(
        {
          status: result.status,
          mode: options.mode,
          batchLimit: result.report.batchLimit,
          attemptedCount: result.report.attemptedCount,
          completedCount: result.report.completedCount,
          failedCount: result.report.failedCount,
          blockedCount: result.report.blockedCount,
          remainingPendingCount:
            result.report.remainingPendingCount,
          deferredCount: result.report.deferredCount,
          reviewOnlyCount: result.report.reviewOnlyCount,
          smokingpipesAccessed: true,
          productionWritten: false,
          reportJson: path.relative(
            ROOT,
            DEFAULT_PATHS.detailBatchJson
          ),
        },
        null,
        2
      )
    );
    return;
  }
  const currentList = readJson(DEFAULT_PATHS.currentList);
  const diff = readJson(DEFAULT_PATHS.diff);
  const productionProducts = readJson(DEFAULT_PATHS.production);
  const previousState = readJsonIfExists(
    DEFAULT_PATHS.state,
    createProgressiveDailyState()
  );
  const plan = buildSmokingpipesManualFullReconcilePlan({
    currentList,
    diff,
    productionProducts,
    previousState,
    detailMax: options.detailMax,
  });
  await writePlan(plan);

  let rebuildReport = null;
  if (options.mode === "rebuild-state") {
    if (
      !options.stateBackupPath ||
      !fs.existsSync(options.stateBackupPath)
    ) {
      throw new Error(
        "RebuildState requires an existing --state-backup path"
      );
    }
    if (
      fs.existsSync(DEFAULT_PATHS.state) &&
      hashFile(DEFAULT_PATHS.state) !==
        hashFile(options.stateBackupPath)
    ) {
      throw new Error(
        "State backup hash does not match the current state"
      );
    }
    const rebuilt = rebuildSmokingpipesProgressiveState({
      plan,
      currentList,
      productionProducts,
      previousState,
    });
    await writeProgressiveDailyState(
      DEFAULT_PATHS.state,
      rebuilt.state
    );
    rebuildReport = {
      ...rebuilt.report,
      stateBackupPath: path.relative(
        ROOT,
        options.stateBackupPath
      ),
      statePath: path.relative(ROOT, DEFAULT_PATHS.state),
    };
    await writeJsonAtomic(
      DEFAULT_PATHS.rebuildJson,
      rebuildReport
    );
    await writeTextAtomic(
      DEFAULT_PATHS.rebuildMarkdown,
      `\ufeff${rebuildMarkdown(rebuildReport)}`
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          options.mode === "rebuild-state"
            ? "state-rebuilt"
            : "plan-ready",
        mode: options.mode,
        snapshotTrusted: plan.snapshot.trusted,
        newProductCandidates: plan.diffCounts.newProduct,
        detailPendingTotal: plan.detailQueue.totalPending,
        detailEligibleThisBatch:
          plan.detailQueue.eligibleThisBatch,
        detailDeferred: plan.detailQueue.deferred,
        reviewOnly: plan.newProduct.reviewOnly,
        allowDetailFetch: plan.gates.allowDetailFetch,
        allowProductionApply: false,
        allowDailyTaskResume: false,
        networkAccessed: false,
        detailsFetched: false,
        productionWritten: false,
        planJson: path.relative(ROOT, DEFAULT_PATHS.planJson),
        rebuildReport,
      },
      null,
      2
    )
  );
}

const directExecution =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    import.meta.url;

if (directExecution) {
  await main();
}
