import "server-only";

import fs from "node:fs";
import path from "node:path";
import type {
  ProductBrandZhSource,
  ProductDisplayNameQuality,
} from "./product-display-name";
import type { PublicCatalogProduct } from "./public-products/types";

type SafeDisplayNameEntry = {
  id: string;
  source: "danish" | "smokingpipes";
  originalName: string;
  displayNameZhV2: string;
  safeDisplayNameZh: string | null;
  displayTitle: string;
  subtitleOriginalName: string | null;
  quality: ProductDisplayNameQuality;
  warnings: string[];
  brandZhSource: ProductBrandZhSource;
};

type SafeDisplayNameFile = {
  schemaVersion: "product-displayname-zh-safe-candidates.v1";
  items: SafeDisplayNameEntry[];
};

const SAFE_DISPLAY_NAME_PATH = path.join(
  process.cwd(),
  "data",
  "i18n",
  "product-displayname-zh-safe-candidates.json"
);

let safeDisplayNameMapCache: Map<string, SafeDisplayNameEntry> | null = null;

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fallbackDisplayTitle(product: PublicCatalogProduct) {
  return (
    cleanText(product.displayNameEn) ||
    cleanText(product.rawTitle) ||
    cleanText(product.displayName) ||
    cleanText(product.id)
  );
}

function safeDisplayNameMap() {
  if (!safeDisplayNameMapCache) {
    const file = JSON.parse(
      fs.readFileSync(SAFE_DISPLAY_NAME_PATH, "utf8")
    ) as SafeDisplayNameFile;

    safeDisplayNameMapCache = new Map(
      file.items.map((item) => [item.id, item])
    );
  }

  return safeDisplayNameMapCache;
}

export function getSafeDisplayNameEntry(id: string) {
  return safeDisplayNameMap().get(id) || null;
}

export function withSafeDisplayName<T extends PublicCatalogProduct>(
  product: T
): T {
  const entry = getSafeDisplayNameEntry(product.id);

  if (!entry) {
    return {
      ...product,
      safeDisplayNameZh: null,
      displayTitle: fallbackDisplayTitle(product),
      subtitleOriginalName: null,
      displayNameQuality: "fallback-original",
      displayNameWarnings: ["safeDisplayNameMissing"],
      brandZhSource: "unknown",
    };
  }

  return {
    ...product,
    safeDisplayNameZh: entry.safeDisplayNameZh,
    displayTitle: entry.displayTitle,
    subtitleOriginalName: entry.subtitleOriginalName,
    displayNameQuality: entry.quality,
    displayNameWarnings: entry.warnings,
    brandZhSource: entry.brandZhSource,
  };
}

export function withSafeDisplayNames<T extends PublicCatalogProduct>(
  products: T[]
): T[] {
  return products.map(withSafeDisplayName);
}
