import "server-only";

import fs from "node:fs";
import path from "node:path";
import type {
  PublicBrandIndexEntry,
  PublicBrandIndexFile,
  PublicCatalogProduct,
  PublicDetailProduct,
  PublicDetailShardFile,
  PublicFilters,
  PublicLookupFile,
} from "./types";
import { withSafeDisplayName } from "../product-display-name-server";

const ROOT = process.cwd();
const PUBLIC_PRODUCTS_ROOT = path.join(
  ROOT,
  "data",
  "generated",
  "public-products"
);

type CatalogFile = {
  schemaVersion: 1;
  products: PublicCatalogProduct[];
};

let catalogCache: PublicCatalogProduct[] | null = null;
let catalogMapCache: Map<string, PublicCatalogProduct> | null = null;
let filtersCache: PublicFilters | null = null;
let brandsCache: PublicBrandIndexEntry[] | null = null;
let brandMapCache: Map<string, PublicBrandIndexEntry> | null = null;
let lookupCache: PublicLookupFile | null = null;
const detailShardCache = new Map<string, PublicDetailProduct[]>();

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function dataFile(...segments: string[]) {
  return path.join(PUBLIC_PRODUCTS_ROOT, ...segments);
}

function assertShard(shard: string) {
  if (!/^(?:[0-2][0-9a-f]|3[0-9a-f])$/.test(shard)) {
    throw new Error(`Invalid detail shard: ${shard}`);
  }
}

export function getPublicCatalog(): PublicCatalogProduct[] {
  if (!catalogCache) {
    catalogCache = readJson<CatalogFile>(dataFile("catalog.json")).products.map(
      withSafeDisplayName
    );
  }

  return catalogCache;
}

export function getPublicCatalogMap() {
  if (!catalogMapCache) {
    catalogMapCache = new Map(
      getPublicCatalog().map((product) => [product.id, product])
    );
  }

  return catalogMapCache;
}

export function getPublicFilters(): PublicFilters {
  if (!filtersCache) {
    filtersCache = readJson<PublicFilters>(dataFile("filters.json"));
  }

  return filtersCache;
}

export function getPublicBrands(): PublicBrandIndexEntry[] {
  if (!brandsCache) {
    brandsCache = readJson<PublicBrandIndexFile>(dataFile("brands.json")).brands;
  }

  return brandsCache;
}

export function getPublicBrandMap() {
  if (!brandMapCache) {
    brandMapCache = new Map<string, PublicBrandIndexEntry>();

    for (const brand of getPublicBrands()) {
      if (brand.brandSlug) brandMapCache.set(brand.brandSlug, brand);
    }
  }

  return brandMapCache;
}

export function getPublicLookup(): PublicLookupFile {
  if (!lookupCache) {
    lookupCache = readJson<PublicLookupFile>(dataFile("detail-lookup.json"));
  }

  return lookupCache;
}

export function readPublicDetailShard(shard: string): PublicDetailProduct[] {
  assertShard(shard);

  if (!detailShardCache.has(shard)) {
    const shardFile = readJson<PublicDetailShardFile>(
      dataFile("details", `${shard}.json`)
    );
    detailShardCache.set(shard, shardFile.products);
  }

  return detailShardCache.get(shard) || [];
}

export function getPublicProductDetailById(
  id: string
): PublicDetailProduct | null {
  const lookup = getPublicLookup();
  const shard = lookup.byId[id];

  if (!shard) return null;

  const product =
    readPublicDetailShard(shard).find((entry) => entry.id === id) || null;

  return product ? withSafeDisplayName(product) : null;
}

export function resolvePublicProductId(rawId: string):
  | {
      id: string;
      shard: string;
      legacy: false;
    }
  | {
      id: string;
      shard: string;
      legacy: true;
      legacySource: "danish-sourceProductId";
    }
  | null {
  const id = rawId.trim();
  const lookup = getPublicLookup();
  const directShard = lookup.byId[id];

  if (directShard) return { id, shard: directShard, legacy: false };

  if (/^\d+$/.test(id)) {
    const legacy = lookup.bySourceProduct[`danish:${id}`];

    if (legacy) {
      return {
        id: legacy.id,
        shard: legacy.shard,
        legacy: true,
        legacySource: "danish-sourceProductId",
      };
    }
  }

  return null;
}

export function getPublicProductsByIds(ids: string[]) {
  const catalog = getPublicCatalogMap();
  return ids
    .map((id) => catalog.get(id))
    .filter((product): product is PublicCatalogProduct => Boolean(product));
}
