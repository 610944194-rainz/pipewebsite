import type { PublicCatalogProduct } from "./public-products/types";

export type ProductDisplayNameQuality =
  | "ready"
  | "candidate"
  | "fallback-original";

export type ProductBrandZhSource =
  | "taxonomy-confirmed"
  | "danishpipe-confirmed"
  | "keep-original-unconfirmed"
  | "unknown";

export type ProductDisplayNameResult = {
  title: string;
  subtitle: string | null;
  quality: ProductDisplayNameQuality;
};

export type ProductDisplayNameFields = {
  safeDisplayNameZh?: string | null;
  displayTitle?: string | null;
  subtitleOriginalName?: string | null;
  displayNameQuality?: ProductDisplayNameQuality | null;
  displayNameWarnings?: string[];
  brandZhSource?: ProductBrandZhSource | null;
};

type ProductDisplayNameInput = Pick<
  PublicCatalogProduct,
  "id" | "displayName" | "displayNameEn" | "rawTitle"
> &
  ProductDisplayNameFields;

function cleanDisplayText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return /^(?:undefined|null|nan)$/i.test(text) ? "" : text;
}

function fallbackTitle(product: ProductDisplayNameInput) {
  return (
    cleanDisplayText(product.displayNameEn) ||
    cleanDisplayText(product.rawTitle) ||
    cleanDisplayText(product.displayName) ||
    cleanDisplayText(product.id) ||
    "海外烟斗"
  );
}

export function getProductDisplayName(
  product: ProductDisplayNameInput
): ProductDisplayNameResult {
  const fallback = fallbackTitle(product);
  const title = cleanDisplayText(product.displayTitle) || fallback;
  const rawSubtitle = cleanDisplayText(product.subtitleOriginalName);
  const subtitle = rawSubtitle && rawSubtitle !== title ? rawSubtitle : null;

  return {
    title,
    subtitle,
    quality: product.displayNameQuality || "fallback-original",
  };
}
