import "server-only";

import type { PublicCatalogProduct } from "./types";
import { getPublicRecentNewProducts } from "./server";

export const DAILY_UPDATES_TIME_ZONE = "Asia/Shanghai";

export type DailyProductUpdates = {
  requestedDate: string;
  displayedDate: string;
  generatedAt: string;
  isFallback: boolean;
  products: PublicCatalogProduct[];
};

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

  return {
    requestedDate,
    displayedDate,
    generatedAt: payload.generatedAt,
    isFallback: requestedDate !== displayedDate,
    products: payload.products,
  };
}
