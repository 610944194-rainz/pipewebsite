import {
  evaluateSmokingpipesPublicReadiness,
} from "../lib/smokingpipes-public-readiness-v1.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceProductId(item) {
  return text(item?.sourceProductId);
}

function parsePrice(value) {
  const amount = Number.parseFloat(
    text(value).replace(/[^0-9.]/g, "")
  );
  return Number.isFinite(amount) && amount > 0
    ? amount
    : null;
}

function clone(value) {
  return structuredClone(value);
}

function uniqueIds(values) {
  return [...new Set(values.map(String).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, "en", { numeric: true })
  );
}

function updateExplicitPrice(product, candidate) {
  const amount = parsePrice(candidate.listPrice);
  if (!amount) return product;
  const next = clone(product);
  next.price ||= {};
  next.price.current = {
    ...(next.price.current || {}),
    rawText: candidate.listPrice,
    currency:
      next.price.current?.currency || "USD",
    amount,
    parseStatus: "parsed",
  };
  if (next.price.listPrice) {
    next.price.listPrice = {
      ...next.price.listPrice,
      rawText: candidate.listPrice,
      currency:
        next.price.listPrice.currency || "USD",
      amount,
      parseStatus: "parsed",
    };
  }
  return next;
}

function updateExplicitInventory(product, candidate) {
  const next = clone(product);
  if (
    candidate.changeTypes.includes(
      "explicit-out-of-stock"
    )
  ) {
    next.inventoryStatus = "sold";
    next.inventoryConfidence = "high";
    next.includedInActiveListRange = true;
    next.rawListStatus = "OUT OF STOCK";
    next.inventoryEvidence = {
      ...(next.inventoryEvidence || {}),
      includedInActiveListRange: true,
      rawListStatus: "OUT OF STOCK",
      reasons: [
        ...new Set([
          ...(next.inventoryEvidence?.reasons || []),
          "Explicit OUT OF STOCK observed in progressive list scan.",
        ]),
      ],
    };
  }
  if (candidate.changeTypes.includes("reappeared")) {
    next.inventoryStatus = "available";
    next.inventoryConfidence = "high";
    next.includedInActiveListRange = true;
    next.rawListStatus = "";
    next.inventoryEvidence = {
      ...(next.inventoryEvidence || {}),
      includedInActiveListRange: true,
      rawListStatus: "",
      reasons: [
        ...new Set([
          ...(next.inventoryEvidence?.reasons || []),
          "Product reappeared in progressive list scan.",
        ]),
      ],
    };
  }
  if (
    candidate.changeTypes.includes("confirmed-disappeared") &&
    !candidate.changeTypes.includes("reappeared")
  ) {
    next.inventoryStatus = "sold";
    next.inventoryConfidence = "medium";
    next.includedInActiveListRange = false;
    next.rawListStatus = "";
    next.inventoryEvidence = {
      ...(next.inventoryEvidence || {}),
      includedInActiveListRange: false,
      rawListStatus: "",
      reasons: [
        ...new Set([
          ...(next.inventoryEvidence?.reasons || []),
          "Product was absent from two consecutive trusted complete list scans.",
        ]),
      ],
    };
  }
  return next;
}

function newProductEligible(candidate) {
  const product = candidate?.convertedProduct;
  const readiness = product
    ? evaluateSmokingpipesPublicReadiness(product)
    : null;
  return (
    candidate?.changeTypes?.includes("new-product") &&
    candidate.detailStatus === "complete" &&
    candidate.publicStatus === "ready" &&
    product &&
    readiness?.publicIndexEligible === true &&
    Boolean(
      text(product.mainImageUrl || product.imageUrl) ||
        product.galleryImages?.some((item) => text(item))
    ) &&
    parsePrice(product.price?.current?.amount) !== null
  );
}

