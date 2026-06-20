export type PublicSource = "danish" | "smokingpipes";

export type PublicInventoryStatus = "available" | "sold";

export type PublicFilterEligibility = {
  shape: boolean;
  finish: boolean;
  bowlMaterial: boolean;
  stemMaterial: boolean;
  filter: boolean;
};

export type PublicProductSortKeys = {
  brand: string;
  name: string;
  price: number | null;
  sourceProductId: string;
};

export type PublicProductDisplayNameQuality =
  | "ready"
  | "candidate"
  | "fallback-original";

export type PublicProductBrandZhSource =
  | "taxonomy-confirmed"
  | "danishpipe-confirmed"
  | "keep-original-unconfirmed"
  | "unknown";

export type PublicCatalogProduct = {
  id: string;
  source: PublicSource;
  sourceProductId: string;
  brandName: string | null;
  brandSlug: string | null;
  brandCountry: string | null;
  displayName: string | null;
  displayNameEn: string | null;
  rawTitle: string | null;
  safeDisplayNameZh?: string | null;
  displayTitle?: string | null;
  subtitleOriginalName?: string | null;
  displayNameQuality?: PublicProductDisplayNameQuality | null;
  displayNameWarnings?: string[];
  brandZhSource?: PublicProductBrandZhSource | null;
  mainImage: string | null;
  sourcePriceAmount: number | null;
  sourcePriceCurrency: string | null;
  msrpAmount: number | null;
  siteDisplayAmount: number | null;
  siteDisplayCurrency: string | null;
  siteDisplayReady: boolean;
  inventoryStatus: PublicInventoryStatus;
  inventoryConfidence: string | null;
  conditionType: string | null;
  conditionLabel: string | null;
  galleryCount: number;
  weightGrams: number | null;
  shape: string | null;
  shapeZh: string | null;
  finish: string | null;
  finishZh: string | null;
  bowlMaterial: string | null;
  bowlMaterialZh: string | null;
  stemMaterial: string | null;
  stemMaterialZh: string | null;
  filter: string | null;
  filterEligibility: PublicFilterEligibility;
  sortKeys: PublicProductSortKeys;
};

export type PublicMeasurementSet = {
  lengthMm: number | null;
  heightMm: number | null;
  weightGrams: number | null;
  chamberDepthMm: number | null;
  chamberDiameterMm: number | null;
  outsideDiameterMm: number | null;
};

export type PublicDetailSpec = {
  key: string;
  value: string | number;
  labelZh: string | null;
  unit: string | null;
};

export type PublicDetailProduct = PublicCatalogProduct & {
  displayNameZh: string | null;
  gallery: string[];
  measurements: PublicMeasurementSet;
  model: {
    canonicalModelKey: string | null;
    confidence: string | null;
  };
  series: string | null;
  year: number | null;
  productCode: string | null;
  filterSizeMm: number | null;
  weightRange: string | null;
  description: string | null;
  normalizedSpecs: PublicDetailSpec[];
  sourceUrl: string | null;
  sourceOriginalText: string | null;
  priceRawText: string | null;
  msrpRawText: string | null;
};

export type PublicFilterOption = {
  value: string;
  label: string;
  labelZh: string | null;
  productCount: number;
};

export type PublicFilters = {
  schemaVersion: 1;
  options: Record<string, PublicFilterOption[]>;
  sourcePriceUsdStats: {
    productCount: number;
    min: number | null;
    max: number | null;
  };
  priceFilterRangesGenerated: boolean;
};

export type PublicBrandIndexEntry = {
  brandName: string;
  brandSlug: string | null;
  country: string | null;
  productCount: number;
  sourceCounts: Record<string, number>;
  inventoryStatusCounts: Record<string, number>;
  productIds: string[];
};

export type PublicBrandIndexFile = {
  schemaVersion: 1;
  brands: PublicBrandIndexEntry[];
};

export type PublicBrandSeriesOption = {
  brand: string;
  brandZh: string | null;
  canonicalBrand: string;
  series: string;
  seriesZh: string | null;
  count: number;
  productIds: string[];
  confidence: "high" | "medium" | "low";
};

export type PublicBrandSeriesIndexEntry = {
  brand: string;
  brandZh: string | null;
  canonicalBrand: string;
  brandSlug: string;
  productCount: number;
  seriesOptions: PublicBrandSeriesOption[];
};

export type PublicBrandSeriesIndexFile = {
  schemaVersion: 1;
  frontendThresholdExclusive: number;
  minimumSeriesProductCount: number;
  brands: PublicBrandSeriesIndexEntry[];
};

export type PublicLookupFile = {
  schemaVersion: 1;
  byId: Record<string, string>;
  bySourceProduct: Record<
    string,
    {
      id: string;
      shard: string;
    }
  >;
};

export type PublicDetailShardFile = {
  schemaVersion: 1;
  shard: string;
  products: PublicDetailProduct[];
};

export type PublicFeaturedProductsFile = {
  version: "featured-products-v1";
  generatedAt: string;
  seedDate: string;
  homepage: string[];
  featured: string[];
  rules: {
    homepageSize: number;
    featuredSize: number;
    maxPerBrand: number;
    homepageMaxPerBrand: number;
  };
  warnings?: string[];
};

export type ProductWeightRange =
  | "light"
  | "medium"
  | "heavy"
  | "extra-heavy";

export type ProductQueryState = {
  q: string;
  source: string;
  brand: string;
  country: string;
  shape: string;
  condition: string;
  weight: string;
  finish: string;
  bowlMaterial: string;
  stemMaterial: string;
  filter: string;
  inventory: "all" | PublicInventoryStatus;
  galleryOnly: boolean;
  sort: ProductSortMode;
  page: number;
};

export type ProductSortMode =
  | "default"
  | "priceAsc"
  | "priceDesc"
  | "newest"
  | "galleryFirst"
  | "brand"
  | "name";

export type ProductUiFilterOptions = {
  source: PublicFilterOption[];
  brand: PublicFilterOption[];
  country: PublicFilterOption[];
  shape: PublicFilterOption[];
  condition: PublicFilterOption[];
  weight: PublicFilterOption[];
  finish: PublicFilterOption[];
  bowlMaterial: PublicFilterOption[];
  stemMaterial: PublicFilterOption[];
  filter: PublicFilterOption[];
};

export type ProductQueryResult = {
  state: ProductQueryState;
  products: PublicCatalogProduct[];
  totalCount: number;
  filteredCount: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
};
