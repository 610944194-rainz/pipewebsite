import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const FILES = {
  productionProducts: "data/products/smokingpipes-products.json",
  nextProducts: "data/products/smokingpipes-products-next-dry-run.json",
  productionCatalog: "data/generated/public-products/catalog.json",
  productionFilters: "data/generated/public-products/filters.json",
  productionBrands: "data/generated/public-products/brands.json",
  productionManifest: "data/generated/public-products/manifest.json",
  nextCatalog: "data/generated/public-products-next/catalog.json",
  nextFilters: "data/generated/public-products-next/filters.json",
  nextBrands: "data/generated/public-products-next/brands.json",
  nextManifest: "data/generated/public-products-next/manifest.json",
  nextRecentNew: "data/generated/public-products-next/recent-new.json",
  currentList: "data/inventory/smokingpipes-current-list-dry-run.json",
  diff: "data/inventory/smokingpipes-inventory-diff-dry-run.json",
  readiness:
    "data/review/smokingpipes-baseline-catchup-readiness-report.json",
  jsonReport:
    "data/review/smokingpipes-next-dry-run-audit-report.json",
  markdownReport:
    "data/review/smokingpipes-next-dry-run-audit-report.md",
};

// Captured before the baseline catch-up candidate was generated.
const EXPECTED_PRODUCTION_HASHES = {
  [FILES.productionProducts]:
    "D3F0772472CD30683A93EB27ED497956577E352B3D9ADE3ED81DB25E6992B9C7",
  [FILES.productionCatalog]:
    "0F8468E754DA404F8B6CCCA579F795466A68B7523C92BEA8E8A2216D8B70D2B7",
  [FILES.productionFilters]:
    "97C129A6B19385ECA3618F800532D1814F5060A87167180F9F5E841385562360",
  [FILES.productionBrands]:
    "8BD658A3C016AD7A311FB75A956CB1A6D02F55056EF23FB15CB29827A3F12011",
  [FILES.productionManifest]:
    "0E4BB9C7142CFE33DA024C94EE2A35A0ACBD88ADCC1618288CAFFE637395BC56",
};

function absolute(relativePath) {
  return path.join(ROOT, relativePath);
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(absolute(relativePath), "utf8"));
}

function items(payload, preferredKey = "products") {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[preferredKey])) return payload[preferredKey];
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function text(value) {
  return String(value ?? "").trim();
}

function sourceProductId(product) {
  return text(product?.sourceProductId);
}

function category(product) {
  return text(
    product?.sourceSpecific?.smokingpipes?.baselineReadinessCategory
  );
}

function categoryReason(product) {
  return text(
    product?.sourceSpecific?.smokingpipes?.baselineReadinessReason
  );
}

function countBy(records, getter) {
  const counts = {};
  for (const record of records) {
    const key = text(getter(record)) || "(missing)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en")
    )
  );
}

function duplicates(records, getter) {
  const groups = new Map();
  for (const record of records) {
    const key = text(getter(record));
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      count: group.length,
      ids: group.slice(0, 20).map((record) => text(record.id)),
    }));
}

function isUnavailable(status) {
  return ["sold", "unavailable", "out-of-stock", "out_of_stock"].includes(
    text(status).toLowerCase()
  );
}

function sampleProduct(product, currentById) {
  const id = sourceProductId(product);
  const current = currentById.get(id) || {};
  const currentPrice = text(current.price);
  const detailAmount = product?.price?.current?.amount ?? null;
  const detailCurrency = text(product?.price?.current?.currency);
  const detailRaw = text(product?.price?.current?.rawText);
  return {
    sourceProductId: id,
    rawTitle: text(product?.rawTitle || product?.fullTitle),
    displayNameZh: text(product?.displayNameZh) || null,
    brand: text(product?.canonicalBrand || product?.brand) || null,
    price: {
      currentListRaw: currentPrice || null,
      detailRaw: detailRaw || null,
      amount:
        typeof detailAmount === "number" && Number.isFinite(detailAmount)
          ? detailAmount
          : null,
      currency: detailCurrency || null,
    },
    mainImageExists: Boolean(
      text(
        product?.mainImageUrl ||
          product?.detailImageUrl ||
          product?.imageUrl
      )
    ),
    status: text(product?.inventoryStatus) || null,
    reviewReason:
      categoryReason(product) ||
      text(product?.inventoryReviewReasons?.[0]) ||
      null,
    sourceUrl: text(product?.sourceUrl) || null,
  };
}

function sampleConversionFailure(sample) {
  return {
    sourceProductId: text(sample?.sourceProductId),
    rawTitle: text(sample?.title),
    displayNameZh: null,
    brand: text(sample?.brand) || null,
    price: {
      currentListRaw: text(sample?.price) || null,
      detailRaw: null,
      amount: null,
      currency: null,
    },
    mainImageExists: Boolean(sample?.hasMainImage),
    status: text(sample?.status) || "convert-failed",
    reviewReason: text(sample?.reason) || "conversion failed",
    sourceUrl: text(sample?.sourceUrl) || null,
  };
}

