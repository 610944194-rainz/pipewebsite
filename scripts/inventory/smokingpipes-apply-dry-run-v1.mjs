import crypto from "node:crypto";
import path from "node:path";
import { convertSmokingpipesCandidateDetails } from "../convert-smokingpipes-products-v2.mjs";
import { buildUnifiedProductsFromInputs } from "../build-unified-products-staging-v1.mjs";
import {
  buildPublicProductsCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";
import {
  isSmokingpipesPublicIndexEligible,
  isSmokingpipesPubliclySellable,
  isSmokingpipesPublicReady,
  SMOKINGPIPES_PUBLIC_READY_CATEGORY,
} from "../lib/smokingpipes-public-readiness-v1.mjs";
import {
  baselineCatchUpNextStep,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";

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

function reviewSample(product, current, reason) {
  return {
    sourceProductId: sourceProductId(product),
    title:
      text(product?.displayNameEn) ||
      text(product?.fullTitle) ||
      text(product?.rawTitle),
    reason,
    sourceUrl: text(product?.sourceUrl),
    price: text(current?.price) || text(product?.price?.current?.rawText),
    status: text(product?.inventoryStatus),
    imageCount: Array.isArray(product?.galleryImages)
      ? product.galleryImages.length
      : 0,
    hasMainImage: Boolean(text(product?.imageUrl)),
    brand: text(product?.canonicalBrand),
    shape: text(product?.canonicalShape),
    material: text(product?.canonicalMaterial),
  };
}

function setReviewOnly(product, {
  category,
  reason,
  pricePending = false,
}) {
  return {
    ...product,
    listingEligible: false,
    publicIndexEligible: false,
    publiclySellable: false,
    publication: {
      ...(product.publication || {}),
      status: "excluded",
      listingEligible: false,
      publicIndexEligible: false,
      publiclySellable: false,
      reason,
    },
    sourceSpecific: {
      ...(product.sourceSpecific || {}),
      smokingpipes: {
        ...(product.sourceSpecific?.smokingpipes || {}),
        baselineReadinessCategory: category,
        baselineReadinessReason: reason,
        pricePending,
      },
    },
  };
}

export function classifySmokingpipesBaselineProducts({
  convertedProducts,
  currentPayload,
  conversionFailures = [],
  sampleLimit = 20,
  fatalThresholds = {
    maxConvertFailedCount: 50,
    maxConvertFailedRatio: 0.25,
  },
}) {
  const currentById = new Map(
    (currentPayload?.products || []).map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const products = [];
  const publicReadyProducts = [];
  const categoryItems = {
    publicReady: [],
    soldOutOfStock: [],
    missingPrice: [],
    inventoryConflict: [],
    missingImage: [],
    missingRequiredFields: [],
    taxonomyNeedsReview: [],
    publicationExcluded: [],
    convertFailed: conversionFailures.map((failure) => ({
      sourceProductId: text(failure.sourceProductId),
      title: "",
      reason: text(failure.error) || "conversion failed",
      sourceUrl: "",
      price: "",
      status: "convert-failed",
      imageCount: 0,
      hasMainImage: false,
      brand: "",
      shape: "",
      material: "",
    })),
  };

  for (const product of convertedProducts || []) {
    const id = sourceProductId(product);
    const current = currentById.get(id) || {};
    let category = SMOKINGPIPES_PUBLIC_READY_CATEGORY;
    let reason = "Product passed baseline public-readiness checks.";
    let classified = product;

    if (isOutOfStock(current)) {
      category = "soldOutOfStock";
      reason = "Current-list explicitly reports OUT OF STOCK / sold out.";
      classified = setInventory(product, {
        status: "sold",
        confidence: "explicit-list-status",
        includedInActiveListRange: true,
        rawListStatus: current.rawListStatus,
        reason,
      });
    } else if (!text(current.price)) {
      category = "missingPrice";
      reason =
        "Current-list price is missing; product remains not sold and requires price review.";
      classified = setReviewOnly(product, {
        category,
        reason,
        pricePending: true,
      });
    } else if (product.inventoryStatus !== "available") {
      category = "inventoryConflict";
      reason =
        "Detail inventory status conflicts with the complete current-list snapshot.";
      classified = setReviewOnly(product, { category, reason });
    } else if (!text(product.imageUrl)) {
      category = "missingImage";
      reason = "Main product image is missing.";
      classified = setReviewOnly(product, { category, reason });
    } else if (
      !text(product.canonicalBrand) ||
      !text(product.canonicalShape) ||
      !text(product.canonicalMaterial)
    ) {
      category = "missingRequiredFields";
      reason = "One or more required brand/shape/material fields are missing.";
      classified = setReviewOnly(product, { category, reason });
    } else if (
      product.brandReviewStatus === "needs-review" ||
      product.shapeReviewStatus === "needs-review" ||
      product.materialReviewStatus === "needs-review"
    ) {
      category = "taxonomyNeedsReview";
      reason = "Brand, shape, or material taxonomy requires review.";
      classified = setReviewOnly(product, { category, reason });
    } else if (product.publication?.listingEligible === false) {
      category = "publicationExcluded";
      reason =
        text(product.publication?.reason) ||
        "Existing publication rules exclude this product.";
      classified = setReviewOnly(product, { category, reason });
    } else {
      classified = {
        ...product,
        listingEligible: true,
        publicIndexEligible: true,
        publiclySellable: true,
        publication: {
          ...(product.publication || {}),
          status: "eligible",
          listingEligible: true,
          publicIndexEligible: true,
          publiclySellable: true,
        },
        sourceSpecific: {
          ...(product.sourceSpecific || {}),
          smokingpipes: {
            ...(product.sourceSpecific?.smokingpipes || {}),
            baselineReadinessCategory: category,
            baselineReadinessReason: reason,
            pricePending: false,
          },
        },
      };
    }

    if (isSmokingpipesPublicReady(classified)) {
      publicReadyProducts.push(classified);
    }
    products.push(classified);
    categoryItems[category].push(reviewSample(classified, current, reason));
  }

  const convertFailed = conversionFailures.length;
  const totalCompleted = products.length + convertFailed;
  const convertFailedRatio =
    totalCompleted > 0 ? convertFailed / totalCompleted : 0;
  const fatal =
    convertFailed > fatalThresholds.maxConvertFailedCount ||
    convertFailedRatio > fatalThresholds.maxConvertFailedRatio;
  const counts = {
    totalCompleted,
    convertSucceeded: products.length,
    convertFailed,
    publicReady: categoryItems.publicReady.length,
    soldOutOfStock: categoryItems.soldOutOfStock.length,
    missingPrice: categoryItems.missingPrice.length,
    inventoryConflict: categoryItems.inventoryConflict.length,
    missingImage: categoryItems.missingImage.length,
    missingRequiredFields: categoryItems.missingRequiredFields.length,
    taxonomyNeedsReview: categoryItems.taxonomyNeedsReview.length,
    publicationExcluded: categoryItems.publicationExcluded.length,
  };
  counts.reviewOnly =
    counts.missingPrice +
    counts.inventoryConflict +
    counts.missingImage +
    counts.missingRequiredFields +
    counts.taxonomyNeedsReview +
    counts.publicationExcluded;
  counts.notPublicReady =
    counts.soldOutOfStock + counts.reviewOnly + counts.convertFailed;

  return {
    version: "smokingpipes-baseline-catchup-readiness-v1",
    generatedAt: new Date().toISOString(),
    productionWritten: false,
    counts,
    thresholds: fatalThresholds,
    convertFailedRatio,
    fatal,
    products,
    publicReadyProducts,
    categoryItems,
    samples: Object.fromEntries(
      Object.entries(categoryItems).map(([key, items]) => [
        key,
        items.slice(0, sampleLimit),
      ])
    ),
  };
}

export function buildSmokingpipesBaselineReadinessReport({
  runId,
  readiness,
  publicValidation,
}) {
  return {
    version: "smokingpipes-baseline-catchup-readiness-report-v1",
    generatedAt: new Date().toISOString(),
    runId,
    productionWritten: false,
    allowFormalApply: false,
    counts: readiness.counts,
    thresholds: readiness.thresholds,
    convertFailedRatio: readiness.convertFailedRatio,
    fatal: readiness.fatal,
    publicValidation,
    reasonDistribution: {
      soldOutOfStock: readiness.counts.soldOutOfStock,
      missingPrice: readiness.counts.missingPrice,
      inventoryConflict: readiness.counts.inventoryConflict,
      missingImage: readiness.counts.missingImage,
      missingRequiredFields: readiness.counts.missingRequiredFields,
      taxonomyNeedsReview: readiness.counts.taxonomyNeedsReview,
      publicationExcluded: readiness.counts.publicationExcluded,
      convertFailed: readiness.counts.convertFailed,
    },
    samples: readiness.samples,
  };
}

function readinessSampleLines(items) {
  if (!items?.length) return "- none";
  return items
    .map(
      (item) =>
        `- ${item.sourceProductId} | ${item.title || "(untitled)"} | ${item.reason} | price=${item.price || "(missing)"} | status=${item.status || "(missing)"} | images=${item.imageCount} | brand=${item.brand || "(missing)"} | shape=${item.shape || "(missing)"} | material=${item.material || "(missing)"} | ${item.sourceUrl || "(missing URL)"}`
    )
    .join("\n");
}

export function buildSmokingpipesBaselineReadinessMarkdown(report) {
  const counts = report.counts;
  return `# Smokingpipes Baseline Catch-Up Readiness Report

- runId: ${report.runId}
- generatedAt: ${report.generatedAt}
- total new completed: ${counts.totalCompleted}
- convert succeeded: ${counts.convertSucceeded}
- public-ready count: ${counts.publicReady}
- not-public-ready count: ${counts.notPublicReady}
- review-only count: ${counts.reviewOnly}
- sold / out-of-stock count: ${counts.soldOutOfStock}
- missing price count: ${counts.missingPrice}
- inventory conflict count: ${counts.inventoryConflict}
- missing image count: ${counts.missingImage}
- missing required fields count: ${counts.missingRequiredFields}
- taxonomy / brand needs-review count: ${counts.taxonomyNeedsReview}
- publication excluded count: ${counts.publicationExcluded}
- convert failed count: ${counts.convertFailed}
- public validation: ${report.publicValidation?.status || "not-run"}
- fatal threshold exceeded: ${report.fatal}
- allow formal apply: false
- production data written: false

## Public-Ready Samples

${readinessSampleLines(report.samples.publicReady)}

## Sold / Out-of-Stock Samples

${readinessSampleLines(report.samples.soldOutOfStock)}

## Missing Price Samples

${readinessSampleLines(report.samples.missingPrice)}

## Inventory Conflict Samples

${readinessSampleLines(report.samples.inventoryConflict)}

## Missing Image Samples

${readinessSampleLines(report.samples.missingImage)}

## Missing Required Fields Samples

${readinessSampleLines(report.samples.missingRequiredFields)}

## Taxonomy / Brand Review Samples

${readinessSampleLines(report.samples.taxonomyNeedsReview)}

## Conversion Failure Samples

${readinessSampleLines(report.samples.convertFailed)}

## Public Validation Errors

${
  report.publicValidation?.errors?.length
    ? report.publicValidation.errors.map((item) => `- ${item}`).join("\n")
    : "- none"
}
`;
}

function setInventory(product, {
  status,
  confidence,
  includedInActiveListRange,
  rawListStatus,
  reason,
}) {
  const publiclySellable = status === "available";
  const previousPublicIndexEligible =
    product.publicIndexEligible ??
    product.listingEligible ??
    product.publication?.publicIndexEligible ??
    product.publication?.listingEligible;
  const publicIndexEligible =
    publiclySellable || previousPublicIndexEligible !== false;
  const listingEligible = publicIndexEligible;
  const reasons = reason ? [reason] : [];
  return {
    ...product,
    inventoryStatus: status,
    inventoryConfidence: confidence,
    includedInActiveListRange,
    rawListStatus: text(rawListStatus),
    listingEligible,
    publicIndexEligible,
    publiclySellable,
    publication: {
      ...(product.publication || {}),
      status: publicIndexEligible ? "eligible" : "excluded",
      listingEligible,
      publicIndexEligible,
      publiclySellable,
      reason: reason || product.publication?.reason || "",
    },
    inventoryReviewReasons: reasons,
    inventoryEvidence: {
      ...(product.inventoryEvidence || {}),
      includedInActiveListRange,
      rawListStatus: text(rawListStatus),
      reasons,
    },
  };
}

function assertInventoryGate({ currentPayload, diff, inventoryValidation }) {
  const reasons = [];
  if (!currentPayload?.summary?.fullExpectedRangeScanned) {
    reasons.push("full expected page range was not scanned");
  }
  if (currentPayload?.summary?.captchaDetected) {
    reasons.push("CAPTCHA was detected");
  }
  if (!diff?.allowApply) reasons.push("inventory diff allowApply is false");
  if (!diff?.coverage?.fullExpectedRangeScanned) {
    reasons.push("diff does not confirm full expected page range");
  }
  if (diff?.fatalWarnings?.length) {
    reasons.push("inventory diff has fatal warnings");
  }
  if (
    inventoryValidation?.status !== "passed" ||
    inventoryValidation?.allowApply !== true
  ) {
    reasons.push("inventory validation did not pass");
  }
  if (reasons.length) {
    throw new Error(`Apply dry-run inventory gate blocked: ${reasons.join("; ")}`);
  }
}

function queueCounts(queue) {
  const active = (queue?.items || []).filter((item) => item.active !== false);
  const count = (status) =>
    active.filter((item) => item.status === status).length;
  return {
    total: active.length,
    completed: count("completed"),
    pending: count("pending"),
    failed: count("failed") + count("blocked"),
  };
}

export function buildSmokingpipesApplyCandidate({
  existingProducts,
  currentPayload,
  diff,
  inventoryValidation,
  queue,
  convertedNewProducts,
  conversionFailures = [],
}) {
  assertInventoryGate({ currentPayload, diff, inventoryValidation });
  const currentById = new Map(
    (currentPayload.products || []).map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const disappearedIds = new Set((diff.disappearedIds || []).map(String));
  const newIds = new Set((diff.newIds || []).map(String));
  const stats = {
    currentList: Number(
      currentPayload.summary?.uniqueProducts ||
        currentPayload.products?.length ||
        0
    ),
    newIds: newIds.size,
    outOfStockSold: 0,
    disappearedSold: 0,
    missingPriceNotSold: 0,
    soldTotal: 0,
    addedProducts: 0,
    convertSucceeded: 0,
    convertFailed: conversionFailures.length,
    queue: queueCounts(queue),
  };
  const warnings = [];
  const updatedExisting = (existingProducts || []).map((product) => {
    const id = sourceProductId(product);
    const current = currentById.get(id);

    if (!current && disappearedIds.has(id)) {
      stats.disappearedSold += 1;
      stats.soldTotal += 1;
      return setInventory(product, {
        status: "sold",
        confidence: "full-list-disappeared",
        includedInActiveListRange: false,
        rawListStatus: "",
        reason: "Product disappeared from the complete Smokingpipes current-list snapshot.",
      });
    }

    if (!current) return product;

    if (isOutOfStock(current)) {
      stats.outOfStockSold += 1;
      stats.soldTotal += 1;
      return setInventory(product, {
        status: "sold",
        confidence: "explicit-list-status",
        includedInActiveListRange: true,
        rawListStatus: current.rawListStatus,
        reason: "Smokingpipes current-list explicitly reports OUT OF STOCK / sold out.",
      });
    }

    if (!text(current.price)) {
      stats.missingPriceNotSold += 1;
      warnings.push(
        `${id}: current-list price is missing; inventory remains available`
      );
    }

    const available = setInventory(product, {
      status: "available",
      confidence: text(current.price)
        ? "full-list-present"
        : "full-list-present-price-missing",
      includedInActiveListRange: true,
      rawListStatus: current.rawListStatus,
      reason: !text(current.price)
        ? "Current-list price is missing; product remains available pending price review."
        : "",
    });
    return {
      ...available,
      sourceSpecific: {
        ...(available.sourceSpecific || {}),
        smokingpipes: {
          ...(available.sourceSpecific?.smokingpipes || {}),
          pricePending: !text(current.price),
          listRawPrice: text(current.price),
        },
      },
    };
  });

  const existingIds = new Set(updatedExisting.map(sourceProductId));
  const convertedUniqueNewProducts = (convertedNewProducts || []).filter(
    (product) => {
      const id = sourceProductId(product);
      return newIds.has(id) && !existingIds.has(id);
    }
  );
  const readiness = classifySmokingpipesBaselineProducts({
    convertedProducts: convertedUniqueNewProducts,
    currentPayload,
    conversionFailures,
  });
  stats.addedProducts = readiness.products.length;
  stats.convertSucceeded = readiness.counts.convertSucceeded;
  stats.publicReadyCount = readiness.counts.publicReady;
  stats.notPublicReadyCount = readiness.counts.notPublicReady;
  stats.reviewOnlyCount = readiness.counts.reviewOnly;
  stats.newSoldOutOfStock = readiness.counts.soldOutOfStock;
  stats.newMissingPrice = readiness.counts.missingPrice;

  const products = [...updatedExisting, ...readiness.products].sort(
    (left, right) =>
      sourceProductId(left).localeCompare(sourceProductId(right), "en", {
        numeric: true,
      })
  );
  const queueIncomplete =
    stats.queue.pending > 0 ||
    stats.queue.failed > 0 ||
    stats.queue.completed < newIds.size;
  const blockedReasons = [];
  if (queueIncomplete) blockedReasons.push("new detail queue is incomplete");
  if (readiness.fatal) {
    blockedReasons.push(
      `${conversionFailures.length} conversion failures exceed the baseline fatal threshold`
    );
  }

  return {
    version: "smokingpipes-products-next-dry-run-v1",
    generatedAt: new Date().toISOString(),
    productionWritten: false,
    products,
    recentNewProducts: readiness.publicReadyProducts,
    readiness,
    conversionFailures,
    warnings,
    blockedReasons,
    candidateReady: blockedReasons.length === 0,
    allowFormalApply: false,
    stats,
  };
}

export function validatePublicProductsNextCandidate({
  catalog,
  filters,
  brands,
  recentNew,
  smokingpipesProducts = [],
  publicReadyProducts = [],
}) {
  const errors = [];
  const catalogProducts = Array.isArray(catalog?.products)
    ? catalog.products
    : [];
  const ids = catalogProducts.map((item) => text(item.id));
  const duplicateIds = ids.filter(
    (id, index) => id && ids.indexOf(id) !== index
  );
  if (!catalogProducts.length) errors.push("catalog contains no products");
  if (duplicateIds.length) errors.push("catalog contains duplicate ids");
  if (
    catalogProducts.some(
      (item) =>
        !["available", "sold"].includes(item.inventoryStatus) ||
        !item.id ||
        !item.sourceProductId
    )
  ) {
    errors.push("catalog contains unsupported inventory status or incomplete products");
  }
  if (!Array.isArray(brands?.brands)) errors.push("brands payload is invalid");
  if (!filters?.options || typeof filters.options !== "object") {
    errors.push("filters payload is invalid");
  }
  const catalogIds = new Set(ids);
  if (
    (recentNew?.products || []).some(
      (item) => !catalogIds.has(text(item.id))
    )
  ) {
    errors.push("recent-new contains a product outside catalog");
  }
  const smokingpipesById = new Map(
    (smokingpipesProducts || []).map((item) => [text(item.id), item])
  );
  const nonPublicReadyCatalogItems = catalogProducts.filter((item) => {
    if (item.source !== "smokingpipes") return false;
    const sourceProduct = smokingpipesById.get(text(item.id));
    return (
      sourceProduct && !isSmokingpipesPublicIndexEligible(sourceProduct)
    );
  });
  if (nonPublicReadyCatalogItems.length) {
    errors.push(
      `catalog contains ${nonPublicReadyCatalogItems.length} review-only or not public-ready Smokingpipes products`
    );
  }
  const nonPublicReadyRecentItems = (recentNew?.products || []).filter(
    (item) => {
      const sourceProduct = smokingpipesById.get(text(item.id));
      return sourceProduct && !isSmokingpipesPubliclySellable(sourceProduct);
    }
  );
  if (nonPublicReadyRecentItems.length) {
    errors.push(
      `recent-new contains ${nonPublicReadyRecentItems.length} review-only or not public-ready Smokingpipes products`
    );
  }
  const expectedRecentIds = new Set(
    (publicReadyProducts || []).map((item) => text(item.id))
  );
  const actualRecentIds = new Set(
    (recentNew?.products || []).map((item) => text(item.id))
  );
  if (
    expectedRecentIds.size &&
    (expectedRecentIds.size !== actualRecentIds.size ||
      [...expectedRecentIds].some((id) => !actualRecentIds.has(id)))
  ) {
    errors.push("recent-new does not exactly match public-ready new products");
  }
  return {
    status: errors.length ? "failed" : "passed",
    errors,
    counts: {
      catalog: catalogProducts.length,
      brands: brands?.brands?.length || 0,
      recentNew: recentNew?.products?.length || 0,
      nonPublicReadyCatalog: nonPublicReadyCatalogItems.length,
      nonPublicReadyRecentNew: nonPublicReadyRecentItems.length,
    },
  };
}

export async function buildSmokingpipesApplyDryRunArtifacts({
  existingProducts,
  currentPayload,
  diff,
  inventoryValidation,
  queue,
  danishProducts,
}) {
  const newIds = new Set((diff.newIds || []).map(String));
  const completedDetails = (queue?.items || [])
    .filter(
      (item) =>
        item.active !== false &&
        item.status === "completed" &&
        item.detail &&
        newIds.has(String(item.sourceProductId))
    )
    .map((item) => item.detail);
  const currentNewProducts = (currentPayload.products || []).filter((item) =>
    newIds.has(String(item.sourceProductId))
  );
  const conversion = convertSmokingpipesCandidateDetails(
    completedDetails,
    currentNewProducts
  );
  const candidate = buildSmokingpipesApplyCandidate({
    existingProducts,
    currentPayload,
    diff,
    inventoryValidation,
    queue,
    convertedNewProducts: conversion.products,
    conversionFailures: conversion.failures,
  });
  const unifiedRows = buildUnifiedProductsFromInputs({
    danishProducts,
    smokingpipesProducts: candidate.products,
  });
  const pricingContext = await loadPublicProductsPricingContext();
  const publicBase = buildPublicProductsCandidate(
    unifiedRows,
    pricingContext
  );
  const recentNewIds = new Set(
    candidate.recentNewProducts.map((item) => item.id)
  );
  const recentNew = {
    schemaVersion: 1,
    generatedAt: candidate.generatedAt,
    source: "smokingpipes",
    products: publicBase.catalog.products.filter((item) =>
      recentNewIds.has(item.id)
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
    generatorVersion: "smokingpipes-apply-dry-run-v1",
    generatedAt: candidate.generatedAt,
    productionWritten: false,
    publicProductCount: publicBase.catalog.products.length,
    excludedProductCount: publicBase.excludedCount,
    brandCount: publicBase.brands.brands.length,
    recentNewCount: recentNew.products.length,
    baselineReadinessCounts: candidate.readiness.counts,
    validationStatus: validation.status,
  };
  const blockedReasons = [...candidate.blockedReasons];
  if (validation.status !== "passed") {
    blockedReasons.push("public-products-next validation failed");
  }

  return {
    candidate: {
      ...candidate,
      blockedReasons,
      candidateReady: blockedReasons.length === 0,
      allowFormalApply: false,
    },
    publicPayloads: {
      catalog: publicBase.catalog,
      filters: publicBase.filters,
      brands: publicBase.brands,
      recentNew,
      manifest,
      validation,
    },
    unifiedRows,
    conversion,
  };
}

export function buildSmokingpipesApplyDryRunReport({
  runId,
  artifacts,
  detailsResult,
  catchUpCurrent = false,
}) {
  const { candidate, publicPayloads } = artifacts;
  const stats = candidate.stats;
  const errors = [
    ...candidate.blockedReasons,
    ...(publicPayloads.validation.errors || []),
  ];
  return `# Smokingpipes Apply Dry-Run V1

- runId: ${runId}
- generatedAt: ${candidate.generatedAt}
- current-list count: ${stats.currentList}
- newIds count: ${stats.newIds}
- detail queue total: ${stats.queue.total}
- details attempted this run: ${detailsResult?.attempted || 0}
- details completed: ${stats.queue.completed}
- details pending: ${stats.queue.pending}
- details failed/blocked: ${stats.queue.failed}
- explicit out-of-stock sold: ${stats.outOfStockSold}
- disappeared sold candidates: ${stats.disappearedSold}
- missing-price but not sold: ${stats.missingPriceNotSold}
- new public-ready: ${stats.publicReadyCount}
- new not-public-ready: ${stats.notPublicReadyCount}
- new review-only: ${stats.reviewOnlyCount}
- new sold / out-of-stock: ${stats.newSoldOutOfStock}
- new missing price: ${stats.newMissingPrice}
- new inventory conflicts: ${candidate.readiness.counts.inventoryConflict}
- new missing image: ${candidate.readiness.counts.missingImage}
- new missing required fields: ${candidate.readiness.counts.missingRequiredFields}
- new taxonomy / brand needs-review: ${candidate.readiness.counts.taxonomyNeedsReview}
- products marked sold: ${stats.soldTotal}
- products added to candidate library: ${stats.addedProducts}
- convert succeeded: ${stats.convertSucceeded}
- convert failed: ${stats.convertFailed}
- public-products-next validation: ${publicPayloads.validation.status}
- public catalog products: ${publicPayloads.validation.counts.catalog}
- public brands: ${publicPayloads.validation.counts.brands}
- recent-new products: ${publicPayloads.validation.counts.recentNew}
- candidate ready: ${candidate.candidateReady}
- allow formal apply: ${candidate.allowFormalApply}
- final next outputs generated: true
- production data written: false

## Blocking Reasons

${errors.length ? errors.map((item) => `- ${item}`).join("\n") : "- none"}

## Warnings

${
  candidate.warnings.length
    ? candidate.warnings.map((item) => `- ${item}`).join("\n")
    : "- none"
}

## Next Step

${baselineCatchUpNextStep({
  catchUpCurrent,
  detailsComplete: true,
  outputsGenerated: true,
})}
`;
}

export function buildSmokingpipesPendingApplyDryRunReport({
  runId,
  diff,
  queueSummary,
  detailsResult,
  reasons = [],
  catchUpCurrent = false,
}) {
  return `# Smokingpipes Apply Dry-Run V1

- runId: ${runId}
- generatedAt: ${new Date().toISOString()}
- current-list count: ${diff?.counts?.currentAvailable || 0}
- newIds count: ${diff?.counts?.new || diff?.newIds?.length || 0}
- detail queue total: ${queueSummary?.activeItems || 0}
- details attempted this run: ${detailsResult?.attempted || 0}
- details completed: ${queueSummary?.completed || 0}
- details pending: ${queueSummary?.pending || 0}
- details failed/blocked: ${queueSummary?.failed || 0}
- allow formal apply: false
- final next outputs generated: false
- production data written: false

## Blocking Reasons

${reasons.length ? reasons.map((item) => `- ${item}`).join("\n") : "- none"}

## Next Step

${baselineCatchUpNextStep({
  catchUpCurrent,
  detailsComplete:
    Number(queueSummary?.remaining || 0) === 0 &&
    Number(queueSummary?.completed || 0) >=
      Number(diff?.counts?.new || diff?.newIds?.length || 0),
  outputsGenerated: false,
})}
`;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

export async function writeSmokingpipesApplyDryRunOutputs({
  paths,
  candidate,
  publicPayloads,
  report,
}) {
  if (!candidate?.candidateReady) {
    throw new Error(
      "Refusing apply-dry-run output because the candidate is not ready; baseline details are incomplete."
    );
  }
  const productionRoots = [
    path.resolve("data/products/smokingpipes-products.json"),
    path.resolve("data/generated/public-products"),
  ];
  const outputPaths = [
    paths.productsNext,
    path.join(paths.publicNextRoot, "catalog.json"),
    path.join(paths.publicNextRoot, "filters.json"),
    path.join(paths.publicNextRoot, "brands.json"),
    path.join(paths.publicNextRoot, "manifest.json"),
    path.join(paths.publicNextRoot, "recent-new.json"),
  ];
  for (const outputPath of outputPaths) {
    const resolved = path.resolve(outputPath);
    if (
      resolved === productionRoots[0] ||
      resolved === productionRoots[1] ||
      resolved.startsWith(`${productionRoots[1]}${path.sep}`)
    ) {
      throw new Error(`Refusing production apply-dry-run output: ${outputPath}`);
    }
  }

  const serialized = {
    catalog: stableJson(publicPayloads.catalog),
    filters: stableJson(publicPayloads.filters),
    brands: stableJson(publicPayloads.brands),
    recentNew: stableJson(publicPayloads.recentNew),
  };
  const manifest = {
    ...publicPayloads.manifest,
    productionWritten: false,
    fileHashes: {
      "catalog.json": sha256(serialized.catalog),
      "filters.json": sha256(serialized.filters),
      "brands.json": sha256(serialized.brands),
      "recent-new.json": sha256(serialized.recentNew),
    },
  };

  await writeJsonAtomic(paths.productsNext, candidate.products);
  await writeJsonAtomic(
    path.join(paths.publicNextRoot, "catalog.json"),
    publicPayloads.catalog
  );
  await writeJsonAtomic(
    path.join(paths.publicNextRoot, "filters.json"),
    publicPayloads.filters
  );
  await writeJsonAtomic(
    path.join(paths.publicNextRoot, "brands.json"),
    publicPayloads.brands
  );
  await writeJsonAtomic(
    path.join(paths.publicNextRoot, "recent-new.json"),
    publicPayloads.recentNew
  );
  await writeJsonAtomic(
    path.join(paths.publicNextRoot, "manifest.json"),
    manifest
  );
  await writeTextAtomic(paths.applyReport, report);

  return {
    productsNext: paths.productsNext,
    publicNextRoot: paths.publicNextRoot,
    validation: publicPayloads.validation,
    productionWritten: false,
  };
}