export function buildProgressivePartialProducts({
  productionProducts = [],
  state,
  actionablePlan = null,
  now = null,
}) {
  const generatedAt =
    now || state?.updatedAt || new Date().toISOString();
  const productsById = new Map(
    productionProducts.map((product) => [
      sourceProductId(product),
      clone(product),
    ])
  );
  const productionIds = new Set(productsById.keys());
  const newProductIds = [];
  const attemptedCandidateIds = [];
  const appliedCandidateIds = [];
  const fieldChanges = [];

  if (actionablePlan) {
    for (const item of actionablePlan.items || []) {
      const id = sourceProductId(item.event);
      if (!id || !item.desired) continue;
      const existing = productsById.get(id);
      productsById.set(id, clone(item.desired));
      attemptedCandidateIds.push(id);
      appliedCandidateIds.push(id);
      if (!existing) newProductIds.push(id);
      fieldChanges.push({
        sourceProductId: id,
        operation: existing ? "update-fields" : "add-product",
        fields: item.fields?.length
          ? [...new Set(item.fields)].sort()
          : existing
            ? ["*no-op-blocked"]
            : ["*new-product"],
        eventId: item.event.eventId,
        changeType: item.event.changeType,
      });
    }
    return {
      version: "smokingpipes-products-partial-next-dry-run-v1",
      generatedAt,
      source: "smokingpipes",
      productionWritten: false,
      products: [...productsById.values()].sort((left, right) =>
        sourceProductId(left).localeCompare(
          sourceProductId(right),
          "en",
          { numeric: true }
        )
      ),
      productionProductCount: productionIds.size,
      newProductIds: uniqueIds(newProductIds),
      attemptedCandidateIds: uniqueIds(attemptedCandidateIds),
      appliedCandidateIds: uniqueIds(appliedCandidateIds),
      appliedEventIds: uniqueIds(
        (actionablePlan.items || []).map((item) => item.event?.eventId)
      ),
      fieldChanges: fieldChanges.sort((left, right) =>
        left.sourceProductId.localeCompare(
          right.sourceProductId,
          "en",
          { numeric: true }
        )
      ),
      actionablePlan: {
        schemaVersion: actionablePlan.schemaVersion,
        sourceSnapshotId: actionablePlan.sourceSnapshotId,
        sourceSnapshotHash: actionablePlan.sourceSnapshotHash,
        pendingEventCount: actionablePlan.items?.length || 0,
        isolatedEventCount: actionablePlan.isolated?.length || 0,
        supersededEventCount: actionablePlan.superseded?.length || 0,
        catchupBatches: actionablePlan.catchupBatches || [],
      },
    };
  }

  for (const candidate of state?.candidates || []) {
    const id = sourceProductId(candidate);
    if (!id) continue;
    const existing = productsById.get(id);
    if (!existing && newProductEligible(candidate)) {
      const product = clone(candidate.convertedProduct);
      productsById.set(id, product);
      newProductIds.push(id);
      attemptedCandidateIds.push(id);
      appliedCandidateIds.push(id);
      fieldChanges.push({
        sourceProductId: id,
        operation: "add-product",
        fields: ["*new-product"],
      });
      continue;
    }
    if (!existing) continue;

    let updated = existing;
    const fields = [];
    if (
      candidate.detailStatus === "complete" &&
      candidate.publicStatus === "ready" &&
      candidate.changeTypes.includes("price-change") &&
      parsePrice(candidate.listPrice)
    ) {
      updated = updateExplicitPrice(updated, candidate);
      fields.push(
        "price.current.rawText",
        "price.current.amount",
        "price.current.parseStatus"
      );
    }
    if (
      candidate.detailStatus === "complete" &&
      candidate.publicStatus === "ready" &&
      (candidate.changeTypes.includes(
        "explicit-out-of-stock"
      ) ||
        candidate.changeTypes.includes("reappeared") ||
        candidate.changeTypes.includes("confirmed-disappeared"))
    ) {
      updated = updateExplicitInventory(
        updated,
        candidate
      );
      fields.push(
        "inventoryStatus",
        "inventoryConfidence",
        "includedInActiveListRange",
        "rawListStatus",
        "inventoryEvidence"
      );
    }
    if (fields.length) {
      attemptedCandidateIds.push(id);
      if (JSON.stringify(updated) !== JSON.stringify(existing)) {
        productsById.set(id, updated);
        appliedCandidateIds.push(id);
        fieldChanges.push({
          sourceProductId: id,
          operation: "update-fields",
          fields: [...new Set(fields)].sort(),
        });
      }
    }
  }

  return {
    version:
      "smokingpipes-products-partial-next-dry-run-v1",
    generatedAt,
    source: "smokingpipes",
    productionWritten: false,
    products: [...productsById.values()].sort((left, right) =>
      sourceProductId(left).localeCompare(
        sourceProductId(right),
        "en",
        { numeric: true }
      )
    ),
    productionProductCount: productionIds.size,
    newProductIds: [...new Set(newProductIds)].sort(),
    attemptedCandidateIds: [
      ...new Set(attemptedCandidateIds),
    ].sort(),
    appliedCandidateIds: [
      ...new Set(appliedCandidateIds),
    ].sort(),
    fieldChanges: fieldChanges.sort((left, right) =>
      left.sourceProductId.localeCompare(
        right.sourceProductId,
        "en",
        { numeric: true }
      )
    ),
  };
}

