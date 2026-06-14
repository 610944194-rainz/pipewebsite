import "server-only";

import {
  createFallbackBrand,
  getBrandByName,
  getBrandContentBrandsForIndex,
  getBrandMetaBySlug,
  type PipeBrand,
} from "@/data/brands";
import { getPublicBrands, getPublicBrandMap } from "./server";
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

function makePublicBrandProfile(entry: PublicBrandIndexEntry): PublicBrandProfile {
  const slug = entry.brandSlug || undefined;
  const brandMeta =
    (slug ? getBrandMetaBySlug(slug) : undefined) ??
    getBrandByName(entry.brandName);
  const fallbackBrand = createFallbackBrand(entry.brandName, slug);

  return {
    ...fallbackBrand,
    ...(brandMeta ?? {}),
    name: entry.brandName,
    slug: entry.brandSlug || fallbackBrand.slug,
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
  return getPublicBrands().map(makePublicBrandProfile);
}

export function getPublicBrandProfileBySlug(slug: string) {
  const entry = getPublicBrandMap().get(slug);
  return entry ? makePublicBrandProfile(entry) : null;
}

export function getVisibleBrandContentProfilesWithoutPublicProducts() {
  const publicSlugs = new Set(
    getPublicBrands()
      .map((brand) => brand.brandSlug)
      .filter((slug): slug is string => Boolean(slug))
  );

  return getBrandContentBrandsForIndex().filter(
    (brand) => !publicSlugs.has(brand.slug)
  );
}
