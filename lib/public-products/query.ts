import "server-only";

import { getBrandByName } from "../../data/brands";
import { getPublicCatalog, getPublicFilters } from "./server";
import { countryLabel } from "./presentation";
import {
  normalizeShapeSelection,
  productShapePresentations,
  productShapeValues,
  shouldSuppressPanelWhenCombined,
} from "./shape";
import { PRODUCT_SORT_OPTIONS } from "./url";
import type {
  ProductQueryResult,
  ProductQueryState,
  ProductSortMode,
  ProductUiFilterOptions,
  ProductWeightRange,
  PublicCatalogProduct,
  PublicFilterOption,
} from "./types";

export { buildProductsHref, PRODUCT_SORT_OPTIONS } from "./url";

export const PRODUCT_PAGE_SIZE = 20;

const WEIGHT_LABELS: Record<ProductWeightRange, string> = {
  light: "杞婚噺 鈮?5g",
  medium: "涓瓑 36鈥?5g",
  heavy: "鍋忛噸 56鈥?5g",
  "extra-heavy": "閲嶅瀷 >75g",
};

const BRAND_CANONICAL_FILTER_MAP: Record<
  string,
  { value: string; label: string; country?: string }
> = {
  "savinelli autograph": { value: "savinelli", label: "Savinelli", country: "Italy" },
  "savinelli-autograph": { value: "savinelli", label: "Savinelli", country: "Italy" },
  "tsuge ikebana": { value: "tsuge", label: "Tsuge", country: "Japan" },
  "tsuge-ikebana": { value: "tsuge", label: "Tsuge", country: "Japan" },
  "ashton for paul olsen": { value: "ashton", label: "Ashton", country: "United Kingdom" },
  "ashton-for-paul-olsen": { value: "ashton", label: "Ashton", country: "United Kingdom" },
  "son (nording)": { value: "nording", label: "N酶rding", country: "Denmark" },
  "son-nording": { value: "nording", label: "N酶rding", country: "Denmark" },
  "eriksen keystone filter pipe": { value: "nording", label: "N酶rding", country: "Denmark" },
  "eriksen-keystone-filter-pipe": { value: "nording", label: "N酶rding", country: "Denmark" },
};

const HIDDEN_BRAND_FILTER_VALUES = new Set([
  "pipe key ring",
  "pipe-key-ring",
  "pipepack",
]);

function canonicalBrandFilterKey(value: string | null | undefined) {
  return normalizeSearchText(value).replace(/[\s_]+/g, "-");
}

function canonicalBrandFilterInfo(
  value: string | null | undefined,
  label?: string | null,
  country?: string | null
) {
  const rawValue = String(value || "").trim();
  const rawLabel = String(label || rawValue || "").trim();
  const normalizedValue = normalizeSearchText(rawValue);
  const normalizedLabel = normalizeSearchText(rawLabel);
  const dashValue = canonicalBrandFilterKey(rawValue);
  const mapped =
    BRAND_CANONICAL_FILTER_MAP[normalizedValue] ||
    BRAND_CANONICAL_FILTER_MAP[normalizedLabel] ||
    BRAND_CANONICAL_FILTER_MAP[dashValue];

  if (mapped) {
    return {
      value: mapped.value,
      label: mapped.label,
      country: mapped.country || country || null,
      hidden: false,
    };
  }

  if (
    HIDDEN_BRAND_FILTER_VALUES.has(normalizedValue) ||
    HIDDEN_BRAND_FILTER_VALUES.has(normalizedLabel) ||
    HIDDEN_BRAND_FILTER_VALUES.has(dashValue)
  ) {
    return { value: "", label: "", country: null, hidden: true };
  }

  return {
    value: rawValue,
    label: rawLabel,
    country: country || null,
    hidden: false,
  };
}

function productBrandFilterValue(product: PublicCatalogProduct) {
  return canonicalBrandFilterInfo(
    product.brandSlug || product.brandName,
    product.brandName,
    product.brandCountry
  ).value;
}

