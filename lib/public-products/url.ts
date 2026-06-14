import type { ProductQueryState, ProductSortMode } from "./types";

export const PRODUCT_SORT_OPTIONS: Array<{
  value: ProductSortMode;
  label: string;
}> = [
  { value: "default", label: "推荐" },
  { value: "priceAsc", label: "价格从低到高" },
  { value: "priceDesc", label: "价格从高到低" },
  { value: "newest", label: "最新上架" },
  { value: "galleryFirst", label: "多图优先" },
  { value: "brand", label: "品牌名称" },
  { value: "name", label: "商品名称" },
];

export function buildProductsHref(
  state: Partial<ProductQueryState>,
  overrides: Partial<ProductQueryState> = {}
) {
  const nextState = { ...state, ...overrides };
  const params = new URLSearchParams();

  if (nextState.q) params.set("q", nextState.q);
  if (nextState.source) params.set("source", nextState.source);
  if (nextState.brand) params.set("brand", nextState.brand);
  if (nextState.country) params.set("country", nextState.country);
  if (nextState.shape) params.set("shape", nextState.shape);
  if (nextState.condition) params.set("condition", nextState.condition);
  if (nextState.weight) params.set("weight", nextState.weight);
  if (nextState.finish) params.set("finish", nextState.finish);
  if (nextState.bowlMaterial) params.set("bowlMaterial", nextState.bowlMaterial);
  if (nextState.stemMaterial) params.set("stemMaterial", nextState.stemMaterial);
  if (nextState.filter) params.set("filter", nextState.filter);

  if (nextState.galleryOnly) {
    params.set("status", "gallery");
  } else if (nextState.inventory && nextState.inventory !== "all") {
    params.set("inventory", nextState.inventory);
  }

  if (nextState.sort && nextState.sort !== "default") {
    params.set("sort", nextState.sort);
  }

  if (nextState.page && nextState.page > 1) {
    params.set("page", String(nextState.page));
  }

  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}
