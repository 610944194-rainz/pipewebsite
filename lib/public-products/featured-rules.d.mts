import type { PublicCatalogProduct } from "./types";

export const FEATURED_PRODUCTS_VERSION: "featured-products-v1";

export const FEATURED_PRODUCT_RULES: Readonly<{
  homepageSize: 4;
  featuredSize: 20;
  maxPerBrand: 3;
  homepageMaxPerBrand: 1;
  minimumGalleryCount: 3;
}>;

export function getFeaturedProductExclusionReasons(
  product: PublicCatalogProduct | null | undefined
): string[];

export function isFeaturedProductEligible(
  product: PublicCatalogProduct | null | undefined
): product is PublicCatalogProduct;
