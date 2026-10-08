import "server-only";

import type { PublicCatalogProduct } from "./types";
import {
  getPublicCatalog,
  getPublicCatalogMap,
} from "./server";
import { getPublicRecentNewProductBatches } from "./update-history";

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
 * Select all public-ready batches for today in Shanghai, then yesterday only.
 * Resolve against the current catalog before deciding whether to fall back.
 */
export function getDailyProductUpdates(
  now: Date = new Date()
): DailyProductUpdates | null {
  const requestedDate = formatShanghaiDate(now);
  if (!requestedDate) return null;
  const previousDate = new Date(
    new Date(`${requestedDate}T00:00:00Z`).getTime() - 86_400_000
  ).toISOString().slice(0, 10);
  const batches = getPublicRecentNewProductBatches(previousDate);

  for (const displayedDate of [requestedDate, previousDate]) {
    const dailyBatches = batches.filter(
      (batch) => formatShanghaiDate(batch.generatedAt) === displayedDate
    );
    const records = dailyBatches.flatMap((batch) => batch.products);
    if (!records.length) continue;
    const resolved = resolveDailyProducts(records);
    if (!resolved.products.length) continue;

    return {
      requestedDate,
      displayedDate,
      generatedAt: dailyBatches.reduce((latest, batch) =>
        new Date(batch.generatedAt) > new Date(latest) ? batch.generatedAt : latest,
        dailyBatches[0].generatedAt
      ),
      isFallback: requestedDate !== displayedDate,
      sourceRecordCount: records.length,
      duplicateRecordCount: resolved.duplicateRecordCount,
      unresolvedRecordCount: resolved.unresolvedRecordCount,
      products: resolved.products,
    };
  }
  return null;
}
