import {
  classifySmokingpipesBrandExclusion,
} from "./smokingpipes-brand-exclusions-v1.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export const SMOKINGPIPES_PUBLIC_READY_CATEGORY = "publicReady";
export const SMOKINGPIPES_SOLD_PUBLIC_CATEGORY = "soldOutOfStock";

const REVIEW_ONLY_CATEGORIES = new Set([
  "missingPrice",
  "inventoryConflict",
  "missingImage",
  "missingRequiredFields",
  "taxonomyNeedsReview",
  "publicationExcluded",
  "convertFailed",
]);

const SOLD_STATUSES = new Set([
  "sold",
  "unavailable",
  "out-of-stock",
  "out_of_stock",
  "soldout",
  "sold-out",
]);

export function getSmokingpipesReadinessCategory(product) {
  return text(
    product?.sourceSpecific?.smokingpipes?.baselineReadinessCategory
  );
}

export function evaluateSmokingpipesPublicReadiness(product) {
  const brandExclusion =
    classifySmokingpipesBrandExclusion(product);
  if (brandExclusion.excluded) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category: "excludedBrand",
      reason: brandExclusion.reason,
    };
  }

  const status = text(product?.inventoryStatus).toLowerCase();
  const category = getSmokingpipesReadinessCategory(product);
  const baselineReason = text(
    product?.sourceSpecific?.smokingpipes?.baselineReadinessReason
  );

  if (REVIEW_ONLY_CATEGORIES.has(category)) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        `Smokingpipes baseline readiness category ${category} is review-only.`,
    };
  }

  if (SOLD_STATUSES.has(status)) {
    const isNewClassifiedSold = category === SMOKINGPIPES_SOLD_PUBLIC_CATEGORY;
    const hasMainImage = Boolean(
      text(
        product?.mainImageUrl ||
          product?.detailImageUrl ||
          product?.imageUrl
      )
    );
    const hasRequiredFields = Boolean(
      text(product?.canonicalBrand) &&
        text(product?.canonicalShape) &&
        text(product?.canonicalMaterial)
    );
    const publicIndexEligible =
      !isNewClassifiedSold || (hasMainImage && hasRequiredFields);
    return {
      publicIndexEligible,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        (publicIndexEligible
          ? "Smokingpipes sold reference remains eligible for the public index."
          : "New sold Smokingpipes product is missing fields required for the public index."),
    };
  }

  if (status !== "available") {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        `Smokingpipes inventory status ${status || "(missing)"} is not public-index eligible.`,
    };
  }

  if (category && category !== SMOKINGPIPES_PUBLIC_READY_CATEGORY) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        `Smokingpipes baseline readiness category ${category} is not public-ready.`,
    };
  }

  if (
    product?.listingEligible === false ||
    product?.publication?.listingEligible === false
  ) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        text(product?.publication?.reason) ||
        "Smokingpipes product is explicitly excluded from public listing.",
    };
  }

  if (
    category &&
    product?.sourceSpecific?.smokingpipes?.pricePending === true
  ) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        "Smokingpipes baseline product has a pending current-list price.",
    };
  }

  if (
    category &&
    !text(
      product?.mainImageUrl ||
        product?.detailImageUrl ||
        product?.imageUrl
    )
  ) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason || "Smokingpipes baseline product has no main image.",
    };
  }

  if (
    category &&
    (!text(product?.canonicalBrand) ||
      !text(product?.canonicalShape) ||
      !text(product?.canonicalMaterial))
  ) {
    return {
      publicIndexEligible: false,
      publiclySellable: false,
      publicReady: false,
      category,
      reason:
        baselineReason ||
        "Smokingpipes baseline product is missing required public fields.",
    };
  }

  return {
    publicIndexEligible: true,
    publiclySellable: true,
    publicReady: true,
    category: category || null,
    reason:
      baselineReason ||
      "Smokingpipes product passed the shared public-readiness rule.",
  };
}

export function isSmokingpipesPublicReady(product) {
  return evaluateSmokingpipesPublicReadiness(product).publicReady;
}

export function isSmokingpipesPublicIndexEligible(product) {
  return evaluateSmokingpipesPublicReadiness(product).publicIndexEligible;
}

export function isSmokingpipesPubliclySellable(product) {
  return evaluateSmokingpipesPublicReadiness(product).publiclySellable;
}
