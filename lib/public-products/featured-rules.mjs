export const FEATURED_PRODUCTS_VERSION = "featured-products-v1";

export const FEATURED_PRODUCT_RULES = Object.freeze({
  homepageSize: 4,
  featuredSize: 20,
  maxPerBrand: 3,
  homepageMaxPerBrand: 1,
  minimumGalleryCount: 3,
});

export const HOMEPAGE_ENTRY_PRICE_RULES = Object.freeze({
  preferredMinCny: 500,
  preferredMaxCny: 1500,
  fallbackMaxCny: 2200,
  fallbackWarning:
    "Homepage entry-friendly selection fell back to CNY 1500-2200 because no eligible products were available in CNY 500-1500.",
});

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNeedsReviewMarker(product) {
  const confidence = String(product?.inventoryConfidence || "").toLowerCase();
  const warnings = Array.isArray(product?.displayNameWarnings)
    ? product.displayNameWarnings
    : [];

  return (
    confidence.includes("needs-review") ||
    warnings.some((warning) =>
      String(warning || "")
        .toLowerCase()
        .includes("needs-review")
    )
  );
}

export function getFeaturedProductExclusionReasons(product) {
  const reasons = [];

  if (!product || typeof product !== "object") return ["invalid-record"];
  if (product.inventoryStatus !== "available") reasons.push("not-available");
  if (hasNeedsReviewMarker(product)) reasons.push("needs-review");
  if (!hasText(product.mainImage)) reasons.push("missing-main-image");
  if (
    !Number.isInteger(product.galleryCount) ||
    product.galleryCount < FEATURED_PRODUCT_RULES.minimumGalleryCount
  ) {
    reasons.push("insufficient-gallery");
  }
  if (!hasText(product.brandName)) reasons.push("missing-brand");
  if (!hasText(product.shape)) reasons.push("missing-shape");
  if (
    !hasText(product.displayName) &&
    !hasText(product.displayNameEn) &&
    !hasText(product.rawTitle)
  ) {
    reasons.push("missing-name");
  }
  if (
    product.siteDisplayReady !== true ||
    product.siteDisplayCurrency !== "CNY" ||
    !Number.isFinite(product.siteDisplayAmount) ||
    product.siteDisplayAmount <= 0
  ) {
    reasons.push("invalid-display-price");
  }
  if (
    product.sourcePriceCurrency !== "USD" ||
    !Number.isFinite(product.sourcePriceAmount) ||
    product.sourcePriceAmount <= 0
  ) {
    reasons.push("invalid-source-price");
  }

  return reasons;
}

export function isFeaturedProductEligible(product) {
  return getFeaturedProductExclusionReasons(product).length === 0;
}