function soldSample(before, after) {
  return {
    sourceProductId: sourceProductId(after || before),
    rawTitle: text(before?.rawTitle || before?.displayNameEn),
    displayNameZh: text(before?.displayNameZh) || null,
    brand: text(before?.canonicalBrand || before?.brand) || null,
    previousStatus: text(before?.inventoryStatus) || null,
    nextStatus: text(after?.inventoryStatus) || null,
    inventoryConfidence: text(after?.inventoryConfidence) || null,
    reason:
      text(after?.inventoryReviewReasons?.[0]) ||
      text(after?.inventoryEvidence?.reasons?.[0]) ||
      null,
    sourceUrl: text(before?.sourceUrl || after?.sourceUrl) || null,
  };
}

async function sha256(relativePath) {
  const content = await fs.readFile(absolute(relativePath));
  return createHash("sha256").update(content).digest("hex").toUpperCase();
}

function markdownCell(value) {
  return text(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function displayPrice(sample) {
  const price = sample?.price || {};
  if (price.currentListRaw) return price.currentListRaw;
  if (price.detailRaw) return price.detailRaw;
  if (price.amount !== null && price.amount !== undefined) {
    return `${price.currency || ""} ${price.amount}`.trim();
  }
  return "(missing)";
}

function sampleTable(samples) {
  if (!samples.length) return "_No samples._";
  const rows = samples.map(
    (sample) =>
      `| ${markdownCell(sample.sourceProductId)} | ${markdownCell(
        sample.rawTitle
      )} | ${markdownCell(sample.displayNameZh || "")} | ${markdownCell(
        sample.brand || ""
      )} | ${markdownCell(displayPrice(sample))} | ${
        sample.mainImageExists ? "yes" : "no"
      } | ${markdownCell(sample.status || "")} | ${markdownCell(
        sample.reviewReason || ""
      )} | ${markdownCell(sample.sourceUrl || "")} |`
  );
  return [
    "| sourceProductId | English title | Chinese display name | brand | price | main image | status | review reason | sourceUrl |",
    "|---|---|---|---|---:|:---:|---|---|---|",
    ...rows,
  ].join("\n");
}

function soldTable(samples) {
  if (!samples.length) return "_No samples._";
  return [
    "| sourceProductId | English title | brand | previous status | candidate status | confidence | reason | sourceUrl |",
    "|---|---|---|---|---|---|---|---|",
    ...samples.map(
      (sample) =>
        `| ${markdownCell(sample.sourceProductId)} | ${markdownCell(
          sample.rawTitle
        )} | ${markdownCell(sample.brand || "")} | ${markdownCell(
          sample.previousStatus || ""
        )} | ${markdownCell(sample.nextStatus || "")} | ${markdownCell(
          sample.inventoryConfidence || ""
        )} | ${markdownCell(sample.reason || "")} | ${markdownCell(
          sample.sourceUrl || ""
        )} |`
    ),
  ].join("\n");
}

async function writeReport(relativePath, content) {
  const target = absolute(relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function main() {
  const [
    productionProductsPayload,
    nextProductsPayload,
    productionCatalogPayload,
    nextCatalogPayload,
    nextFilters,
    nextBrands,
    nextManifest,
    nextRecentNewPayload,
    currentListPayload,
    diff,
    readiness,
  ] = await Promise.all([
    readJson(FILES.productionProducts),
    readJson(FILES.nextProducts),
    readJson(FILES.productionCatalog),
    readJson(FILES.nextCatalog),
    readJson(FILES.nextFilters),
    readJson(FILES.nextBrands),
    readJson(FILES.nextManifest),
    readJson(FILES.nextRecentNew),
    readJson(FILES.currentList),
    readJson(FILES.diff),
    readJson(FILES.readiness),
  ]);

  // Parse-only validation for production/supporting JSON files.
  await Promise.all([
    readJson(FILES.productionFilters),
    readJson(FILES.productionBrands),
    readJson(FILES.productionManifest),
  ]);

  const productionProducts = items(productionProductsPayload);
  const nextProducts = items(nextProductsPayload);
  const productionCatalog = items(productionCatalogPayload);
  const nextCatalog = items(nextCatalogPayload);
  const recentNew = items(nextRecentNewPayload);
  const currentList = items(currentListPayload);
  const currentById = new Map(
    currentList.map((product) => [sourceProductId(product), product])
  );
  const productionProductById = new Map(
    productionProducts.map((product) => [sourceProductId(product), product])
  );
  const nextProductById = new Map(
    nextProducts.map((product) => [sourceProductId(product), product])
  );
  const productionProductIds = new Set(productionProductById.keys());
  const productionCatalogIds = new Set(
    productionCatalog.map((product) => text(product.id))
  );
  const nextCatalogIds = new Set(nextCatalog.map((product) => text(product.id)));
  const nextCatalogSourceIds = new Set(
    nextCatalog
      .filter((product) => product.source === "smokingpipes")
      .map(sourceProductId)
  );
  const newProducts = nextProducts.filter(
    (product) => !productionProductIds.has(sourceProductId(product))
  );
  const addedCatalog = nextCatalog.filter(
    (product) => !productionCatalogIds.has(text(product.id))
  );
  const removedCatalog = productionCatalog.filter(
    (product) => !nextCatalogIds.has(text(product.id))
  );
  const addedNewProducts = addedCatalog.filter(
    (product) =>
      product.source === "smokingpipes" &&
      !productionProductIds.has(sourceProductId(product))
  );
  const reintroducedExisting = addedCatalog.filter(
    (product) =>
      product.source === "smokingpipes" &&
      productionProductIds.has(sourceProductId(product))
  );

  const categoryNames = [
    "publicReady",
    "soldOutOfStock",
    "missingPrice",
    "inventoryConflict",
    "missingImage",
    "missingRequiredFields",
    "taxonomyNeedsReview",
    "publicationExcluded",
    "convertFailed",
  ];
  const categoryProducts = Object.fromEntries(
    categoryNames.map((name) => [
      name,
      name === "convertFailed"
        ? []
        : newProducts.filter((product) => category(product) === name),
    ])
  );
  const categorySamples = Object.fromEntries(
    categoryNames.map((name) => [
      name,
      name === "convertFailed"
        ? (readiness.samples?.convertFailed || [])
            .slice(0, 20)
            .map(sampleConversionFailure)
        : categoryProducts[name]
            .slice(0, 20)
            .map((product) => sampleProduct(product, currentById)),
    ])
  );
  const categoryCounts = Object.fromEntries(
    categoryNames.map((name) => [
      name,
      name === "convertFailed"
        ? Number(readiness.counts?.convertFailed || 0)
        : categoryProducts[name].length,
    ])
  );
  categoryCounts.reviewOnly =
    categoryCounts.missingPrice +
    categoryCounts.inventoryConflict +
    categoryCounts.missingImage +
    categoryCounts.missingRequiredFields +
    categoryCounts.taxonomyNeedsReview +
    categoryCounts.publicationExcluded;

  const reviewOnlyCategories = new Set([
    "missingPrice",
    "inventoryConflict",
    "missingImage",
    "missingRequiredFields",
    "taxonomyNeedsReview",
    "publicationExcluded",
  ]);
  categorySamples.reviewOnly = newProducts
    .filter((product) => reviewOnlyCategories.has(category(product)))
    .slice(0, 20)
    .map((product) => sampleProduct(product, currentById));
  const reviewOnlyLeaks = newProducts
    .filter(
      (product) =>
        reviewOnlyCategories.has(category(product)) &&
        nextCatalogSourceIds.has(sourceProductId(product))
    )
    .map((product) => sampleProduct(product, currentById));
  const inventoryConflictLeaks = categoryProducts.inventoryConflict.filter(
    (product) => nextCatalogSourceIds.has(sourceProductId(product))
  );
  const missingPriceMarkedSold = categoryProducts.missingPrice.filter(
    (product) => isUnavailable(product.inventoryStatus)
  );

  const disappearedIds = new Set((diff.disappearedIds || []).map(String));
  const existingSold = nextProducts.filter(
    (product) =>
      productionProductIds.has(sourceProductId(product)) &&
      isUnavailable(product.inventoryStatus)
  );
  const existingSoldSamples = existingSold
    .slice(0, 20)
    .map((product) =>
      soldSample(productionProductById.get(sourceProductId(product)), product)
    );

  const duplicateIds = duplicates(nextCatalog, (product) => product.id);
  const duplicateScopedSourceIds = duplicates(
    nextCatalog,
    (product) => `${product.source}:${product.sourceProductId}`
  );
  const duplicateSourceProductIds = duplicates(
    nextCatalog,
    (product) => product.sourceProductId
  );
  const productsWithSlug = nextCatalog.filter((product) =>
    text(product.slug)
  );
  const duplicateProductSlugs = duplicates(
    productsWithSlug,
    (product) => product.slug
  );
  const missingImage = nextCatalog.filter(
    (product) => !text(product.mainImage)
  );
  const legacyExistingMissingImage = missingImage.filter((product) =>
    productionCatalogIds.has(text(product.id))
  );
  const newIntroducedMissingImage = missingImage.filter(
    (product) => !productionCatalogIds.has(text(product.id))
  );
  const missingSourcePrice = nextCatalog.filter(
    (product) => !(Number(product.sourcePriceAmount) > 0)
  );
  const newIntroducedMissingSourcePrice = missingSourcePrice.filter(
    (product) => !productionCatalogIds.has(text(product.id))
  );
  const legacyMissingSourcePrice = missingSourcePrice.filter((product) =>
    productionCatalogIds.has(text(product.id))
  );
  const missingDisplayPrice = nextCatalog.filter(
    (product) =>
      !(Number(product.siteDisplayAmount) > 0) ||
      product.siteDisplayReady !== true
  );
  const newIntroducedMissingDisplayPrice = missingDisplayPrice.filter(
    (product) => !productionCatalogIds.has(text(product.id))
  );
  const legacyMissingDisplayPrice = missingDisplayPrice.filter((product) =>
    productionCatalogIds.has(text(product.id))
  );
  const missingBrand = nextCatalog.filter(
    (product) => !text(product.brandName)
  );
  const newIntroducedMissingBrand = missingBrand.filter(
    (product) => !productionCatalogIds.has(text(product.id))
  );
  const legacyMissingBrand = missingBrand.filter((product) =>
    productionCatalogIds.has(text(product.id))
  );
  const missingTitle = nextCatalog.filter(
    (product) =>
      ![product.displayName, product.displayNameEn, product.rawTitle].some(
        (value) => text(value)
      )
  );
  const newIntroducedMissingTitle = missingTitle.filter(
    (product) => !productionCatalogIds.has(text(product.id))
  );
  const legacyMissingTitle = missingTitle.filter((product) =>
    productionCatalogIds.has(text(product.id))
  );
  const availableMissingOrZeroPrice = nextCatalog.filter(
    (product) =>
      product.inventoryStatus === "available" &&
      (!(Number(product.sourcePriceAmount) > 0) ||
        !(Number(product.siteDisplayAmount) > 0) ||
        product.siteDisplayReady !== true)
  );
  const missingBrandSlug = nextCatalog.filter(
    (product) => !text(product.brandSlug)
  );
  const soldCatalogProducts = nextCatalog.filter((product) =>
    isUnavailable(product.inventoryStatus)
  );
  const soldEligibilityMismatches = soldCatalogProducts.filter(
    (product) =>
      product.publicIndexEligible !== true ||
      product.publiclySellable !== false
  );
  const disappearedMissingFromCatalog = [...disappearedIds].filter(
    (id) => !nextCatalogSourceIds.has(id)
  );
  const productionDanishSold = productionCatalog.filter(
    (product) =>
      product.source === "danish" &&
      isUnavailable(product.inventoryStatus)
  );
  const nextDanishSoldIds = new Set(
    nextCatalog
      .filter(
        (product) =>
          product.source === "danish" &&
          isUnavailable(product.inventoryStatus)
      )
      .map((product) => text(product.id))
  );
  const danishSoldMissingFromCatalog = productionDanishSold.filter(
    (product) => !nextDanishSoldIds.has(text(product.id))
  );
  const publicReadyIds = new Set(
    categoryProducts.publicReady.map((product) => text(product.id))
  );
  const recentNewIds = new Set(recentNew.map((product) => text(product.id)));
  const recentNewMatchesPublicReady =
    publicReadyIds.size === recentNewIds.size &&
    [...publicReadyIds].every((id) => recentNewIds.has(id));

  const productionHashes = {};
  for (const [relativePath, expected] of Object.entries(
    EXPECTED_PRODUCTION_HASHES
  )) {
    const actual = await sha256(relativePath);
    productionHashes[relativePath] = {
      expected,
      actual,
      unchanged: actual === expected,
    };
  }
  const allProductionHashesUnchanged = Object.values(productionHashes).every(
    (entry) => entry.unchanged
  );

  const arithmetic = {
    productionProducts: productionProducts.length,
    nextProducts: nextProducts.length,
    productsDelta: nextProducts.length - productionProducts.length,
    nextEqualsProductionPlus641:
      nextProducts.length === productionProducts.length + 641,
    productionCatalog: productionCatalog.length,
    nextCatalog: nextCatalog.length,
    catalogDelta: nextCatalog.length - productionCatalog.length,
    catalogAdded: addedCatalog.length,
    catalogRemoved: removedCatalog.length,
    catalogAddedBreakdown: {
      intendedPublicReadyNew: addedNewProducts.filter(
        (product) =>
          category(nextProductById.get(sourceProductId(product))) ===
          "publicReady"
      ).length,
      unintendedReviewOnlyNew: addedNewProducts.filter((product) =>
        reviewOnlyCategories.has(
          category(nextProductById.get(sourceProductId(product)))
        )
      ).length,
      existingSmokingpipesReintroduced: reintroducedExisting.length,
    },
    catalogRemovedBreakdown: countBy(
      removedCatalog,
      (product) => product.source
    ),
    recentNew: recentNew.length,
    recentNewEquals295: recentNew.length === 295,
    recentNewMatchesPublicReady,
  };

  const publicAudit = {
    jsonParsed: {
      catalog: true,
      filters: Boolean(nextFilters && typeof nextFilters === "object"),
      brands: Boolean(nextBrands && typeof nextBrands === "object"),
      manifest: Boolean(nextManifest && typeof nextManifest === "object"),
      recentNew: Boolean(
        nextRecentNewPayload && typeof nextRecentNewPayload === "object"
      ),
    },
    counts: {
      catalog: nextCatalog.length,
      filters:
        Object.values(nextFilters?.options || {}).reduce(
          (sum, values) => sum + (Array.isArray(values) ? values.length : 0),
          0
        ) || 0,
      brands: items(nextBrands, "brands").length,
      recentNew: recentNew.length,
    },
    duplicates: {
      id: duplicateIds,
      scopedSourceProductId: duplicateScopedSourceIds,
      sourceProductId: duplicateSourceProductIds,
      productSlug: duplicateProductSlugs,
    },
    productSlugSchema: {
      fieldPresentCount: productsWithSlug.length,
      missingCount: nextCatalog.length - productsWithSlug.length,
      note:
        "Current public catalog schema has no product-level slug field; product routes use id. brandSlug is audited separately.",
    },
    missingFields: {
      image: {
        count: missingImage.length,
        newIntroducedCount: newIntroducedMissingImage.length,
        newIntroducedIds: newIntroducedMissingImage.map((product) =>
          text(product.id)
        ),
        legacyExistingCount: legacyExistingMissingImage.length,
        legacyExistingIds: legacyExistingMissingImage.map((product) =>
          text(product.id)
        ),
        bySource: countBy(missingImage, (product) => product.source),
        ids: missingImage.map((product) => text(product.id)),
      },
      sourcePrice: {
        count: missingSourcePrice.length,
        newIntroducedCount: newIntroducedMissingSourcePrice.length,
        legacyExistingCount: legacyMissingSourcePrice.length,
        ids: missingSourcePrice.map((product) => text(product.id)),
      },
      displayPrice: {
        count: missingDisplayPrice.length,
        newIntroducedCount: newIntroducedMissingDisplayPrice.length,
        legacyExistingCount: legacyMissingDisplayPrice.length,
        ids: missingDisplayPrice.map((product) => text(product.id)),
      },
      brand: {
        count: missingBrand.length,
        newIntroducedCount: newIntroducedMissingBrand.length,
        legacyExistingCount: legacyMissingBrand.length,
        ids: missingBrand.map((product) => text(product.id)),
      },
      title: {
        count: missingTitle.length,
        newIntroducedCount: newIntroducedMissingTitle.length,
        legacyExistingCount: legacyMissingTitle.length,
        ids: missingTitle.map((product) => text(product.id)),
      },
      brandSlug: {
        count: missingBrandSlug.length,
        bySource: countBy(missingBrandSlug, (product) => product.source),
        ids: missingBrandSlug.map((product) => text(product.id)),
      },
    },
    reviewOnlyLeakCount: reviewOnlyLeaks.length,
    reviewOnlyLeaks,
    inventoryConflictLeakCount: inventoryConflictLeaks.length,
    soldUnavailableCount: soldCatalogProducts.length,
    soldUnavailableBySource: countBy(
      soldCatalogProducts,
      (product) => product.source
    ),
    soldEligibilityMismatchCount: soldEligibilityMismatches.length,
    soldEligibilityMismatchIds: soldEligibilityMismatches.map((product) =>
      text(product.id)
    ),
    recentNewSoldUnavailableCount: recentNew.filter((product) =>
      isUnavailable(product.inventoryStatus)
    ).length,
    availableMissingOrZeroPriceCount: availableMissingOrZeroPrice.length,
    availableMissingOrZeroPriceIds: availableMissingOrZeroPrice.map(
      (product) => text(product.id)
    ),
    manifestValidationStatus: text(nextManifest.validationStatus),
  };

  const inventoryAudit = {
    currentListCount: currentList.length,
    fullExpectedRangeScanned:
      currentListPayload.fullExpectedRangeScanned === true ||
      currentListPayload.summary?.fullExpectedRangeScanned === true,
    disappearedCount: disappearedIds.size,
    existingSoldUnavailableCount: existingSold.length,
    existingSoldIdsEqualDisappearedIds:
      existingSold.length === disappearedIds.size &&
      existingSold.every((product) =>
        disappearedIds.has(sourceProductId(product))
      ) &&
      [...disappearedIds].every((id) =>
        existingSold.some((product) => sourceProductId(product) === id)
      ),
    existingSoldSamples,
    newExplicitOutOfStockCount: categoryCounts.soldOutOfStock,
    missingPriceMarkedSoldCount: missingPriceMarkedSold.length,
    inventoryConflictCount: categoryCounts.inventoryConflict,
    inventoryConflictInPublicCatalog: inventoryConflictLeaks.length,
    disappearedInPublicCatalog:
      disappearedIds.size - disappearedMissingFromCatalog.length,
    disappearedMissingFromPublicCatalog: disappearedMissingFromCatalog,
    productionDanishSoldCount: productionDanishSold.length,
    retainedDanishSoldCount:
      productionDanishSold.length - danishSoldMissingFromCatalog.length,
    danishSoldMissingFromPublicCatalog: danishSoldMissingFromCatalog.map(
      (product) => text(product.id)
    ),
  };

  const blockers = [];
  const warnings = [];
  if (!arithmetic.nextEqualsProductionPlus641) {
    blockers.push("next products count is not production + 641");
  }
  if (
    categoryCounts.publicReady !== 295 ||
    categoryCounts.reviewOnly !== 346 ||
    categoryCounts.convertFailed !== 0
  ) {
    blockers.push("recomputed readiness category counts do not match baseline");
  }
  if (!recentNewMatchesPublicReady) {
    blockers.push("recent-new ids do not exactly match public-ready ids");
  }
  if (reviewOnlyLeaks.length) {
    blockers.push(
      `${reviewOnlyLeaks.length} review-only products leaked into public catalog`
    );
  }
  if (soldEligibilityMismatches.length) {
    blockers.push(
      `${soldEligibilityMismatches.length} sold products have invalid publicIndexEligible/publiclySellable flags`
    );
  }
  if (duplicateIds.length || duplicateScopedSourceIds.length) {
    blockers.push("public catalog contains duplicate identity keys");
  }
  if (
    newIntroducedMissingSourcePrice.length ||
    newIntroducedMissingDisplayPrice.length ||
    newIntroducedMissingBrand.length ||
    newIntroducedMissingTitle.length
  ) {
    blockers.push(
      "this candidate introduces public catalog records with missing required display fields"
    );
  }
  if (availableMissingOrZeroPrice.length) {
    blockers.push(
      `${availableMissingOrZeroPrice.length} available products have missing, pending, or zero display price`
    );
  }
  if (newIntroducedMissingImage.length) {
    blockers.push(
      `${newIntroducedMissingImage.length} newly introduced public catalog products have no main image`
    );
  }
  if (!inventoryAudit.existingSoldIdsEqualDisappearedIds) {
    blockers.push(
      "existing sold/unavailable set does not exactly match disappearedIds"
    );
  }
  if (disappearedMissingFromCatalog.length) {
    blockers.push(
      `${disappearedMissingFromCatalog.length} disappeared Smokingpipes products are missing from public catalog`
    );
  }
  if (danishSoldMissingFromCatalog.length) {
    blockers.push(
      `${danishSoldMissingFromCatalog.length} legacy Danish sold products are missing from public catalog`
    );
  }
  if (publicAudit.recentNewSoldUnavailableCount) {
    blockers.push("recent-new contains sold/unavailable products");
  }
  if (!allProductionHashesUnchanged) {
    blockers.push("one or more production file hashes changed");
  }
  if (inventoryConflictLeaks.length) {
    blockers.push("inventory-conflict products leaked into public catalog");
  }
  if (missingBrandSlug.length) {
    warnings.push(
      `${missingBrandSlug.length} public records have no brandSlug (all are audited by source)`
    );
  }
  if (legacyExistingMissingImage.length) {
    warnings.push(
      `${legacyExistingMissingImage.length} legacy public records still have no main image`
    );
  }
  if (
    legacyMissingSourcePrice.length ||
    legacyMissingDisplayPrice.length ||
    legacyMissingBrand.length ||
    legacyMissingTitle.length
  ) {
    warnings.push(
      `${legacyMissingSourcePrice.length + legacyMissingDisplayPrice.length + legacyMissingBrand.length + legacyMissingTitle.length} legacy public field issues remain from the production catalog`
    );
  }
  if (!productsWithSlug.length) {
    warnings.push(
      "product-level slug is absent by current schema; id is the product route key"
    );
  }
  if (categoryCounts.reviewOnly) {
    warnings.push(
      `${categoryCounts.reviewOnly} new products remain review-only and require manual review`
    );
  }
  if (categoryCounts.inventoryConflict) {
    warnings.push(
      `${categoryCounts.inventoryConflict} inventory conflicts should remain excluded until detail/current-list signals are reconciled`
    );
  }

  const verdict = blockers.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  const report = {
    version: "smokingpipes-next-dry-run-audit-v1",
    generatedAt: new Date().toISOString(),
    offlineOnly: true,
    productionWritten: false,
    formalApplyExecuted: false,
    verdict,
    conclusion:
      verdict === "FAIL"
        ? "Do not proceed to formal apply. Fix the review-only public catalog leak and regenerate the candidate."
        : verdict === "WARN"
          ? "The candidate can proceed to manual sampling, but review-only and inventory-conflict records still require review."
          : "The candidate can proceed to manual sampling.",
    blockers,
    warnings,
    arithmetic,
    readiness: {
      reportedCounts: readiness.counts,
      recomputedCounts: categoryCounts,
      countsMatch:
        categoryCounts.publicReady === readiness.counts?.publicReady &&
        categoryCounts.reviewOnly === readiness.counts?.reviewOnly &&
        categoryCounts.missingPrice === readiness.counts?.missingPrice &&
        categoryCounts.inventoryConflict ===
          readiness.counts?.inventoryConflict &&
        categoryCounts.missingImage === readiness.counts?.missingImage &&
        categoryCounts.missingRequiredFields ===
          readiness.counts?.missingRequiredFields &&
        categoryCounts.taxonomyNeedsReview ===
          readiness.counts?.taxonomyNeedsReview &&
        categoryCounts.convertFailed === readiness.counts?.convertFailed,
      samples: categorySamples,
    },
    inventory: inventoryAudit,
    publicProductsNext: publicAudit,
    productionProtection: {
      allHashesUnchanged: allProductionHashesUnchanged,
      hashes: productionHashes,
    },
    recommendations: [
      "Review the candidate before formal apply.",
      "Keep publicIndexEligible and publiclySellable as separate inventory concepts.",
      "Keep all 119 inventoryConflict records excluded; reconcile current-list presence against detail-page inventory evidence before promotion.",
      "Keep sold references indexed but exclude them from recent-new and available-only recommendations.",
      "Review legacy Danish missing-image records separately.",
    ],
  };

  const categorySections = [...categoryNames, "reviewOnly"]
    .map(
      (name) => `### ${name} (${categoryCounts[name] || 0})

${sampleTable(categorySamples[name] || [])}`
    )
    .join("\n\n");
  const hashRows = Object.entries(productionHashes).map(
    ([file, hash]) =>
      `| ${markdownCell(file)} | ${hash.expected} | ${hash.actual} | ${
        hash.unchanged ? "yes" : "no"
      } |`
  );
  const markdown = `# Smokingpipes Next Dry-Run Audit Report

- generatedAt: ${report.generatedAt}
- audit mode: offline only
- productionWritten: false
- formal apply executed: false
- verdict: **${verdict}**

## Conclusion

${report.conclusion}

### Blocking issues

${blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- none"}

### Warnings

${warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- none"}

## 1. Count consistency

| Item | Count |
|---|---:|
| production Smokingpipes products | ${arithmetic.productionProducts} |
| next Smokingpipes products | ${arithmetic.nextProducts} |
| products delta | ${arithmetic.productsDelta} |
| production public catalog | ${arithmetic.productionCatalog} |
| next public catalog | ${arithmetic.nextCatalog} |
| catalog delta | ${arithmetic.catalogDelta} |
| catalog added | ${arithmetic.catalogAdded} |
| catalog removed | ${arithmetic.catalogRemoved} |
| recent-new | ${arithmetic.recentNew} |

- next products = production + 641: ${
    arithmetic.nextEqualsProductionPlus641 ? "yes" : "no"
  }
- catalog additions include public-ready new products and existing Smokingpipes records restored by current canonical/public rules.
- catalog removals should not include disappeared Smokingpipes or legacy Danish sold references.
- recent-new = 295: ${arithmetic.recentNewEquals295 ? "yes" : "no"}
- recent-new ids exactly match all 295 public-ready ids: ${
    arithmetic.recentNewMatchesPublicReady ? "yes" : "no"
  }
- duplicate id: ${duplicateIds.length}
- duplicate scoped sourceProductId: ${duplicateScopedSourceIds.length}
- duplicate global sourceProductId: ${duplicateSourceProductIds.length}
- product-level slug: current schema does not provide it; routes use product id. Duplicate product slug count among present values: ${duplicateProductSlugs.length}.

## 2. New product classification audit

| Category | readiness report | recomputed |
|---|---:|---:|
| public-ready | ${readiness.counts?.publicReady ?? 0} | ${categoryCounts.publicReady} |
| sold / OUT OF STOCK | ${readiness.counts?.soldOutOfStock ?? 0} | ${categoryCounts.soldOutOfStock} |
| missing price | ${readiness.counts?.missingPrice ?? 0} | ${categoryCounts.missingPrice} |
| inventory conflict | ${readiness.counts?.inventoryConflict ?? 0} | ${categoryCounts.inventoryConflict} |
| missing image | ${readiness.counts?.missingImage ?? 0} | ${categoryCounts.missingImage} |
| missing required fields | ${readiness.counts?.missingRequiredFields ?? 0} | ${categoryCounts.missingRequiredFields} |
| taxonomy / brand needs-review | ${readiness.counts?.taxonomyNeedsReview ?? 0} | ${categoryCounts.taxonomyNeedsReview} |
| convert failed | ${readiness.counts?.convertFailed ?? 0} | ${categoryCounts.convertFailed} |
| review-only | ${readiness.counts?.reviewOnly ?? 0} | ${categoryCounts.reviewOnly} |

${categorySections}

## 3. Inventory status audit

- new explicit OUT OF STOCK: ${inventoryAudit.newExplicitOutOfStockCount}
- disappeared sold candidates: ${inventoryAudit.disappearedCount}
- existing sold/unavailable in next products: ${inventoryAudit.existingSoldUnavailableCount}
- sold set exactly equals disappearedIds: ${
    inventoryAudit.existingSoldIdsEqualDisappearedIds ? "yes" : "no"
  }
- missing-price new products marked sold: ${inventoryAudit.missingPriceMarkedSoldCount}
- inventory conflicts: ${inventoryAudit.inventoryConflictCount}
- inventory conflicts in public catalog: ${inventoryAudit.inventoryConflictInPublicCatalog}
- disappeared Smokingpipes retained in public catalog: ${inventoryAudit.disappearedInPublicCatalog}/${inventoryAudit.disappearedCount}
- legacy Danish sold retained in public catalog: ${inventoryAudit.retainedDanishSoldCount}/${inventoryAudit.productionDanishSoldCount}

### Existing disappeared/sold samples (first 20)

${soldTable(existingSoldSamples)}

## 4. public-products-next validation

| Check | Result |
|---|---:|
| catalog/filters/brands/manifest/recent-new parse successfully | yes |
| catalog products | ${nextCatalog.length} |
| brands | ${publicAudit.counts.brands} |
| recent-new | ${publicAudit.counts.recentNew} |
| duplicate id | ${duplicateIds.length} |
| duplicate scoped sourceProductId | ${duplicateScopedSourceIds.length} |
| missing main image (total) | ${missingImage.length} |
| missing main image (newly introduced) | ${newIntroducedMissingImage.length} |
| missing main image (legacy existing) | ${legacyExistingMissingImage.length} |
| missing source price | ${missingSourcePrice.length} |
| missing source price (newly introduced) | ${newIntroducedMissingSourcePrice.length} |
| missing display price / not ready | ${missingDisplayPrice.length} |
| missing display price / not ready (newly introduced) | ${newIntroducedMissingDisplayPrice.length} |
| available missing/pending/zero price | ${availableMissingOrZeroPrice.length} |
| missing brand | ${missingBrand.length} |
| missing title | ${missingTitle.length} |
| missing brandSlug | ${missingBrandSlug.length} |
| review-only leak | ${reviewOnlyLeaks.length} |
| inventory-conflict leak | ${inventoryConflictLeaks.length} |
| sold/unavailable retained in catalog | ${soldCatalogProducts.length} |
| sold eligibility flag mismatch | ${soldEligibilityMismatches.length} |
| sold/unavailable in recent-new | ${publicAudit.recentNewSoldUnavailableCount} |

### Review-only records incorrectly present in public catalog

${sampleTable(reviewOnlyLeaks)}

### Missing-image distribution

${Object.entries(publicAudit.missingFields.image.bySource)
  .map(([source, count]) => `- ${source}: ${count}`)
  .join("\n")}

### Missing-brandSlug distribution

${Object.entries(publicAudit.missingFields.brandSlug.bySource)
  .map(([source, count]) => `- ${source}: ${count}`)
  .join("\n")}

## 5. Production file protection

| File | pre-candidate hash | current hash | unchanged |
|---|---|---|:---:|
${hashRows.join("\n")}

- all production hashes unchanged: ${
    allProductionHashesUnchanged ? "yes" : "no"
  }

## 6. Recommendations

1. Review the candidate before formal apply.
2. Preserve publicIndexEligible for reference visibility and use publiclySellable for active inventory/recommendations.
3. Keep all 119 inventory-conflict records private until detail and current-list signals are reconciled.
4. Require zero review-only leaks and zero sold/unavailable records in recent-new.
5. Review the legacy Danish missing-image records and Danish records without brandSlug in a separate cleanup; they do not block this Smokingpipes candidate.
`;

  await writeReport(FILES.jsonReport, `${JSON.stringify(report, null, 2)}\n`);
  await writeReport(FILES.markdownReport, markdown);
  console.log(
    JSON.stringify(
      {
        verdict,
        blockers,
        warnings,
        arithmetic,
        reviewOnlyLeakCount: reviewOnlyLeaks.length,
        inventoryConflictLeakCount: inventoryConflictLeaks.length,
        soldUnavailableCount: soldCatalogProducts.length,
        productionHashesUnchanged: allProductionHashesUnchanged,
        reports: [FILES.markdownReport, FILES.jsonReport],
      },
      null,
      2
    )
  );
  if (verdict === "FAIL") process.exitCode = 2;
}

await main();
