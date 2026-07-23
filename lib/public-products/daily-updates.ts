import "server-only";

import type { PublicCatalogProduct } from "./types";
import {
  getPublicCatalog,
  getPublicCatalogMap,
  getPublicRecentNewProducts,
} from "./server";

export const DAILY_UPDATES_TIME_ZONE = "Asia/Shanghai";

export type DailyProductUpdates = {
  requestedDate: string;
  displayedDate: string;
  generatedAt: string;
  isFallback: boolean;
  sourceRecordCount: number;
  duplicateRecordCount: number;
  unresolvedRecordCount: number;
  products: PublicCatalogProduct[];
};

function cleanId(value: unknown) {
  return String(value || "").trim();
}

function sourceIdentity(product: Pick<PublicCatalogProduct, "source" | "sourceProductId">) {
  const sourceProductId = cleanId(product.sourceProductId);
  return sourceProductId ? `${product.source}:${sourceProductId}` : "";
}

/**
 * `recent-new.json` is an update index, not the presentation source of truth.
 * Resolve each recorded ID through the formal public catalog so the list shares
 * the same safe display-name enrichment as `/products`.
 */
function resolveDailyProducts(records: PublicCatalogProduct[]) {
  const catalogById = getPublicCatalogMap();
  const catalogBySource = new Map(
    getPublicCatalog()
      .map((product) => [sourceIdentity(product), product] as const)
      .filter(([key]) => Boolean(key))
  );
  const products: PublicCatalogProduct[] = [];
  const seen = new Set<string>();
  let duplicateRecordCount = 0;
  let unresolvedRecordCount = 0;

  for (const record of records) {
    const canonicalId = cleanId(record.id);
    const product =
      (canonicalId ? catalogById.get(canonicalId) : undefined) ||
      catalogBySource.get(sourceIdentity(record));

    if (!product) {
      unresolvedRecordCount += 1;
      continue;
    }

    const stableIdentity = cleanId(product.id) || sourceIdentity(product);
    if (!stableIdentity || seen.has(stableIdentity)) {
      duplicateRecordCount += 1;
      continue;
    }

    seen.add(stableIdentity);
    products.push(product);
  }

  return { products, duplicateRecordCount, unresolvedRecordCount };
}

function formatShanghaiDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_UPDATES_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  return year && month && day ? `${year}-${month}-${day}` : null;
}

/**
 * The formal `recent-new.json` payload is written only from the daily
 * public-ready-new set. Its generatedAt value belongs to that public batch,
 * rather than to the filesystem or frontend build.
 */
export function getDailyProductUpdates(
  now: Date = new Date()
): DailyProductUpdates | null {
  const payload = getPublicRecentNewProducts();
  if (!payload?.products?.length) return null;

  const requestedDate = formatShanghaiDate(now);
  const displayedDate = formatShanghaiDate(payload.generatedAt);
  if (!requestedDate || !displayedDate) return null;

  const resolved = resolveDailyProducts(payload.products);

  return {
    requestedDate,
    displayedDate,
    generatedAt: payload.generatedAt,
    isFallback: requestedDate !== displayedDate,
    sourceRecordCount: payload.products.length,
    duplicateRecordCount: resolved.duplicateRecordCount,
    unresolvedRecordCount: resolved.unresolvedRecordCount,
    products: resolved.products,
  };
}