function candidateChangeTypes(candidate) {
  return Array.isArray(candidate?.changeTypes)
    ? candidate.changeTypes.map(text).filter(Boolean)
    : [];
}

function classifyGapCandidate({
  candidate,
  productionProduct,
  candidateProduct,
  disappearedIds,
}) {
  const changeTypes = candidateChangeTypes(candidate);
  if (
    disappearedIds.has(sourceProductId(candidate)) ||
    changeTypes.includes("disappeared")
  ) {
    return {
      key: "disappearedApplyDisabled",
      reason: "disappeared-apply-disabled",
      safe: true,
    };
  }
  if (
    changeTypes.includes("sold-by-absence") ||
    candidate?.soldByAbsence === true
  ) {
    return {
      key: "soldByAbsenceDisabled",
      reason: "sold-by-absence-disabled",
      safe: true,
    };
  }
  if (
    candidate?.publicStatus === "review-only" ||
    candidate?.detailStatus === "review-only"
  ) {
    return {
      key: "reviewOnly",
      reason: "review-only",
      safe: true,
    };
  }
  if (
    candidate?.publicStatus === "not-public" ||
    ["pending", "failed", "blocked"].includes(
      text(candidate?.detailStatus)
    )
  ) {
    return {
      key: "notPublic",
      reason: "not-public",
      safe: true,
    };
  }
  if (
    productionProduct &&
    candidateProduct &&
    JSON.stringify(productionProduct) ===
      JSON.stringify(candidateProduct)
  ) {
    return {
      key: "noOpAlreadyCurrent",
      reason: "no-op-already-current",
      safe: true,
    };
  }
  if (
    candidate?.publicStatus === "ready" &&
    candidate?.detailStatus === "complete"
  ) {
    return {
      key: "readyUnexpectedlyExcluded",
      reason: "ready-candidate-unexpectedly-excluded",
      safe: false,
    };
  }
  return {
    key: "other",
    reason: "other",
    safe: false,
  };
}

