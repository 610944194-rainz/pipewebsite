import "server-only";

import {
  createFallbackBrand,
  getBrandByName,
  getBrandContentBrandsForIndex,
  getBrandMetaBySlug,
  normalizeBrandForBrandIndex,
  type PipeBrand,
} from "@/data/brands";
import { getPublicBrands } from "./server";
import type { PublicBrandIndexEntry } from "./types";

export type PublicBrandProfile = PipeBrand & {
  publicBrand: PublicBrandIndexEntry;
  productCount: number;
  productIds: string[];
  sourceCounts: Record<string, number>;
  inventoryStatusCounts: Record<string, number>;
  publicCountry: string | null;
};

function uniqueText(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mergeRecordCounts(
  left: Record<string, number>,
  right: Record<string, number>
) {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = (merged[key] || 0) + value;
  }
  return merged;
}

function normalizeEntry(entry: PublicBrandIndexEntry): PublicBrandIndexEntry | null {
  const normalized = normalizeBrandForBrandIndex(entry.brandName || entry.brandSlug || "");
  if (normalized.hidden || !normalized.canonicalName) return null;

  return {
    ...entry,
    brandName: normalized.canonicalName,
    brandSlug: normalized.canonicalSlug,
  };
}

function getMergedPublicBrandEntries() {
  const groups = new Map<string, PublicBrandIndexEntry>();

  for (const rawEntry of getPublicBrands()) {
    const entry = normalizeEntry(rawEntry);
    if (!entry || !entry.brandSlug) continue;

    const existing = groups.get(entry.brandSlug);
    if (!existing) {
      groups.set(entry.brandSlug, {
        ...entry,
        sourceCounts: { ...entry.sourceCounts },
        inventoryStatusCounts: { ...entry.inventoryStatusCounts },
        productIds: uniqueText(entry.productIds || []),
      });
      continue;
    }

    existing.productCount += entry.productCount;
    existing.sourceCounts = mergeRecordCounts(existing.sourceCounts, entry.sourceCounts);
    existing.inventoryStatusCounts = mergeRecordCounts(
      existing.inventoryStatusCounts,
      entry.inventoryStatusCounts
    );
    existing.productIds = uniqueText([...existing.productIds, ...(entry.productIds || [])]);
  }

  return Array.from(groups.values());
}

function makePublicBrandProfile(entry: PublicBrandIndexEntry): PublicBrandProfile {
  const slug = entry.brandSlug || undefined;
  const brandMeta =
    (slug ? getBrandMetaBySlug(slug) : undefined) ??
    getBrandByName(entry.brandName);
  const fallbackBrand = createFallbackBrand(entry.brandName, slug);
  const canonicalName = brandMeta?.name || entry.brandName;

  return {
    ...fallbackBrand,
    ...(brandMeta ?? {}),
    name: canonicalName,
    slug: entry.brandSlug || brandMeta?.slug || fallbackBrand.slug,
    aliases: uniqueText([
      ...fallbackBrand.aliases,
      ...(brandMeta?.aliases ?? []),
      entry.brandName,
      entry.brandSlug || "",
    ]),
    productCount: entry.productCount,
    productIds: entry.productIds,
    sourceCounts: entry.sourceCounts,
    inventoryStatusCounts: entry.inventoryStatusCounts,
    publicCountry: entry.country,
    publicBrand: entry,
  };
}

export function getPublicBrandProfiles() {
  return getMergedPublicBrandEntries().map(makePublicBrandProfile);
}

export function getPublicBrandProfileBySlug(slug: string) {
  const normalized = normalizeBrandForBrandIndex(slug.replace(/-/g, " "));
  const targetSlug = normalized.canonicalSlug || slug;
  return getPublicBrandProfiles().find((brand) => brand.slug === targetSlug) || null;
}

export function getVisibleBrandContentProfilesWithoutPublicProducts() {
  const publicSlugs = new Set(
    getMergedPublicBrandEntries()
      .map((brand) => brand.brandSlug)
      .filter((slug): slug is string => Boolean(slug))
  );

  return getBrandContentBrandsForIndex().filter(
    (brand) => !publicSlugs.has(brand.slug)
  );
}
