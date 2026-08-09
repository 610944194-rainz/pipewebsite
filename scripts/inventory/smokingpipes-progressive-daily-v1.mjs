import {
  validateProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  evaluateSmokingpipesPublicReadiness,
} from "../lib/smokingpipes-public-readiness-v1.mjs";
import {
  classifySmokingpipesBrandExclusion,
  isSmokingpipesExcludedBrand,
} from "../lib/smokingpipes-brand-exclusions-v1.mjs";
import {
  isExplicitSmokingpipesOutOfStock,
} from "./smokingpipes-diff-inventory-v1.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function productId(item) {
  return text(item?.sourceProductId);
}

function numericPrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const parsed = Number.parseFloat(
    text(value).replace(/[^0-9.]/g, "")
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function productionPrice(product) {
  return (
    numericPrice(product?.price?.current?.amount) ||
    numericPrice(product?.price?.current?.rawText) ||
    numericPrice(product?.price?.listPrice?.amount)
  );
}

function isSold(product) {
  return ["sold", "unavailable", "out-of-stock"].includes(
    text(product?.inventoryStatus).toLowerCase()
  );
}

export function classifySmokingpipesListNotPublic({
  item,
  firstOutOfStockOnlyPage = null,
} = {}) {
  const missingPrice =
    item?.missingPrice === true || !numericPrice(item?.price);
  const explicitOutOfStock = isExplicitSmokingpipesOutOfStock(item);
  const listPage = Number(item?.listPage);
  const tailStartPage = Number(firstOutOfStockOnlyPage);
  const inOutOfStockTail =
    missingPrice &&
    Number.isFinite(listPage) &&
    Number.isFinite(tailStartPage) &&
    tailStartPage > 0 &&
    listPage >= tailStartPage;
  const reason =
    explicitOutOfStock || inOutOfStockTail
      ? "list-not-public:oos-tail"
      : missingPrice
        ? "list-not-public:missing-price"
        : null;
  return {
    excluded: Boolean(reason),
    reason,
    missingPrice,
    explicitOutOfStock,
    inOutOfStockTail,
    listPage: Number.isFinite(listPage) ? listPage : null,
    firstOutOfStockOnlyPage:
      Number.isFinite(tailStartPage) && tailStartPage > 0
        ? tailStartPage
        : null,
  };
}

function productImage(product) {
  return text(
    product?.imageUrl ||
      product?.mainImageUrl ||
      product?.detailImageUrl ||
      product?.galleryImages?.find((item) => text(item))
  );
}

function productListingEligible(product) {
  if (typeof product?.publication?.listingEligible === "boolean") {
    return product.publication.listingEligible;
  }
  if (typeof product?.listingEligible === "boolean") {
    return product.listingEligible;
  }
  return null;
}

function productReviewReasons(product) {
  return Array.isArray(product?.inventoryReviewReasons)
    ? product.inventoryReviewReasons.map(text).filter(Boolean)
    : [];
}

function publicReason(value) {
  return text(value) || "Progressive public readiness rule blocked this product.";
}

export function classifyProgressiveCandidatePublicStatus(candidate) {
  const product = candidate?.convertedProduct;
  if (!product) {
    return {
      publicStatus: "not-public",
      readyReason: null,
      reviewReason: null,
      lastError: candidate?.lastError || null,
    };
  }

  const inventoryStatus = text(product.inventoryStatus).toLowerCase();
  const inventoryConfidence = text(product.inventoryConfidence).toLowerCase();
  const reviewReasons = productReviewReasons(product);
  const listingEligible = productListingEligible(product);
  const priceAmount = numericPrice(product?.price?.current?.amount);
  const image = productImage(product);

  if (
    inventoryStatus === "needs-review" ||
    inventoryConfidence === "conflicting-signals" ||
    reviewReasons.length > 0
  ) {
    const detailSoldActiveListConflict = reviewReasons.find((reason) =>
      /detail page says sold while the product remains in the active list range/i.test(
        reason
      )
    );
    const reviewReason = detailSoldActiveListConflict
      ? `inventory conflict: ${detailSoldActiveListConflict}`
      : `inventory review required: ${reviewReasons.join(" | ") || inventoryStatus || inventoryConfidence}`;
    return {
      publicStatus: "review-only",
      readyReason: null,
      reviewReason,
      lastError: reviewReason,
    };
  }

  if (listingEligible === false) {
    const reviewReason = publicReason(
      product?.publication?.reason ||
        "listingEligible=false blocks public listing"
    );
    return {
      publicStatus: "review-only",
      readyReason: null,
      reviewReason,
      lastError: reviewReason,
    };
  }

  if (inventoryStatus !== "available") {
    const reviewReason = `inventoryStatus=${inventoryStatus || "(missing)"} is not available`;
    return {
      publicStatus: "review-only",
      readyReason: null,
      reviewReason,
      lastError: reviewReason,
    };
  }

  if (!priceAmount) {
    const reviewReason = "valid positive current price is missing";
    return {
      publicStatus: "review-only",
      readyReason: null,
      reviewReason,
      lastError: reviewReason,
    };
  }

  if (!image) {
    const reviewReason = "main image is missing";
    return {
      publicStatus: "review-only",
      readyReason: null,
      reviewReason,
      lastError: reviewReason,
    };
  }

  const sharedReadiness =
    evaluateSmokingpipesPublicReadiness(product);
  if (sharedReadiness.publicIndexEligible !== true) {
    const reviewReason = publicReason(sharedReadiness.reason);
    return {
      publicStatus: "review-only",
      readyReason: null,
      reviewReason,
      lastError: reviewReason,
    };
  }

  return {
    publicStatus: "ready",
    readyReason:
      "listingEligible=true; inventoryStatus=available; valid price present; image present",
    reviewReason: null,
    lastError: null,
  };
}

export function normalizeProgressivePublicStatuses(state) {
  const next = structuredClone(state);
  let changed = false;
  for (const candidate of next?.candidates || []) {
    if (
      candidate.detailStatus !== "complete" ||
      !candidate.convertedProduct
    ) {
      continue;
    }
    const classification =
      classifyProgressiveCandidatePublicStatus(candidate);
    for (const [key, value] of Object.entries(classification)) {
      if (candidate[key] !== value) {
        candidate[key] = value;
        changed = true;
      }
    }
  }
  if (changed) {
    next.updatedAt = new Date().toISOString();
    next.summary = stateSummary(next, next.updatedAt);
  }
  return { state: next, changed };
}

function addUnique(values, additions) {
  return [...new Set([...(values || []), ...additions])];
}

function trustedSnapshotId(currentPayload, summary) {
  return text(
    currentPayload?.snapshotId ||
      currentPayload?.generatedAt ||
      summary?.snapshotId ||
      summary?.generatedAt ||
      summary?.completedAt
  );
}

function normalizeDisappearanceTracking(globalReconcile = {}) {
  const tracking = globalReconcile.disappearanceTracking;
  if (
    tracking &&
    tracking.version === 1 &&
    tracking.items &&
    typeof tracking.items === "object" &&
    !Array.isArray(tracking.items)
  ) {
    return structuredClone(tracking);
  }
  return {
    version: 1,
    initializedAt: null,
    lastTrustedSnapshotId: null,
    items: {},
  };
}

function makeConfirmedDisappearedCandidate({ production, runId, now }) {
  const id = productId(production);
  return {
    sourceProductId: id,
    sourceUrl: text(production.sourceUrl || production.url),
    listTitle: text(production.title || production.name),
    listPrice: "",
    listPrimaryImage: text(production.mainImageUrl || production.imageUrl),
    listPage: null,
    rawListStatus: "",
    listMissingPrice: false,
    listExplicitOutOfStock: false,
    listOutOfStockTail: false,
    listNotPublicReason: null,
    inventoryStatus: "sold",
    discoveredAt: now,
    firstSeenRunId: runId,
    lastSeenRunId: runId,
    lastSeenAt: now,
    changeTypes: ["confirmed-disappeared"],
    detailStatus: "complete",
    publicStatus: "ready",
    detailAttempts: 0,
    retryCount: 0,
    lastAttemptAt: null,
    lastSuccessfulDetailRunId: null,
    lastAppliedAt: null,
    appliedInCommit: null,
    lastError: null,
    reason: "confirmed after two trusted complete list scans",
    reviewReason: null,
    priority: 50,
    blockedCount: 0,
    lastBlockedAt: null,
    lastBlockedReason: null,
    nextEligibleAt: null,
    detail: null,
    convertedProduct: null,
    productionProductId: production?.id || null,
    lastBuiltAt: null,
    excludedBrand: null,
    exclusionReason: null,
    exclusionEvidence: null,
    excludedAt: null,
  };
}

function updateDisappearanceTracking({
  previousGlobalReconcile,
  productionById,
  currentIds,
  currentPayload,
  summary,
  globalAllowed,
  diffAllowApply,
  currentListFresh = true,
  runId,
  now,
}) {
  const tracking = normalizeDisappearanceTracking(previousGlobalReconcile);
  const snapshotId = trustedSnapshotId(currentPayload, summary);
  const trustedFreshSnapshot =
    globalAllowed &&
    diffAllowApply === true &&
    currentListFresh === true &&
    Boolean(snapshotId) &&
    snapshotId !== tracking.lastTrustedSnapshotId &&
    currentPayload?.manualRecovery !== true &&
    summary?.manualRecovery !== true &&
    summary?.cachedListResume !== true &&
    summary?.reused !== true;
  const confirmedIds = [];
  if (!trustedFreshSnapshot) {
    return { tracking, confirmedIds, trustedFreshSnapshot: false };
  }
  const missingAvailableIds = [...productionById.entries()]
    .filter(([id, product]) => !currentIds.has(id) && !isSold(product))
    .map(([id]) => id);
  for (const id of Object.keys(tracking.items)) {
    if (currentIds.has(id)) delete tracking.items[id];
  }
  for (const id of missingAvailableIds) {
    const previous = tracking.items[id];
    const consecutiveTrustedMissingScans = Number(
      previous?.consecutiveTrustedMissingScans || 0
    ) + 1;
    tracking.items[id] = {
      disappearanceStatus:
        consecutiveTrustedMissingScans >= 2
          ? "confirmed-disappeared"
          : "pending-confirmation",
      consecutiveTrustedMissingScans,
      firstMissingAt: previous?.firstMissingAt || now,
      lastMissingAt: now,
      firstMissingRunId: previous?.firstMissingRunId || runId,
      lastMissingRunId: runId,
      lastMissingSnapshotId: snapshotId,
    };
    if (consecutiveTrustedMissingScans === 2) confirmedIds.push(id);
  }
  tracking.initializedAt ||= now;
  tracking.lastTrustedSnapshotId = snapshotId;
  return { tracking, confirmedIds, trustedFreshSnapshot: true };
}

function stateSummary(state, now = new Date().toISOString()) {
  const candidates = state?.candidates || [];
  const changeCount = (changeType) =>
    candidates.filter((item) =>
      item.changeTypes.includes(changeType)
    ).length;
  const statusCount = (status) =>
    candidates.filter((item) => item.detailStatus === status)
      .length;
  const nowMs = Date.parse(now);
  const readyForDetailChunk = candidates.filter((item) => {
    if (!item.changeTypes.includes("new-product")) return false;
    if (
      ["complete", "failed", "review-only"].includes(
        item.detailStatus
      ) ||
      ["published", "review-only"].includes(item.publicStatus)
    ) {
      return false;
    }
    if (item.detailStatus === "blocked") {
      return (
        item.nextEligibleAt &&
        Date.parse(item.nextEligibleAt) <= nowMs
      );
    }
    return item.detailStatus === "pending";
  }).length;
  return {
    totalCandidates: candidates.length,
    newProductCandidates: changeCount("new-product"),
    priceChangeCandidates: changeCount("price-change"),
    explicitOutOfStockCandidates: changeCount(
      "explicit-out-of-stock"
    ),
    reappearedCandidates: changeCount("reappeared"),
    confirmedDisappearedCandidates: changeCount("confirmed-disappeared"),
    disappearedCandidatesRecorded:
      state?.globalReconcile?.disappearedIds?.length || 0,
    disappearedCandidatesApplyAllowed: false,
    confirmedDisappearedCandidatesApplyAllowed: true,
    disappearedPendingConfirmationCount: Object.values(
      state?.globalReconcile?.disappearanceTracking?.items || {}
    ).filter((item) => item?.disappearanceStatus === "pending-confirmation")
      .length,
    pending: statusCount("pending"),
    deferred: statusCount("deferred"),
    complete: statusCount("complete"),
    failed: statusCount("failed"),
    blocked: statusCount("blocked"),
    excluded: statusCount("excluded"),
    listNotPublicFiltered: statusCount(
      "excluded-list-not-public"
    ),
    readyForDetailChunk,
  };
}

function makeCandidate({
  current,
  production,
  changeTypes,
  runId,
  now,
  firstOutOfStockOnlyPage,
}) {
  const needsDetail = changeTypes.includes("new-product");
  const exclusion = classifySmokingpipesBrandExclusion(current);
  const listNotPublic = classifySmokingpipesListNotPublic({
    item: current,
    firstOutOfStockOnlyPage,
  });
  const listNotPublicExcluded =
    needsDetail && listNotPublic.excluded;
  return {
    sourceProductId: productId(current),
    sourceUrl: text(current.sourceUrl || current.href),
    listTitle: text(current.title || current.rawTitle),
    listPrice: text(current.price),
    listPrimaryImage: text(
      current.mainImage ||
        current.mainImageUrl ||
        current.imageUrl
    ),
    listPage: listNotPublic.listPage,
    rawListStatus: text(current.rawListStatus),
    listMissingPrice: listNotPublic.missingPrice,
    listExplicitOutOfStock:
      listNotPublic.explicitOutOfStock,
    listOutOfStockTail:
      listNotPublic.inOutOfStockTail,
    listNotPublicReason: listNotPublicExcluded
      ? listNotPublic.reason
      : null,
    inventoryStatus: isExplicitSmokingpipesOutOfStock(current)
      ? "sold"
      : "available",
    discoveredAt: now,
    firstSeenRunId: runId,
    lastSeenRunId: runId,
    lastSeenAt: now,
    changeTypes,
    detailStatus: exclusion.excluded
      ? "excluded"
      : listNotPublicExcluded
        ? "excluded-list-not-public"
        : needsDetail
          ? "pending"
          : "complete",
    publicStatus: exclusion.excluded
      ? "not-public"
      : needsDetail
        ? "not-public"
        : "ready",
    detailAttempts: 0,
    retryCount: 0,
    lastAttemptAt: null,
    lastSuccessfulDetailRunId: null,
    lastAppliedAt: null,
    appliedInCommit: null,
    lastError: listNotPublicExcluded
      ? listNotPublic.reason
      : null,
    reason: listNotPublicExcluded
      ? listNotPublic.reason
      : null,
    reviewReason: listNotPublicExcluded
      ? listNotPublic.reason
      : null,
    priority: needsDetail ? 100 : 50,
    blockedCount: 0,
    lastBlockedAt: null,
    lastBlockedReason: null,
    nextEligibleAt: null,
    detail: null,
    convertedProduct: null,
    productionProductId: production?.id || null,
    lastBuiltAt: null,
    excludedBrand: exclusion.brand,
    exclusionReason: exclusion.reason,
    exclusionEvidence: exclusion.evidence,
    excludedAt: exclusion.excluded ? now : null,
  };
}

export function ingestProgressiveListSnapshot({
  state,
  currentPayload,
  diffPayload = null,
  productionProducts = [],
  runId,
  now = new Date().toISOString(),
  currentListPath = null,
  diffPath = null,
  currentListFresh = true,
}) {
  const validation = validateProgressiveDailyState(state);
  if (!validation.valid) {
    throw Object.assign(
      new Error(
        `Progressive state validation blocked: ${validation.errors.join("; ")}`
      ),
      { code: "PROGRESSIVE_STATE_INVALID" }
    );
  }
  const next = structuredClone(state);
  const productionById = new Map(
    productionProducts.map((item) => [productId(item), item])
  );
  const candidatesById = new Map(
    next.candidates.map((item) => [
      item.sourceProductId,
      item,
    ])
  );
  const currentIds = new Set();
  const authoritativeNewIds = diffPayload
    ? new Set((diffPayload.newIds || []).map(String))
    : null;
  const authoritativeReappearedIds = diffPayload
    ? new Set((diffPayload.reappearedIds || []).map(String))
    : null;
  const summary = currentPayload?.summary || {};
  const firstOutOfStockOnlyPage = Number(
    summary.firstOutOfStockOnlyPage
  );

  for (const current of currentPayload?.products || []) {
    const id = productId(current);
    if (!id) continue;
    currentIds.add(id);
    const production = productionById.get(id);
    const changeTypes = [];
    if (
      (!authoritativeNewIds && !production) ||
      authoritativeNewIds?.has(id)
    ) {
      changeTypes.push("new-product");
    }
    if (production) {
      const listPrice = numericPrice(current.price);
      const oldPrice = productionPrice(production);
      if (
        listPrice &&
        oldPrice &&
        Math.abs(listPrice - oldPrice) > 0.0001
      ) {
        changeTypes.push("price-change");
      }
      if (
        isExplicitSmokingpipesOutOfStock(current) &&
        !isSold(production)
      ) {
        changeTypes.push("explicit-out-of-stock");
      }
      if (
        text(production.inventoryStatus).toLowerCase() === "sold" &&
        !isExplicitSmokingpipesOutOfStock(current) &&
        (!authoritativeReappearedIds ||
          authoritativeReappearedIds.has(id))
      ) {
        changeTypes.push("reappeared");
      }
    }
    if (!changeTypes.length) continue;

    const existing = candidatesById.get(id);
    if (existing) {
      const exclusion =
        classifySmokingpipesBrandExclusion({
          ...existing,
          ...current,
        });
      const listNotPublic =
        classifySmokingpipesListNotPublic({
          item: current,
          firstOutOfStockOnlyPage,
        });
      existing.changeTypes = addUnique(
        existing.changeTypes,
        changeTypes
      );
      existing.sourceUrl =
        text(current.sourceUrl || current.href) ||
        existing.sourceUrl;
      existing.listTitle =
        text(current.title || current.rawTitle) ||
        existing.listTitle;
      existing.listPrice = text(current.price);
      existing.listPrimaryImage =
        text(
          current.mainImage ||
            current.mainImageUrl ||
            current.imageUrl
        ) || existing.listPrimaryImage;
      existing.listPage = listNotPublic.listPage;
      existing.rawListStatus = text(current.rawListStatus);
      existing.listMissingPrice =
        listNotPublic.missingPrice;
      existing.listExplicitOutOfStock =
        listNotPublic.explicitOutOfStock;
      existing.listOutOfStockTail =
        listNotPublic.inOutOfStockTail;
      existing.inventoryStatus =
        isExplicitSmokingpipesOutOfStock(current)
          ? "sold"
          : "available";
      existing.lastSeenRunId = runId;
      existing.lastSeenAt = now;
      existing.retryCount ??= 0;
      const protectedStatus =
        existing.detailStatus === "complete" ||
        existing.publicStatus === "published";
      if (exclusion.excluded) {
        existing.detailStatus = "excluded";
        existing.publicStatus = "not-public";
        existing.excludedBrand = exclusion.brand;
        existing.exclusionReason = exclusion.reason;
        existing.exclusionEvidence = exclusion.evidence;
        existing.excludedAt ||= now;
        existing.readyReason = null;
        existing.reviewReason = exclusion.reason;
        existing.lastError = exclusion.reason;
        existing.nextEligibleAt = null;
      } else if (
        !protectedStatus &&
        existing.changeTypes.includes("new-product") &&
        listNotPublic.excluded
      ) {
        existing.detailStatus =
          "excluded-list-not-public";
        existing.publicStatus = "not-public";
        existing.listNotPublicReason =
          listNotPublic.reason;
        existing.reason = listNotPublic.reason;
        existing.readyReason = null;
        existing.reviewReason = listNotPublic.reason;
        existing.lastError = listNotPublic.reason;
        existing.nextEligibleAt = null;
      } else if (
        !protectedStatus &&
        existing.changeTypes.includes("new-product") &&
        existing.detailStatus ===
          "excluded-list-not-public" &&
        !listNotPublic.excluded
      ) {
        existing.detailStatus = "pending";
        existing.publicStatus = "not-public";
        existing.listNotPublicReason = null;
        existing.reason = null;
        existing.reviewReason = null;
        existing.lastError = null;
      }
      if (
        !exclusion.excluded &&
        !listNotPublic.excluded &&
        !protectedStatus &&
        existing.changeTypes.includes("new-product") &&
        existing.detailStatus === "blocked" &&
        existing.nextEligibleAt &&
        Date.parse(existing.nextEligibleAt) <= Date.parse(now)
      ) {
        existing.detailStatus = "pending";
      }
    } else {
      const candidate = makeCandidate({
        current,
        production,
        changeTypes,
        runId,
        now,
        firstOutOfStockOnlyPage,
      });
      next.candidates.push(candidate);
      candidatesById.set(id, candidate);
    }
  }

  const diffCoverage = diffPayload?.coverage || {};
  const expectedPages = Number(
    summary.expectedPages ||
      diffCoverage.expectedPages ||
      next.expectedPages
  );
  const pagesScanned = Number(
    summary.pagesScanned ||
      diffCoverage.pagesScanned ||
      0
  );
  const verificationDetected =
    summary.verificationDetected === true ||
    diffCoverage.verificationDetected === true ||
    [...(diffPayload?.fatalWarnings || []), ...(diffPayload?.warnings || [])]
      .some((item) =>
        /captcha|verification|challenge/i.test(String(item))
      );
  const fullExpectedRangeScanned =
    summary.fullExpectedRangeScanned === true &&
    diffCoverage.fullExpectedRangeScanned !== false &&
    pagesScanned >= expectedPages;
  const captchaDetected =
    summary.captchaDetected === true ||
    (summary.captchaPages || []).length > 0 ||
    diffCoverage.captchaDetected === true ||
    (diffCoverage.captchaPages || []).length > 0;
  const globalAllowed =
    fullExpectedRangeScanned &&
    !captchaDetected &&
    !verificationDetected;
  const disappearanceUpdate = updateDisappearanceTracking({
    previousGlobalReconcile: next.globalReconcile,
    productionById,
    currentIds,
    currentPayload,
    summary,
    globalAllowed,
    diffAllowApply: diffPayload?.allowApply,
    currentListFresh,
    runId,
    now,
  });
  for (const id of disappearanceUpdate.confirmedIds) {
    const existing = candidatesById.get(id);
    if (existing) {
      existing.changeTypes = addUnique(existing.changeTypes, [
        "confirmed-disappeared",
      ]);
      existing.detailStatus = "complete";
      existing.publicStatus = "ready";
    } else {
      const candidate = makeConfirmedDisappearedCandidate({
        production: productionById.get(id),
        runId,
        now,
      });
      next.candidates.push(candidate);
      candidatesById.set(id, candidate);
    }
  }
  next.listSnapshotStatus =
    captchaDetected || verificationDetected
    ? "blocked"
    : fullExpectedRangeScanned
      ? "complete"
      : "partial";
  next.pagesScanned = pagesScanned;
  next.expectedPages = expectedPages;
  next.fullExpectedRangeScanned =
    fullExpectedRangeScanned;
  next.captchaDetected = captchaDetected;
  next.verificationDetected = verificationDetected;
  next.blockedAt =
    captchaDetected || verificationDetected ? now : null;
  next.blockedPage =
    captchaDetected || verificationDetected
    ? (
        summary.captchaPages ||
        diffCoverage.captchaPages ||
        [null]
      )[0]
    : null;
  next.blockedReason =
    captchaDetected || verificationDetected
    ? "strong verification detected during list scan"
    : null;
  next.currentListPath = currentListPath;
  next.diffPath = diffPath;
  next.globalReconcile = {
    allowed: globalAllowed,
    applyAllowed: false,
    disappearedIds: globalAllowed
      ? diffPayload
        ? [...new Set((diffPayload.disappearedIds || []).map(String))]
        : [...productionById.keys()].filter(
            (id) =>
              !currentIds.has(id) &&
              !isSold(productionById.get(id))
          )
      : [],
    confirmedDisappearedCandidatesApplyAllowed: true,
    disappearanceTracking: disappearanceUpdate.tracking,
  };
  next.dailyRunId = runId;
  next.updatedAt = now;
  next.summary = stateSummary(next, now);
  return next;
}

export function summarizeProgressiveState(state) {
  const candidates = state?.candidates || [];
  const newCandidates = candidates.filter((item) =>
    item.changeTypes.includes("new-product")
  );
  const count = (status) =>
    newCandidates.filter(
      (item) => item.detailStatus === status
    ).length;
  return {
    totalCandidates: candidates.length,
    newCandidates: newCandidates.length,
    detailsCompletedTotal: count("complete"),
    detailsPending: count("pending"),
    detailsDeferred: count("deferred"),
    detailsFailed: count("failed"),
    detailsBlocked: count("blocked"),
    detailsExcluded: count("excluded"),
    detailsListNotPublic: count(
      "excluded-list-not-public"
    ),
    readyForPartialApply: candidates.filter(
      (item) =>
        item.publicStatus === "ready" &&
        item.detailStatus === "complete"
    ).length,
  };
}

export { stateSummary as buildProgressiveStateSummary };

export function selectProgressiveDetailCandidates({
  state,
  maxItems = 5,
  now = new Date().toISOString(),
}) {
  const nowMs = Date.parse(now);
  return (state?.candidates || [])
    .filter((item) => {
      if (isSmokingpipesExcludedBrand(item)) return false;
      if (!item.changeTypes.includes("new-product")) return false;
      if (
        [
          "complete",
          "review-only",
          "excluded",
          "excluded-list-not-public",
        ].includes(
          item.detailStatus
        ) ||
        ["published", "review-only"].includes(item.publicStatus)
      ) {
        return false;
      }
      if (item.detailStatus === "failed") return false;
      if (item.detailStatus === "blocked") {
        return (
          item.nextEligibleAt &&
          Date.parse(item.nextEligibleAt) <= nowMs
        );
      }
      return item.detailStatus === "pending";
    })
    .sort(
      (left, right) =>
        Number(right.priority || 0) -
          Number(left.priority || 0) ||
        String(left.discoveredAt).localeCompare(
          String(right.discoveredAt)
        )
    )
    .slice(0, Math.max(1, Number(maxItems) || 5));
}

export async function runProgressiveDetailChunk({
  state,
  maxItems = 5,
  now = new Date().toISOString(),
  retryDelayMs = 90 * 60 * 1000,
  retryFailedDetails = false,
  maxDetailAttempts = 3,
  processDetail,
  checkpoint = async () => {},
  onDetailSettled = async () => {},
  shouldStartDetail = async () => ({ allowed: true }),
  runId = state?.dailyRunId,
}) {
  const validation = validateProgressiveDailyState(state);
  if (!validation.valid) {
    return {
      status: "blocked",
      state,
      completedThisRun: 0,
      remainingPendingCount: null,
      blockedReason: validation.errors.join("; "),
      recommendedNextRunAt: null,
      productionWritten: false,
    };
  }
  const next = structuredClone(state);
  const selected = selectProgressiveDetailCandidates({
    state: next,
    maxItems,
    now,
  });
  let completedThisRun = 0;
  let failedThisRun = 0;
  let blockedReason = null;
  let recommendedNextRunAt = null;
  let deadlineReached = false;

  for (let index = 0; index < selected.length; index += 1) {
    const selectedItem = selected[index];
    const candidate = next.candidates.find(
      (item) =>
        item.sourceProductId === selectedItem.sourceProductId
    );
    const startDecision = await shouldStartDetail({
      candidate: structuredClone(candidate),
      index,
      state: next,
    });
    if (startDecision === false || startDecision?.allowed === false) {
      blockedReason =
        startDecision?.reason || "detail processing stopped before the next detail";
      recommendedNextRunAt = startDecision?.recommendedNextRunAt || null;
      deadlineReached = startDecision?.code === "DAILY_DEADLINE_REACHED";
      next.updatedAt = new Date().toISOString();
      await checkpoint(next);
      break;
    }
    if (candidate.detailStatus === "blocked") {
      candidate.detailStatus = "pending";
    }
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
      candidate.detailStatus =
        result.reviewOnly === true
          ? "review-only"
          : "complete";
      if (candidate.detailStatus === "complete") {
        const classification =
          classifyProgressiveCandidatePublicStatus(candidate);
        Object.assign(candidate, classification);
      } else {
        candidate.publicStatus = "review-only";
        candidate.readyReason = null;
        candidate.reviewReason =
          result.reviewReason ||
          result.lastError ||
          "detail conversion completed as review-only";
        candidate.lastError = candidate.reviewReason;
      }
      candidate.lastSuccessfulDetailRunId = runId;
      candidate.nextEligibleAt = null;
      completedThisRun +=
        candidate.detailStatus === "complete" ? 1 : 0;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      candidate.lastError = message;
      if (error?.code === "DAILY_DEADLINE_REACHED") {
        candidate.detailStatus = "pending";
        candidate.nextEligibleAt = null;
        blockedReason = message;
        deadlineReached = true;
      } else if (error?.code === "CAPTCHA_REQUIRED") {
        candidate.detailStatus = "blocked";
        candidate.blockedCount += 1;
        candidate.lastBlockedAt = now;
        candidate.lastBlockedReason = message;
        candidate.nextEligibleAt = new Date(
          Date.parse(now) + retryDelayMs
        ).toISOString();
        blockedReason = message;
        recommendedNextRunAt = candidate.nextEligibleAt;
      } else {
        candidate.retryCount += 1;
        if (
          retryFailedDetails === true &&
          candidate.retryCount < Math.max(1, Number(maxDetailAttempts) || 3)
        ) {
          candidate.detailStatus = "blocked";
          candidate.nextEligibleAt = new Date(
            Date.parse(now) + retryDelayMs
          ).toISOString();
        } else {
          candidate.detailStatus = "failed";
          failedThisRun += 1;
        }
      }
    }
    next.updatedAt = new Date().toISOString();
    await onDetailSettled({
      candidate: structuredClone(candidate),
      state: next,
      runId,
    });
    await checkpoint(next);
    if (blockedReason) break;
  }

  next.latestRun = {
    runId,
    mode: "progressive-detail-chunk",
    finishedAt: new Date().toISOString(),
    selected: selected.length,
    completedThisRun,
    failedThisRun,
    blockedReason,
    recommendedNextRunAt,
    deadlineReached,
  };
  const remainingPendingCount = next.candidates.filter(
    (candidate) => candidate.detailStatus === "pending"
  ).length;
  return {
    status: blockedReason
      ? "blocked"
      : selected.length
        ? "chunk-complete"
        : "no-eligible-candidates",
    state: next,
    selected: selected.length,
    completedThisRun,
    failedThisRun,
    remainingPendingCount,
    blockedReason,
    recommendedNextRunAt,
    deadlineReached,
    productionWritten: false,
  };
}