export function diagnoseProgressiveApplyGap({
  state,
  productionProducts = [],
  candidateProducts = [],
  candidateIds = [],
  wouldApplyProductIds = [],
  now = new Date().toISOString(),
}) {
  const normalizedCandidateIds = [
    ...new Set(candidateIds.map(String).filter(Boolean)),
  ].sort();
  const wouldApplyIds = new Set(
    wouldApplyProductIds.map(String).filter(Boolean)
  );
  const productionById = new Map(
    productionProducts.map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const candidateProductsById = new Map(
    candidateProducts.map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const stateCandidatesById = new Map(
    (state?.candidates || []).map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const disappearedIds = new Set(
    (state?.globalReconcile?.disappearedIds || []).map(String)
  );
  const gapClassifications = {
    disappearedApplyDisabled: 0,
    soldByAbsenceDisabled: 0,
    reviewOnly: 0,
    notPublic: 0,
    noOpAlreadyCurrent: 0,
    readyUnexpectedlyExcluded: 0,
    other: 0,
  };
  const gapCandidates = normalizedCandidateIds
    .filter((id) => !wouldApplyIds.has(id))
    .map((id) => {
      const candidate = stateCandidatesById.get(id) || null;
      const productionProduct = productionById.get(id) || null;
      const candidateProduct =
        candidateProductsById.get(id) || null;
      const classification = classifyGapCandidate({
        candidate,
        productionProduct,
        candidateProduct,
        disappearedIds,
      });
      gapClassifications[classification.key] += 1;
      return {
        id:
          text(candidateProduct?.id) ||
          text(productionProduct?.id) ||
          `smokingpipes-${id}`,
        sourceProductId: id,
        changeType:
          candidateChangeTypes(candidate).join(", ") ||
          "unknown",
        publicStatus:
          text(candidate?.publicStatus) || "unknown",
        detailStatus:
          text(candidate?.detailStatus) || "unknown",
        applyAllowed: false,
        reason: classification.reason,
      };
    });
  const unknownGapCount = gapClassifications.other;
  const readyUnexpectedlyExcludedCount =
    gapClassifications.readyUnexpectedlyExcluded;
  const gapCount = gapCandidates.length;
  const safeToApplyWouldApplySubset =
    wouldApplyIds.size > 0 &&
    gapCount ===
      normalizedCandidateIds.length - wouldApplyIds.size &&
    unknownGapCount === 0 &&
    readyUnexpectedlyExcludedCount === 0;

  return {
    version: "smokingpipes-apply-gap-diagnosis-v1",
    generatedAt: now,
    candidateCount: normalizedCandidateIds.length,
    wouldApplyCount: wouldApplyIds.size,
    gapCount,
    gapCandidates,
    gapClassifications,
    unknownGapCount,
    readyUnexpectedlyExcludedCount,
    safeToApplyWouldApplySubset,
  };
}

export function selectProgressiveRecentNew({
  catalog = [],
  newProductIds = [],
}) {
  const allowed = new Set(newProductIds.map(String));
  const seen = new Set();
  return catalog.filter((product) => {
    const id = sourceProductId(product);
    const catalogId = text(product.id);
    if (
      !allowed.has(id) ||
      seen.has(catalogId) ||
      product.publicIndexEligible !== true ||
      product.publiclySellable !== true ||
      text(product.inventoryStatus).toLowerCase() !==
        "available" ||
      !(Number(product.sourcePriceAmount) > 0) ||
      !(Number(product.siteDisplayAmount) > 0) ||
      product.siteDisplayReady !== true
    ) {
      return false;
    }
    seen.add(catalogId);
    return true;
  });
}

export function auditProgressivePartialCandidate({
  productionProducts = [],
  candidateProducts = [],
  state,
  publicCatalog = [],
  recentNew = [],
}) {
  const newProductCandidates = (state?.candidates || []).filter((item) =>
    item.changeTypes.includes("new-product")
  );
  const newProductReady = newProductCandidates.filter(
    (item) =>
      item.detailStatus === "complete" &&
      item.publicStatus === "ready" &&
      item.convertedProduct
  ).length;
  const newProductReviewOnly = newProductCandidates.filter(
    (item) => item.publicStatus === "review-only"
  ).length;
  const newProductNotReady = newProductCandidates.filter(
    (item) =>
      !(
        item.detailStatus === "complete" &&
        item.publicStatus === "ready" &&
        item.convertedProduct
      ) && item.publicStatus !== "review-only"
  ).length;
  const filteredNewProducts = newProductCandidates
    .filter(
      (item) =>
        !(
          item.detailStatus === "complete" &&
          item.publicStatus === "ready" &&
          item.convertedProduct
        )
    )
    .map((item) => ({
      sourceProductId: sourceProductId(item),
      publicStatus: text(item.publicStatus) || "not-public",
      detailStatus: text(item.detailStatus) || "unknown",
      reason:
        text(item.reviewReason) ||
        text(item.lastError) ||
        text(item.lastBlockedReason) ||
        (item.detailStatus === "pending"
          ? "detail is still pending"
          : item.detailStatus === "failed"
            ? "detail fetch failed"
            : item.detailStatus === "blocked"
              ? "detail fetch blocked"
              : "new product is not public-ready"),
    }));
  const candidateProductIds = new Set(
    candidateProducts.map(sourceProductId)
  );
  const publicIds = new Set(
    publicCatalog
      .filter((item) => item.source === "smokingpipes")
      .map(sourceProductId)
  );
  const deletedProducts = productionProducts.filter(
    (item) => !candidateProductIds.has(sourceProductId(item))
  ).length;
  const leakCount = (predicate) =>
    (state?.candidates || []).filter(
      (item) =>
        predicate(item) &&
        publicIds.has(item.sourceProductId)
    ).length;
  const counts = {
    deletedProducts,
    pendingLeak: leakCount(
      (item) => item.detailStatus === "pending"
    ),
    failedLeak: leakCount(
      (item) => item.detailStatus === "failed"
    ),
    blockedLeak: leakCount(
      (item) => item.detailStatus === "blocked"
    ),
    reviewOnlyLeak: leakCount(
      (item) =>
        item.detailStatus === "review-only" ||
        item.publicStatus === "review-only"
    ),
    zeroPriceSellable: publicCatalog.filter(
      (item) =>
        item.publiclySellable === true &&
        (!(Number(item.sourcePriceAmount) > 0) ||
          !(Number(item.siteDisplayAmount) > 0) ||
          item.siteDisplayReady !== true)
    ).length,
  };
  const duplicateProducts =
    candidateProducts.length -
    new Set(candidateProducts.map(sourceProductId)).size;
  const duplicatePublic =
    publicCatalog.length -
    new Set(publicCatalog.map((item) => item.id)).size;
  const duplicateRecentNew =
    recentNew.length -
    new Set(recentNew.map((item) => item.id)).size;
  const recentNewSold = recentNew.filter(
    (item) =>
      item.publiclySellable !== true ||
      text(item.inventoryStatus).toLowerCase() !==
        "available"
  ).length;
  const blockers = [];
  for (const [key, value] of Object.entries(counts)) {
    if (value !== 0) blockers.push(`${key}=${value}`);
  }
  if (duplicateProducts)
    blockers.push(`duplicateProducts=${duplicateProducts}`);
  if (duplicatePublic)
    blockers.push(`duplicatePublic=${duplicatePublic}`);
  if (duplicateRecentNew)
    blockers.push(
      `duplicateRecentNew=${duplicateRecentNew}`
    );
  if (recentNewSold)
    blockers.push(`recentNewSold=${recentNewSold}`);
  return {
    version:
      "smokingpipes-progressive-partial-audit-v1",
    generatedAt: new Date().toISOString(),
    verdict: blockers.length ? "FAIL" : "PASS",
    blockers,
    warnings: [],
    counts,
    duplicateProducts,
    duplicatePublic,
    duplicateRecentNew,
    recentNewSold,
    productionWritten: false,
    newProductReady,
    newProductReviewOnly,
    newProductNotReady,
    filteredNewProducts,
  };
}

export function buildProgressivePartialApplyPreview({
  state,
  audit,
  productionProducts = [],
  candidateProducts = [],
  appliedCandidateIds,
  fieldChanges,
  appliedEventIds = [],
  now = new Date().toISOString(),
}) {
  if (!audit || audit.verdict !== "PASS") {
    return {
      version:
        "smokingpipes-progressive-partial-apply-preview-v1",
      generatedAt: now,
      status: "blocked",
      blockers: audit?.blockers || [
        "passing partial audit is required",
      ],
      wouldApplyProductIds: [],
      productionWritten: false,
      commitPerformed: false,
      pushPerformed: false,
    };
  }
  const productionById = new Map(
    productionProducts.map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const wouldApplyProductIds = candidateProducts
    .filter((item) => {
      const existing = productionById.get(
        sourceProductId(item)
      );
      return (
        !existing ||
        JSON.stringify(existing) !== JSON.stringify(item)
      );
    })
    .map(sourceProductId)
    .sort();
  const effectiveApplyIds = [
    ...new Set(
      (Array.isArray(appliedCandidateIds)
        ? appliedCandidateIds
        : wouldApplyProductIds
      ).map(String).filter(Boolean)
    ),
  ].sort();
  const evidenceAppliedIds = [
    ...new Set(
      (Array.isArray(appliedCandidateIds)
        ? appliedCandidateIds
        : effectiveApplyIds
      ).map(String).filter(Boolean)
    ),
  ].sort();
  const evidenceFieldChangeIds = [
    ...new Set(
      (Array.isArray(fieldChanges)
        ? fieldChanges
        : effectiveApplyIds.map((sourceProductId) => ({ sourceProductId }))
      )
        .map((change) => sourceProductId(change))
        .filter(Boolean)
    ),
  ].sort();
  const effectiveApplyCount = effectiveApplyIds.length;
  const effectiveApplyConsistency = {
    valid:
      JSON.stringify(effectiveApplyIds) === JSON.stringify(evidenceAppliedIds) &&
      JSON.stringify(effectiveApplyIds) === JSON.stringify(evidenceFieldChangeIds),
    productionChangedIds: effectiveApplyIds,
    appliedCandidateIds: evidenceAppliedIds,
    appliedEventIds: uniqueIds(appliedEventIds),
    fieldChangeIds: evidenceFieldChangeIds,
  };
  effectiveApplyConsistency.reason = effectiveApplyConsistency.valid
    ? null
    : `effective apply count mismatch: production=${effectiveApplyIds.length}, appliedCandidateIds=${evidenceAppliedIds.length}, fieldChanges=${evidenceFieldChangeIds.length}`;
  const candidateCount = Number(
    audit?.candidateCount ?? wouldApplyProductIds.length
  );
  return {
    version:
      "smokingpipes-progressive-partial-apply-preview-v1",
    generatedAt: now,
    status: "preview-ready",
    stateVersion: state?.version || null,
    candidateCount,
    wouldApplyProductIds,
    wouldApplyCount: wouldApplyProductIds.length,
    effectiveApplyCount,
    appliedCandidateIds: evidenceAppliedIds,
    appliedEventIds: uniqueIds(appliedEventIds),
    fieldChanges: Array.isArray(fieldChanges) ? fieldChanges : evidenceFieldChangeIds.map((sourceProductId) => ({ sourceProductId, operation: "derived-production-diff", fields: [] })),
    effectiveApplyConsistency,
    isolatedCandidateCount: Number(
      audit?.isolatedCandidateCount ??
        audit?.applyGap?.gapCount ??
        0
    ),
    safeSubsetApply:
      audit?.applyGap?.safeToApplyWouldApplySubset === true,
    applyGap: audit?.applyGap || null,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
}