function validPublicReferencePrice(product: PublicCatalogProduct) {
  return (
    product.siteDisplayReady &&
    typeof product.siteDisplayAmount === "number" &&
    Number.isFinite(product.siteDisplayAmount) &&
    product.siteDisplayCurrency === "CNY"
  );
}


type RawSearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[鈥欌€榒麓]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanParam(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function makeAllowedSet(options: PublicFilterOption[] | undefined) {
  return new Set(
    (options || [])
      .filter((option) => option.productCount > 0)
      .map((option) => option.value)
  );
}

function allowedValue(value: string, allowed: Set<string>) {
  return value && allowed.has(value) ? value : "";
}

function parsePage(value: string | undefined) {
  const page = Number.parseInt(value || "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function parseSort(value: string | undefined): ProductSortMode {
  const aliases: Record<string, ProductSortMode> = {
    "price-asc": "priceAsc",
    "price-desc": "priceDesc",
  };
  const normalizedValue = aliases[value || ""] || value;
  const allowed = new Set(PRODUCT_SORT_OPTIONS.map((option) => option.value));

  return allowed.has(normalizedValue as ProductSortMode)
    ? (normalizedValue as ProductSortMode)
    : "default";
}

function parseInventory(value: string | undefined): ProductQueryState["inventory"] {
  if (value === "available" || value === "sold") return value;
  return "all";
}

export function getWeightRange(
  weightGrams: number | null | undefined
): ProductWeightRange | "" {
  if (typeof weightGrams !== "number" || !Number.isFinite(weightGrams)) {
    return "";
  }

  if (weightGrams <= 35) return "light";
  if (weightGrams <= 55) return "medium";
  if (weightGrams <= 75) return "heavy";
  return "extra-heavy";
}

function optionSort(left: PublicFilterOption, right: PublicFilterOption) {
  return (left.labelZh || left.label).localeCompare(
    right.labelZh || right.label,
    "zh-Hans-CN"
  );
}

function deriveConditionOptions(
  catalog: PublicCatalogProduct[]
): PublicFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const product of catalog) {
    const value = String(product.conditionType || "").trim();
    if (!value || value.toLowerCase() === "unknown") continue;

    const label =
      String(product.conditionLabel || "").trim() ||
      (value === "new" ? "鏂版枟" : value === "estate" ? "鍥炴祦" : value);
    const current = counts.get(value) || { label, count: 0 };
    current.count += 1;
    counts.set(value, current);
  }

  return [...counts.entries()]
    .map(([value, entry]) => ({
      value,
      label: entry.label,
      labelZh: entry.label,
      productCount: entry.count,
    }))
    .sort(optionSort);
}

