import "server-only";
import { loadProductNameContext, resolveProductName } from "./product-name-resolver.mjs";
import type { PublicCatalogProduct } from "./public-products/types";

export function getSafeDisplayNameEntry(id: string) {
  return loadProductNameContext().names.get(id) || null;
}

export function withSafeDisplayName<T extends PublicCatalogProduct>(product: T): T {
  const result = resolveProductName(product);
  const original = String(product.displayNameEn || product.rawTitle || "").trim();
  const entry = getSafeDisplayNameEntry(product.id);
  return {
    ...product,
    brandNameZh: result.brandNameZh,
    safeDisplayNameZh: result.quality === "fallback-original" ? null : result.title,
    displayTitle: result.title,
    subtitleOriginalName: entry ? entry.subtitleOriginalName : (original && original !== result.title ? original : null),
    displayNameQuality: result.quality,
    displayNameWarnings: result.warnings,
    brandZhSource: result.brandZhSource,
  };
}

export function withSafeDisplayNames<T extends PublicCatalogProduct>(products: T[]): T[] {
  return products.map(withSafeDisplayName);
}
