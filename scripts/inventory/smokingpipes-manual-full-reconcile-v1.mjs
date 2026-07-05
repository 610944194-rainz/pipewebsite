import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  createProgressiveDailyState,
  validateProgressiveDailyState,
  writeProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  buildProgressiveStateSummary,
} from "./smokingpipes-progressive-daily-v1.mjs";

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
        ? "preserved-complete"
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
      item.queueDisposition === "preserved-complete"
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
      classification.queueDisposition ===
      "preserved-complete"
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
          "preserved-complete";
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
  };
}

async function writePlan(plan) {
  await writeJsonAtomic(DEFAULT_PATHS.planJson, plan);
  await writeTextAtomic(
    DEFAULT_PATHS.planMarkdown,
    `\ufeff${planMarkdown(plan)}`
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!["plan-only", "rebuild-state"].includes(options.mode)) {
    throw new Error(
      `Unsupported offline manual reconcile mode: ${options.mode}`
    );
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