function deriveWeightOptions(catalog: PublicCatalogProduct[]): PublicFilterOption[] {
  const order: ProductWeightRange[] = [
    "light",
    "medium",
    "heavy",
    "extra-heavy",
  ];
  const counts = new Map<ProductWeightRange, number>();

  for (const product of catalog) {
    const value = getWeightRange(product.weightGrams);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return order
    .filter((value) => (counts.get(value) || 0) > 0)
    .map((value) => ({
      value,
      label: WEIGHT_LABELS[value],
      labelZh: WEIGHT_LABELS[value],
      productCount: counts.get(value) || 0,
    }));
}

function brandChineseLabel(name: string) {
  const brand = getBrandByName(name);
  const record = brand as Record<string, unknown> | undefined;
  const value =
    record?.nameZh ||
    record?.brandZh ||
    record?.chineseName ||
    record?.nameChinese;

  return typeof value === "string" ? value.trim() : "";
}

function enrichBrandOptions(options: PublicFilterOption[]) {
  return options
    .map((option) => ({
      ...option,
      labelZh: brandChineseLabel(option.label) || option.labelZh,
    }))
    .sort(optionSort);
}

function deriveBrandOptions(
  catalog: PublicCatalogProduct[]
): PublicFilterOption[] {
  const counts = new Map<
    string,
    { label: string; labelZh: string | null; productCount: number }
  >();

  for (const product of catalog) {
    const canonical = canonicalBrandFilterInfo(
      product.brandSlug || product.brandName,
      product.brandName,
      product.brandCountry
    );

    if (canonical.hidden || !canonical.value) continue;

    const current = counts.get(canonical.value) || {
      label: canonical.label,
      labelZh: brandChineseLabel(canonical.label) || null,
      productCount: 0,
    };

    current.productCount += 1;
    counts.set(canonical.value, current);
  }

  return [...counts.entries()]
    .map(([value, entry]) => ({
      value,
      label: entry.label,
      labelZh: entry.labelZh,
      productCount: entry.productCount,
    }))
    .sort(optionSort);
}

function enrichCountryOptions(options: PublicFilterOption[]) {
  return options
    .map((option) => {
      const translated = countryLabel(option.label);
      return {
        ...option,
        labelZh: translated && translated !== option.label ? translated : option.labelZh,
      };
    })
    .sort(optionSort);
}

function deriveShapeOptions(
  catalog: PublicCatalogProduct[]
): PublicFilterOption[] {
  const counts = new Map<
    string,
    { label: string; labelZh: string; productCount: number }
  >();

  for (const product of catalog) {
    if (!product.filterEligibility?.shape) continue;

    let shapes = productShapePresentations(product);
    if (shouldSuppressPanelWhenCombined(shapes.map((shape) => shape.value))) {
      shapes = shapes.filter((shape) => shape.value !== "Panel");
    }

    for (const shape of shapes) {
      if (!shape.value) continue;

      const current = counts.get(shape.value) || {
        label: shape.label,
        labelZh: shape.labelZh,
        productCount: 0,
      };

      current.productCount += 1;

      if (!current.labelZh && shape.labelZh) {
        current.labelZh = shape.labelZh;
      }

      counts.set(shape.value, current);
    }
  }

  return [...counts.entries()]
    .map(([value, entry]) => ({
      value,
      label: entry.label,
      labelZh: entry.labelZh || null,
      productCount: entry.productCount,
    }))
    .sort(optionSort);
}

function allowedShapeValue(
  value: string,
  options: PublicFilterOption[]
) {
  if (!value) return "";

  const allowed = makeAllowedSet(options);
  if (allowed.has(value)) return value;

  const normalized = normalizeShapeSelection(value);
  return normalized && allowed.has(normalized) ? normalized : "";
}

export function getProductUiFilterOptions(): ProductUiFilterOptions {
  const catalog = getPublicCatalog();
  const generated = getPublicFilters().options;

  return {
    source: generated.source || [],
    brand: deriveBrandOptions(catalog),
    country: enrichCountryOptions(generated.country || []),
    shape: deriveShapeOptions(catalog),
    condition: deriveConditionOptions(catalog),
    weight: deriveWeightOptions(catalog),
    finish: generated.finish || [],
    bowlMaterial: generated.bowlMaterial || [],
    stemMaterial: generated.stemMaterial || [],
    filter: generated.filter || [],
  };
}

export function parseProductQueryState(
  searchParams: RawSearchParams = {}
): ProductQueryState {
  const filters = getProductUiFilterOptions();
  const rawStatus = cleanParam(firstParam(searchParams.status));
  const rawInventory = cleanParam(firstParam(searchParams.inventory));
  const galleryOnly = rawStatus === "gallery";

  return {
    q: cleanParam(firstParam(searchParams.q)),
    source: allowedValue(
      cleanParam(firstParam(searchParams.source)),
      makeAllowedSet(filters.source)
    ),
    brand: allowedValue(
      canonicalBrandFilterInfo(cleanParam(firstParam(searchParams.brand))).value,
      makeAllowedSet(filters.brand)
    ),
    country: allowedValue(
      cleanParam(firstParam(searchParams.country)),
      makeAllowedSet(filters.country)
    ),
    shape: allowedShapeValue(
      cleanParam(firstParam(searchParams.shape)),
      filters.shape
    ),
    condition: allowedValue(
      cleanParam(firstParam(searchParams.condition)),
      makeAllowedSet(filters.condition)
    ),
    weight: allowedValue(
      cleanParam(firstParam(searchParams.weight)),
      makeAllowedSet(filters.weight)
    ),
    finish: allowedValue(
      cleanParam(firstParam(searchParams.finish)),
      makeAllowedSet(filters.finish)
    ),
    bowlMaterial: allowedValue(
      cleanParam(firstParam(searchParams.bowlMaterial)),
      makeAllowedSet(filters.bowlMaterial)
    ),
    stemMaterial: allowedValue(
      cleanParam(firstParam(searchParams.stemMaterial)),
      makeAllowedSet(filters.stemMaterial)
    ),
    filter: allowedValue(
      cleanParam(firstParam(searchParams.filter)),
      makeAllowedSet(filters.filter)
    ),
    inventory: galleryOnly
      ? "all"
      : parseInventory(rawInventory || rawStatus),
    galleryOnly,
    sort: parseSort(cleanParam(firstParam(searchParams.sort))),
    page: parsePage(cleanParam(firstParam(searchParams.page))),
  };
}

function brandChineseName(product: PublicCatalogProduct) {
  const brand = getBrandByName(product.brandName || "");
  const record = brand as Record<string, unknown> | undefined;
  const value =
    record?.nameZh ||
    record?.brandZh ||
    record?.chineseName ||
    record?.nameChinese;

  return typeof value === "string" ? value : "";
}

function productSearchText(product: PublicCatalogProduct) {
  return normalizeSearchText(
    [
      product.id,
      product.sourceProductId,
      product.brandName,
      brandChineseName(product),
      product.brandCountry,
      product.displayTitle,
      product.safeDisplayNameZh,
      product.subtitleOriginalName,
      product.displayName,
      product.displayNameEn,
      product.rawTitle,
      product.shape,
      product.shapeZh,
      productShapeValues(product).join(" "),
      productShapePresentations(product).map((shape) => shape.labelZh).join(" "),
      product.conditionType,
      product.conditionLabel,
      product.finish,
      product.finishZh,
      product.bowlMaterial,
      product.bowlMaterialZh,
      product.stemMaterial,
      product.stemMaterialZh,
      product.filter,
      product.sortKeys?.name,
      product.sortKeys?.sourceProductId,
    ].join(" ")
  );
}

function productMatchesState(
  product: PublicCatalogProduct,
  state: ProductQueryState
) {
  const keyword = normalizeSearchText(state.q);

  if (keyword && !productSearchText(product).includes(keyword)) return false;
  if (state.source && product.source !== state.source) return false;
  if (state.brand && productBrandFilterValue(product) !== state.brand) {
    return false;
  }
  if (state.country && product.brandCountry !== state.country) return false;
  if (state.shape && !productShapeValues(product).includes(state.shape)) return false;
  if (state.condition && product.conditionType !== state.condition) return false;
  if (state.weight && getWeightRange(product.weightGrams) !== state.weight) {
    return false;
  }
  if (state.finish && product.finish !== state.finish) return false;
  if (state.bowlMaterial && product.bowlMaterial !== state.bowlMaterial) {
    return false;
  }
  if (state.stemMaterial && product.stemMaterial !== state.stemMaterial) {
    return false;
  }
  if (state.filter && product.filter !== state.filter) return false;
  if (state.inventory !== "all" && product.inventoryStatus !== state.inventory) {
    return false;
  }
  if (state.galleryOnly && product.galleryCount <= 1) return false;

  return true;
}

function productPrice(product: PublicCatalogProduct) {
  return validPublicReferencePrice(product)
    ? product.siteDisplayAmount
    : Number.POSITIVE_INFINITY;
}

function sourceProductIdNumber(product: PublicCatalogProduct) {
  const parsed = Number.parseInt(product.sourceProductId, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inventoryRank(product: PublicCatalogProduct) {
  return product.inventoryStatus === "sold" ? 1 : 0;
}

type BrandRecommendationStats = {
  availableCount: number;
  pricedCount: number;
  sortedPrices: number[];
  scaleScore: number;
};

type ProductRecommendationMetrics = {
  brandAvailableCount: number;
  brandPricePercentile: number | null;
  commercialScore: number;
  pipeSetLike: boolean;
};

type RecommendationContext = {
  byBrand: Map<string, BrandRecommendationStats>;
  byProductId: Map<string, ProductRecommendationMetrics>;
};

const recommendationContextCache = new WeakMap<
  PublicCatalogProduct[],
  RecommendationContext
>();

function productBrandKey(product: PublicCatalogProduct) {
  return normalizeSearchText(
    product.brandSlug || product.brandName || "__unknown_brand__"
  );
}

function normalizedProductTitle(product: PublicCatalogProduct) {
  return normalizeSearchText(
    [
      product.displayName,
      product.displayNameEn,
      product.rawTitle,
      product.sortKeys?.name,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isPipeSetLike(product: PublicCatalogProduct) {
  const title = normalizedProductTitle(product);

  if (!title) return false;

  return (
    /(?:^|\b)(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+pipe(?:s)?\s+(?:daily\s+)?set(?:\b|$)/i.test(
      title
    ) ||
    /(?:^|\b)(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+pipe(?:s)?\s+collection(?:\b|$)/i.test(
      title
    ) ||
    /(?:^|\b)pipe(?:s)?\s+set(?:\b|$)/i.test(title) ||
    /(?:^|\b)set\s+of\s+(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+pipe(?:s)?(?:\b|$)/i.test(
      title
    ) ||
    /套装|组合装|组合套|多支装/.test(title)
  );
}

function lowerBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }

  return low;
}

function upperBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }

  return low;
}

function pricePercentile(price: number, sortedPrices: number[]) {
  if (!Number.isFinite(price) || price <= 0 || sortedPrices.length === 0) {
    return null;
  }

  if (sortedPrices.length === 1) return 0.5;

  const first = lowerBound(sortedPrices, price);
  const afterLast = upperBound(sortedPrices, price);
  const averageIndex = (first + Math.max(first, afterLast - 1)) / 2;
  return averageIndex / (sortedPrices.length - 1);
}

function priceBandScore(
  percentile: number | null,
  pricedCount: number
) {
  if (percentile === null) return 0.1;

  if (pricedCount >= 20) {
    if (percentile >= 0.3 && percentile <= 0.6) return 1;
    if (percentile >= 0.2 && percentile < 0.3) return 0.75;
    if (percentile > 0.6 && percentile <= 0.7) return 0.7;
    if (percentile >= 0.1 && percentile < 0.2) return 0.45;
    if (percentile > 0.7 && percentile <= 0.85) return 0.4;
    return 0.2;
  }

  if (pricedCount >= 8) {
    if (percentile >= 0.25 && percentile <= 0.65) return 1;
    if (percentile >= 0.15 && percentile < 0.25) return 0.7;
    if (percentile > 0.65 && percentile <= 0.75) return 0.65;
    return 0.3;
  }

  return Math.max(0.2, 1 - Math.abs(percentile - 0.5) * 1.6);
}

function buildRecommendationContext(catalog: PublicCatalogProduct[]) {
  const cached = recommendationContextCache.get(catalog);
  if (cached) return cached;

  const mutable = new Map<
    string,
    { availableCount: number; prices: number[] }
  >();

  for (const product of catalog) {
    if (product.inventoryStatus !== "available") continue;

    const brandKey = productBrandKey(product);
    const current = mutable.get(brandKey) || {
      availableCount: 0,
      prices: [],
    };

    current.availableCount += 1;

    const price = productPrice(product);
    if (price !== null && Number.isFinite(price) && price > 0) {
      current.prices.push(price);
    }

    mutable.set(brandKey, current);
  }

  const maxAvailableCount = Math.max(
    1,
    ...[...mutable.values()].map((entry) => entry.availableCount)
  );
  const denominator = Math.log1p(maxAvailableCount);
  const byBrand = new Map<string, BrandRecommendationStats>();

  for (const [brandKey, entry] of mutable) {
    const sortedPrices = [...entry.prices].sort((left, right) => left - right);
    byBrand.set(brandKey, {
      availableCount: entry.availableCount,
      pricedCount: sortedPrices.length,
      sortedPrices,
      scaleScore:
        denominator > 0
          ? Math.log1p(entry.availableCount) / denominator
          : 0,
    });
  }

  const byProductId = new Map<string, ProductRecommendationMetrics>();

  for (const product of catalog) {
    const stats = byBrand.get(productBrandKey(product));
    const percentilePrice = productPrice(product);
    const percentile =
      stats && percentilePrice !== null
        ? pricePercentile(percentilePrice, stats.sortedPrices)
        : null;
    const brandScore = stats?.scaleScore || 0;
    const bandScore = priceBandScore(percentile, stats?.pricedCount || 0);
    const imageScore = product.galleryCount > 1 ? 1 : 0;

    byProductId.set(product.id, {
      brandAvailableCount: stats?.availableCount || 0,
      brandPricePercentile: percentile,
      commercialScore:
        brandScore * 0.42 + bandScore * 0.43 + imageScore * 0.15,
      pipeSetLike: isPipeSetLike(product),
    });
  }

  const context = { byBrand, byProductId };
  recommendationContextCache.set(catalog, context);
  return context;
}

function commercialRecommendationCompare(
  left: PublicCatalogProduct,
  right: PublicCatalogProduct,
  context: RecommendationContext
) {
  const leftMetrics = context.byProductId.get(left.id);
  const rightMetrics = context.byProductId.get(right.id);

  return (
    inventoryRank(left) - inventoryRank(right) ||
    Number(leftMetrics?.pipeSetLike) - Number(rightMetrics?.pipeSetLike) ||
    (rightMetrics?.commercialScore || 0) -
      (leftMetrics?.commercialScore || 0) ||
    (rightMetrics?.brandAvailableCount || 0) -
      (leftMetrics?.brandAvailableCount || 0) ||
    Math.abs((leftMetrics?.brandPricePercentile ?? 0.5) - 0.45) -
      Math.abs((rightMetrics?.brandPricePercentile ?? 0.5) - 0.45) ||
    compareNullableProductPrices(left, right, "asc") ||
    left.id.localeCompare(right.id)
  );
}

function pickDiverseRecommendationChunk(
  ranked: PublicCatalogProduct[],
  chunkSize: number
) {
  const remaining = [...ranked];
  const selected: PublicCatalogProduct[] = [];
  const selectedPerBrand = new Map<string, number>();

  while (selected.length < chunkSize && remaining.length > 0) {
    const position = selected.length;
    const preferredCap = position < 10 ? 2 : 3;
    let candidateIndex = -1;

    for (let relaxation = 0; relaxation <= 4 && candidateIndex < 0; relaxation++) {
      const brandCap = preferredCap + relaxation;

      candidateIndex = remaining.findIndex((candidate) => {
        const brandKey = productBrandKey(candidate);
        const count = selectedPerBrand.get(brandKey) || 0;
        const last = selected.at(-1);
        const secondLast = selected.at(-2);
        const wouldCreateThreeConsecutive =
          last !== undefined &&
          secondLast !== undefined &&
          productBrandKey(last) === brandKey &&
          productBrandKey(secondLast) === brandKey;

        return count < brandCap && !wouldCreateThreeConsecutive;
      });
    }

    if (candidateIndex < 0) candidateIndex = 0;

    const [candidate] = remaining.splice(candidateIndex, 1);
    if (!candidate) break;
    selected.push(candidate);
    const brandKey = productBrandKey(candidate);
    selectedPerBrand.set(
      brandKey,
      (selectedPerBrand.get(brandKey) || 0) + 1
    );
  }

  return { selected, remaining };
}

function applyRecommendationDiversity(
  ranked: PublicCatalogProduct[],
  state: ProductQueryState
) {
  if (state.brand || ranked.length <= PRODUCT_PAGE_SIZE) return ranked;

  const prefixTarget = Math.min(ranked.length, PRODUCT_PAGE_SIZE * 3);
  let remaining = [...ranked];
  const diversified: PublicCatalogProduct[] = [];

  while (diversified.length < prefixTarget && remaining.length > 0) {
    const chunkSize = Math.min(
      PRODUCT_PAGE_SIZE,
      prefixTarget - diversified.length
    );
    const chunk = pickDiverseRecommendationChunk(remaining, chunkSize);
    diversified.push(...chunk.selected);
    remaining = chunk.remaining;
  }

  return [...diversified, ...remaining];
}

function sortProducts(
  products: PublicCatalogProduct[],
  sort: ProductSortMode,
  catalog: PublicCatalogProduct[],
  state: ProductQueryState
) {
  const context = buildRecommendationContext(catalog);
  const sorted = [...products].sort((left, right) => {
    if (sort === "priceAsc") {
      return compareNullableProductPrices(left, right, "asc") || left.id.localeCompare(right.id);
    }

    if (sort === "priceDesc") {
      return compareNullableProductPrices(left, right, "desc") || left.id.localeCompare(right.id);
    }

    if (sort === "galleryFirst") {
      return (
        right.galleryCount - left.galleryCount ||
        inventoryRank(left) - inventoryRank(right) ||
        compareNullableProductPrices(left, right, "asc") ||
        left.id.localeCompare(right.id)
      );
    }

    if (sort === "brand") {
      return (
        String(left.brandName || "").localeCompare(
          String(right.brandName || ""),
          "en"
        ) || left.id.localeCompare(right.id)
      );
    }

    if (sort === "name") {
      return (
        String(left.displayNameEn || left.displayName || "").localeCompare(
          String(right.displayNameEn || right.displayName || ""),
          "en"
        ) || left.id.localeCompare(right.id)
      );
    }

    if (sort === "newest") {
      return (
        sourceProductIdNumber(right) - sourceProductIdNumber(left) ||
        left.id.localeCompare(right.id)
      );
    }

    return commercialRecommendationCompare(left, right, context);
  });

  return sort === "default"
    ? applyRecommendationDiversity(sorted, state)
    : sorted;
}

export function queryPublicProducts(
  searchParams: RawSearchParams = {}
): ProductQueryResult {
  const state = parseProductQueryState(searchParams);
  const catalog = getPublicCatalog();
  const filtered = sortProducts(
    catalog.filter((product) => productMatchesState(product, state)),
    state.sort,
    catalog,
    state
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCT_PAGE_SIZE));
  const currentPage = Math.min(state.page, totalPages);
  const start = (currentPage - 1) * PRODUCT_PAGE_SIZE;

  return {
    state: {
      ...state,
      page: currentPage,
    },
    products: filtered.slice(start, start + PRODUCT_PAGE_SIZE),
    totalCount: catalog.length,
    filteredCount: filtered.length,
    pageSize: PRODUCT_PAGE_SIZE,
    currentPage,
    totalPages,
  };
}

function compareNullableProductPrices(
  left: PublicCatalogProduct,
  right: PublicCatalogProduct,
  direction: "asc" | "desc"
) {
  const leftPrice = productPrice(left);
  const rightPrice = productPrice(right);

  if (leftPrice === null && rightPrice === null) {
    return 0;
  }

  if (leftPrice === null) {
    return 1;
  }

  if (rightPrice === null) {
    return -1;
  }

  return direction === "asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
}
