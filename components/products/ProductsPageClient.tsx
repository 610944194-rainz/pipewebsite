"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import EditorialHero from "@/app/components/page/EditorialHero";
import PageBackBar from "@/app/components/page/PageBackBar";
import {
  buildProductsHref,
  PRODUCT_SORT_OPTIONS,
} from "@/lib/public-products/url";
import type {
  ProductQueryResult,
  ProductQueryState,
  ProductSortMode,
  ProductUiFilterOptions,
  PublicFilterOption,
} from "@/lib/public-products/types";
import ProductGrid from "./ProductGrid";

type ProductsPageClientProps = {
  result: ProductQueryResult;
  filters: ProductUiFilterOptions;
  returnTo: string;
};

type IconProps = {
  className?: string;
};

type StatusMode = "all" | "available" | "sold" | "gallery";

type FilterKind =
  | "brand"
  | "country"
  | "shape"
  | "condition"
  | "price"
  | "weight"
  | "finish"
  | "source"
  | "bowlMaterial"
  | "stemMaterial"
  | "filter"
  | "sort";

type SheetKind = FilterKind | "more";

type PaginationItem = number | "ellipsis";

const STATUS_ITEMS: Array<{ label: string; value: StatusMode }> = [
  { label: "全部", value: "all" },
  { label: "在售", value: "available" },
  { label: "已售参考", value: "sold" },
];

const PRICE_RANGES = [
  { label: "全部", minPrice: "", maxPrice: "" },
  { label: "¥0–999", minPrice: "0", maxPrice: "999" },
  { label: "¥1,000–1,999", minPrice: "1000", maxPrice: "1999" },
  { label: "¥2,000–2,999", minPrice: "2000", maxPrice: "2999" },
  { label: "¥3,000–4,999", minPrice: "3000", maxPrice: "4999" },
  { label: "¥5,000–9,999", minPrice: "5000", maxPrice: "9999" },
  { label: "¥10,000 以上", minPrice: "10000", maxPrice: "" },
] as const;

const FILTER_LABELS: Record<FilterKind, string> = {
  brand: "品牌",
  country: "国家",
  shape: "斗型",
  condition: "新旧",
  price: "价格区间",
  weight: "重量",
  finish: "表面工艺",
  source: "来源",
  bowlMaterial: "斗钵材质",
  stemMaterial: "斗嘴材质",
  filter: "滤芯",
  sort: "排序",
};

const PRIMARY_FILTERS: Array<{ kind: FilterKind; label: string }> = [
  { kind: "brand", label: "品牌" },
  { kind: "country", label: "国家" },
  { kind: "shape", label: "斗型" },
  { kind: "condition", label: "新旧" },
  { kind: "price", label: "价格区间" },
  { kind: "weight", label: "重量" },
  { kind: "finish", label: "表面工艺" },
];

const SECONDARY_FILTERS: Array<{ kind: FilterKind; label: string }> = [
  { kind: "source", label: "来源" },
  { kind: "bowlMaterial", label: "斗钵材质" },
  { kind: "stemMaterial", label: "斗嘴材质" },
  { kind: "filter", label: "滤芯" },
];

const ALL_FILTERS = [...PRIMARY_FILTERS, ...SECONDARY_FILTERS];

const PAGE_SCROLL_KEY = "yandoubuy:products-page-scroll";

function optionPrimaryText(kind: FilterKind, option: PublicFilterOption) {
  if (option.value === "danish") return "Danish Pipe Shop";
  if (option.value === "smokingpipes") return "Smokingpipes";
  return option.labelZh || option.label;
}

function optionSecondaryText(kind: FilterKind, option: PublicFilterOption) {
  if (
    kind !== "sort" &&
    option.labelZh &&
    option.labelZh !== option.label
  ) {
    return option.label;
  }

  return "";
}

function optionSearchText(kind: FilterKind, option: PublicFilterOption) {
  return [
    optionPrimaryText(kind, option),
    optionSecondaryText(kind, option),
    option.label,
    option.value,
  ]
    .filter(Boolean)
    .join(" ");
}

function sortOptions(): PublicFilterOption[] {
  return PRODUCT_SORT_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    labelZh: option.label,
    productCount: 1,
  }));
}

function getPaginationItems(
  currentPage: number,
  totalPages: number
): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ];
}

function statusMode(state: ProductQueryState): StatusMode {
  if (state.galleryOnly) return "gallery";
  if (state.inventory === "available") return "available";
  if (state.inventory === "sold") return "sold";
  return "all";
}

function hasActiveFilter(state: ProductQueryState) {
  return Boolean(
    state.q ||
      state.source ||
      state.brand ||
      state.country ||
      state.shape ||
      state.condition ||
      state.weight ||
      state.finish ||
      state.bowlMaterial ||
      state.stemMaterial ||
      state.filter ||
      state.minPrice !== null ||
      state.maxPrice !== null ||
      state.inventory !== "all" ||
      state.galleryOnly ||
      state.sort !== "default"
  );
}

function activeFilterCount(state: ProductQueryState) {
  return [
    state.q,
    state.source,
    state.brand,
    state.country,
    state.shape,
    state.condition,
    state.weight,
    state.finish,
    state.bowlMaterial,
    state.stemMaterial,
    state.filter,
    state.minPrice !== null || state.maxPrice !== null ? "price" : "",
    state.inventory !== "all" ? "inventory" : "",
    state.galleryOnly ? "gallery" : "",
    state.sort !== "default" ? "sort" : "",
  ].filter(Boolean).length;
}

export default function ProductsPageClient({
  result,
  filters,
  returnTo,
}: ProductsPageClientProps) {
  const router = useRouter();
  const [inputSearchText, setInputSearchText] = useState(result.state.q);
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [priceDraft, setPriceDraft] = useState({ minPrice: "", maxPrice: "" });
  const [priceError, setPriceError] = useState("");
  const [sheetSearchText, setSheetSearchText] = useState("");
  const productListRef = useRef<HTMLElement | null>(null);
  const paginationItems = useMemo(
    () => getPaginationItems(result.currentPage, result.totalPages),
    [result.currentPage, result.totalPages]
  );
  const active = hasActiveFilter(result.state);
  const currentStatus = statusMode(result.state);

  useEffect(() => {
    if (!activeSheet) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [activeSheet]);

  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem(PAGE_SCROLL_KEY);
      if (!pending) return;
      window.sessionStorage.removeItem(PAGE_SCROLL_KEY);

      window.requestAnimationFrame(() => {
        productListRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch {
      // Scroll restoration is an enhancement only.
    }
  }, [result.currentPage]);

  function navigate(
    overrides: Partial<ProductQueryState>,
    options: { pageReset?: boolean; scrollToList?: boolean } = {}
  ) {
    const nextOverrides: Partial<ProductQueryState> = {
      ...overrides,
      ...(options.pageReset === false ? {} : { page: 1 }),
    };

    if (options.scrollToList) {
      try {
        window.sessionStorage.setItem(PAGE_SCROLL_KEY, "1");
      } catch {
        // Ignore storage failures.
      }
    }

    router.push(buildProductsHref(result.state, nextOverrides), {
      scroll: false,
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ q: inputSearchText.trim() });
  }

  function setStatus(value: StatusMode) {
    if (value === "gallery") {
      navigate({ inventory: "all", galleryOnly: true });
      return;
    }

    navigate({
      inventory: value === "all" ? "all" : value,
      galleryOnly: false,
    });
  }

  function currentValue(kind: FilterKind) {
    if (kind === "sort") return result.state.sort;
    if (kind === "price") return "";
    return result.state[kind];
  }

  function optionsFor(kind: FilterKind): PublicFilterOption[] {
    if (kind === "sort") return sortOptions();
    if (kind === "price") return [];
    return filters[kind] || [];
  }

  function selectedLabel(kind: FilterKind) {
    if (kind === "price") {
      const { minPrice, maxPrice } = result.state;
      if (minPrice === null && maxPrice === null) return "";
      if (minPrice !== null && maxPrice !== null) {
        return `¥${minPrice.toLocaleString()}–${maxPrice.toLocaleString()}`;
      }
      if (minPrice !== null) return `¥${minPrice.toLocaleString()} 以上`;
      return `¥${maxPrice?.toLocaleString()} 以下`;
    }
    const value = currentValue(kind);
    if (!value || (kind === "sort" && value === "default")) return "";
    const option = optionsFor(kind).find((item) => item.value === value);
    return option ? optionPrimaryText(kind, option) : String(value);
  }

  function openSheet(kind: SheetKind) {
    setActiveSheet(kind);
    setDraftValue(kind === "more" ? "" : String(currentValue(kind)));
    setPriceDraft({
      minPrice: result.state.minPrice?.toString() || "",
      maxPrice: result.state.maxPrice?.toString() || "",
    });
    setPriceError("");
    setSheetSearchText("");
  }

  function closeSheet() {
    setActiveSheet(null);
    setDraftValue("");
    setPriceError("");
    setSheetSearchText("");
  }

  function applySheet() {
    if (!activeSheet || activeSheet === "more") return;

    if (activeSheet === "price") {
      const minPrice = priceDraft.minPrice ? Number(priceDraft.minPrice) : null;
      const maxPrice = priceDraft.maxPrice ? Number(priceDraft.maxPrice) : null;
      const invalidValue =
        (minPrice !== null && (!Number.isSafeInteger(minPrice) || minPrice < 0)) ||
        (maxPrice !== null && (!Number.isSafeInteger(maxPrice) || maxPrice < 0));

      if (invalidValue || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) {
        setPriceError("请输入有效的人民币价格区间");
        return;
      }

      navigate({ minPrice, maxPrice });
      closeSheet();
      return;
    }

    if (activeSheet === "sort") {
      navigate({ sort: draftValue as ProductSortMode });
    } else {
      navigate({ [activeSheet]: draftValue } as Partial<ProductQueryState>);
    }

    closeSheet();
  }

  function clearSheet() {
    if (activeSheet === "price") {
      setPriceDraft({ minPrice: "", maxPrice: "" });
      setPriceError("");
      return;
    }
    setDraftValue(activeSheet === "sort" ? "default" : "");
  }

  function clearFilters() {
    router.push("/products", { scroll: false });
  }

  function goToPage(page: number) {
    const safePage = Math.min(Math.max(page, 1), result.totalPages);
    if (safePage === result.currentPage) return;

    navigate(
      { page: safePage },
      { pageReset: false, scrollToList: true }
    );
  }

  const sheetOptions =
    activeSheet && activeSheet !== "more" ? optionsFor(activeSheet) : [];
  const filteredSheetOptions = sheetSearchText.trim()
    ? sheetOptions.filter((option) =>
        optionSearchText(activeSheet as FilterKind, option)
          .toLowerCase()
          .includes(sheetSearchText.trim().toLowerCase())
      )
    : sheetOptions;
  const sheetNeedsSearch =
    activeSheet === "brand" ||
    activeSheet === "country" ||
    activeSheet === "shape" ||
    sheetOptions.length > 18;
  return (
    <main
      className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]"
      style={{
        fontFamily:
          '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
        fontVariantNumeric: "lining-nums",
      }}
    >
      <SiteHeader />
      <PageBackBar />

      <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-1 sm:px-6 lg:px-10">
        <PageTitle />

        <section className="mt-5">
          <form onSubmit={handleSearchSubmit} className="relative flex h-11 items-center rounded-[5px] border border-[#e4d9cc] bg-white">
            <SearchIcon className="ml-4 h-[19px] w-[19px] shrink-0 text-[var(--text-secondary)]" />
            <input
              type="search"
              enterKeyHint="search"
              value={inputSearchText}
              onChange={(event) => setInputSearchText(event.target.value)}
              placeholder="搜索品牌、斗型、型号或名称"
              className="min-w-0 flex-1 bg-transparent px-3 pr-14 text-[12.5px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] [font-family:inherit]"
            />
            <button type="submit" className="absolute right-0 h-full px-4 text-[12px] font-medium text-[var(--coffee)] transition-colors hover:text-[var(--coffee-dark)] [font-family:inherit]">
              搜索
            </button>
          </form>

          <div className="-mx-4 mt-5 flex h-[39px] gap-8 overflow-x-auto border-y border-[rgba(222,212,200,0.72)] px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STATUS_ITEMS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setStatus(item.value)}
                className={[
                  "relative h-full shrink-0 text-[12.5px] font-normal transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[var(--brass)] after:transition-transform [font-family:inherit]",
                  currentStatus === item.value
                    ? "font-medium text-[var(--text-primary)] after:scale-x-100"
                    : "text-[var(--text-secondary)] after:scale-x-0 hover:text-[var(--coffee)]",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex h-[42px] items-center justify-between border-b border-[rgba(222,212,200,0.72)]">
            <button type="button" onClick={() => openSheet("more")} className="inline-flex items-center gap-1 text-[12.5px] font-normal text-[var(--text-primary)] transition-colors hover:text-[var(--coffee)] [font-family:inherit]">
              {active ? `筛选 ${activeFilterCount(result.state)}` : "筛选"}
              <ChevronDownIcon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            </button>
            <div className="flex items-center gap-4">
              {active ? (
                <button type="button" onClick={clearFilters} className="text-[11px] font-normal text-[var(--text-secondary)] transition-colors hover:text-[var(--coffee)] [font-family:inherit]">清空</button>
              ) : null}
              <button type="button" onClick={() => openSheet("sort")} className="inline-flex items-center gap-1 text-[12.5px] font-normal text-[var(--text-primary)] transition-colors hover:text-[var(--coffee)] [font-family:inherit]">
                排序 · {selectedLabel("sort") || "推荐"}
                <ChevronDownIcon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              </button>
            </div>
          </div>
        </section>

        <section ref={productListRef} id="product-list" className="mt-5 scroll-mt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[12px] font-normal text-[var(--text-secondary)]">
              共 <span className="text-[13px] font-medium text-[var(--brass)]">{result.filteredCount.toLocaleString()}</span> 件
            </p>
            <p className="hidden text-[12px] font-normal text-[var(--text-secondary)] sm:block">每页 {result.pageSize} 件</p>
          </div>

          {result.products.length > 0 ? (
            <>
              <ProductGrid products={result.products} returnTo={returnTo} variant="inventory" />
              <Pagination
                currentPage={result.currentPage}
                totalPages={result.totalPages}
                items={paginationItems}
                goToPage={goToPage}
              />
            </>
          ) : (
            <EmptyState clearFilters={clearFilters} />
          )}
        </section>

      </section>

      <SiteFooter />

      {activeSheet ? (
        <FilterSheet
          activeSheet={activeSheet}
          draftValue={draftValue}
          setDraftValue={setDraftValue}
          sheetSearchText={sheetSearchText}
          setSheetSearchText={setSheetSearchText}
          sheetNeedsSearch={sheetNeedsSearch}
          filteredSheetOptions={filteredSheetOptions}
          priceDraft={priceDraft}
          setPriceDraft={setPriceDraft}
          priceError={priceError}
          setPriceError={setPriceError}
          selectedLabel={selectedLabel}
          openSheet={openSheet}
          closeSheet={closeSheet}
          clearSheet={clearSheet}
          clearFilters={clearFilters}
          applySheet={applySheet}
        />
      ) : null}
    </main>
  );
}

function FilterSheet({
  activeSheet,
  draftValue,
  setDraftValue,
  sheetSearchText,
  setSheetSearchText,
  sheetNeedsSearch,
  filteredSheetOptions,
  priceDraft,
  setPriceDraft,
  priceError,
  setPriceError,
  selectedLabel,
  openSheet,
  closeSheet,
  clearSheet,
  clearFilters,
  applySheet,
}: {
  activeSheet: SheetKind;
  draftValue: string;
  setDraftValue: (value: string) => void;
  sheetSearchText: string;
  setSheetSearchText: (value: string) => void;
  sheetNeedsSearch: boolean;
  filteredSheetOptions: PublicFilterOption[];
  priceDraft: { minPrice: string; maxPrice: string };
  setPriceDraft: (value: { minPrice: string; maxPrice: string }) => void;
  priceError: string;
  setPriceError: (value: string) => void;
  selectedLabel: (kind: FilterKind) => string;
  openSheet: (kind: SheetKind) => void;
  closeSheet: () => void;
  clearSheet: () => void;
  clearFilters: () => void;
  applySheet: () => void;
}) {
  const title = activeSheet === "more" ? "更多筛选" : `选择${FILTER_LABELS[activeSheet]}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F1A16]/26 px-3 pb-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭筛选"
        onClick={closeSheet}
      />

      <div className="relative z-10 flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[9px] border border-[#E7DDD0] bg-[var(--surface)] sm:rounded-[9px]">
        <div className="flex items-center justify-between gap-3 border-b border-[rgba(222,212,200,0.72)] px-5 py-3.5">
          <div>
            <p className="text-[9.5px] font-normal uppercase tracking-[0.16em] text-[var(--brass)]">FILTER</p>
            <h3 className="mt-1 text-[18px] font-medium leading-[1.4] text-[var(--text-primary)]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={closeSheet}
            className="flex h-10 w-10 items-center justify-center text-[19px] font-normal text-[var(--text-secondary)] [font-family:inherit]"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {activeSheet === "more" ? (
          <div className="overflow-y-auto px-5 py-1">
            {ALL_FILTERS.map((item) => {
              const value = selectedLabel(item.kind);
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => openSheet(item.kind)}
                  className="flex min-h-[54px] w-full items-center justify-between gap-3 border-b border-[rgba(222,212,200,0.58)] py-2 text-left transition-colors hover:text-[var(--coffee)] [font-family:inherit]"
                >
                  <span className="text-[13.5px] font-normal text-[var(--text-primary)]">{item.label}</span>
                  <span className="line-clamp-1 text-[12.5px] font-normal text-[var(--text-secondary)]">{value || "全部"}</span>
                </button>
              );
            })}
            <button type="button" onClick={clearFilters} className="my-3 text-[12px] font-normal text-[var(--text-secondary)] transition-colors hover:text-[var(--coffee)] [font-family:inherit]">
              清空筛选
            </button>
          </div>
        ) : activeSheet === "price" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-x-4">
              {PRICE_RANGES.map((range) => {
                const selected =
                  priceDraft.minPrice === range.minPrice &&
                  priceDraft.maxPrice === range.maxPrice;
                return (
                  <button
                    key={range.label}
                    type="button"
                    onClick={() => {
                      setPriceDraft({ minPrice: range.minPrice, maxPrice: range.maxPrice });
                      setPriceError("");
                    }}
                    className={[
                      "relative flex min-h-11 items-center border-b border-[rgba(222,212,200,0.65)] text-left text-[12.5px] font-normal transition-colors [font-family:inherit]",
                      selected
                        ? "pl-2 font-medium text-[var(--text-primary)] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-[var(--brass)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--coffee)]",
                    ].join(" ")}
                  >
                    {range.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 border-t border-[rgba(222,212,200,0.58)] pt-4">
              <p className="text-[11px] font-normal text-[var(--text-secondary)]">自定义人民币参考价格</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-[11px] font-normal text-[var(--text-secondary)]">
                  最低价
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={priceDraft.minPrice}
                    onChange={(event) => {
                      setPriceDraft({ ...priceDraft, minPrice: event.target.value.replace(/\D/g, "") });
                      setPriceError("");
                    }}
                    className="mt-1.5 h-10 w-full rounded-[5px] border border-[#e4d9cc] bg-white px-3 text-[12.5px] text-[var(--text-primary)] outline-none [font-family:inherit]"
                  />
                </label>
                <label className="block text-[11px] font-normal text-[var(--text-secondary)]">
                  最高价
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={priceDraft.maxPrice}
                    onChange={(event) => {
                      setPriceDraft({ ...priceDraft, maxPrice: event.target.value.replace(/\D/g, "") });
                      setPriceError("");
                    }}
                    className="mt-1.5 h-10 w-full rounded-[5px] border border-[#e4d9cc] bg-white px-3 text-[12.5px] text-[var(--text-primary)] outline-none [font-family:inherit]"
                  />
                </label>
              </div>
              {priceError ? <p className="mt-2 text-[11px] text-[#9A6530]">{priceError}</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-[#EFE3D4] bg-[#FBF7EF] px-5 py-3">
              <button
                type="button"
                onClick={clearSheet}
                className="h-10 rounded-[4px] border border-[#d8cfc2] bg-white text-[13px] font-normal text-[var(--text-secondary)] [font-family:inherit]"
              >
                清除
              </button>
              <button
                type="button"
                onClick={applySheet}
                className="h-10 rounded-[4px] bg-[var(--coffee-dark)] text-[13px] font-medium text-[#f4eee7] [font-family:inherit]"
              >
                确认
              </button>
            </div>
          </div>
        ) : (
          <>
            {sheetNeedsSearch ? (
              <div className="border-b border-[#EFE3D4] px-5 py-3">
                <div className="flex h-10 items-center gap-2 rounded-[5px] border border-[#e4d9cc] bg-white px-3">
                  <SearchIcon className="h-4 w-4 text-[#8A8176]" />
                  <input
                    type="search"
                    value={sheetSearchText}
                    onChange={(event) => setSheetSearchText(event.target.value)}
                    placeholder={`搜索${FILTER_LABELS[activeSheet]}`}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#1F1A16] outline-none placeholder:text-[#8A8176] [font-family:inherit]"
                  />
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {filteredSheetOptions.length > 0 ? (
                <div
                  className={
                    activeSheet === "brand"
                      ? "grid grid-cols-2 gap-x-4"
                      : "divide-y divide-[rgba(222,212,200,0.58)]"
                  }
                >
                  {filteredSheetOptions.map((option) => {
                    const selected = draftValue === option.value;
                    const primary = optionPrimaryText(activeSheet, option);
                    const secondary = optionSecondaryText(activeSheet, option);
                    const brandDirectory = activeSheet === "brand";

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraftValue(option.value)}
                        className={[
                          brandDirectory
                            ? "relative min-h-[60px] min-w-0 border-b border-[rgba(222,212,200,0.58)] py-2 pr-7 text-left transition [font-family:inherit]"
                            : "relative flex min-h-11 w-full items-center justify-between gap-3 text-left text-[12.5px] font-normal transition [font-family:inherit]",
                          selected
                            ? "pl-2 font-medium text-[var(--text-primary)] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-[var(--brass)]"
                            : "text-[var(--text-secondary)] hover:text-[var(--coffee)]",
                        ].join(" ")}
                      >
                        {brandDirectory ? (
                          <span className="flex min-w-0 items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block line-clamp-2 text-[12.5px] font-medium leading-[1.35]">
                                {primary}
                              </span>
                              {secondary ? (
                                <span
                                  className={[
                                    "mt-1 block line-clamp-1 text-[10.5px] font-normal leading-[1.4]",
                                    selected ? "text-[var(--text-secondary)]" : "text-[#8A8176]",
                                  ].join(" ")}
                                >
                                  {secondary}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={[
                                "shrink-0 text-[11px] font-medium",
                                "text-[var(--brass)]",
                              ].join(" ")}
                            >
                              {option.productCount}
                            </span>
                          </span>
                        ) : (
                          <>
                            {primary}
                            {activeSheet !== "sort"
                              ? ` · ${option.productCount}`
                              : ""}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-[#746A5F]">没有匹配选项</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-[#EFE3D4] bg-[#FBF7EF] px-5 py-3">
              <button
                type="button"
                onClick={clearSheet}
                className="h-10 rounded-[4px] border border-[#d8cfc2] bg-white text-[13px] font-normal text-[var(--text-secondary)] [font-family:inherit]"
              >
                清除
              </button>
              <button
                type="button"
                onClick={applySheet}
                className="h-10 rounded-[4px] bg-[var(--coffee-dark)] text-[13px] font-medium text-[#f4eee7] [font-family:inherit]"
              >
                确认
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Pagination({
  currentPage,
  totalPages,
  items,
  goToPage,
}: {
  currentPage: number;
  totalPages: number;
  items: PaginationItem[];
  goToPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      className="mt-9 border-t border-[rgba(222,212,200,0.72)] pt-5"
      aria-label="商品分页"
    >
      <div className="flex items-center justify-between sm:hidden">
        <PageButton disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>
          ← 上一页
        </PageButton>
        <p className="text-center text-[12px] font-medium text-[var(--text-primary)]">第 {currentPage} / {totalPages} 页</p>
        <PageButton disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)}>
          下一页 →
        </PageButton>
      </div>
      <p className="mb-3 hidden text-center text-[12px] font-normal text-[var(--text-secondary)] sm:block">
        第 <span className="font-medium text-[var(--brass)]">{currentPage}</span> / {totalPages} 页
      </p>
      <div className="hidden flex-wrap items-center justify-center gap-3 sm:flex">
        <PageButton
          disabled={currentPage === 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          上一页
        </PageButton>

        {items.map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="flex h-9 w-7 items-center justify-center text-[12px] font-normal text-[var(--text-secondary)]"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => goToPage(item)}
              className={[
                "px-0.5 text-[12px] font-normal transition [font-family:inherit]",
                item === currentPage
                  ? "font-medium text-[var(--coffee-dark)] underline decoration-[var(--brass)] underline-offset-4"
                  : "text-[var(--text-secondary)] hover:text-[var(--coffee)]",
              ].join(" ")}
            >
              {item}
            </button>
          )
        )}

        <PageButton
          disabled={currentPage === totalPages}
          onClick={() => goToPage(currentPage + 1)}
        >
          下一页
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "px-0.5 text-[12px] font-normal transition [font-family:inherit]",
        disabled
          ? "cursor-not-allowed text-[#a99b8f]"
          : "text-[var(--text-primary)] hover:text-[var(--coffee)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function EmptyState({ clearFilters }: { clearFilters: () => void }) {
  return (
    <div className="border-y border-[rgba(222,212,200,0.72)] py-8 text-center">
      <p className="text-[18px] font-medium text-[var(--text-primary)]">暂无匹配结果</p>
      <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
        可以尝试减少关键词，或清空筛选查看完整库存。
      </p>
      <button
        type="button"
        onClick={clearFilters}
        className="mt-5 inline-flex h-10 items-center justify-center rounded-[4px] bg-[var(--coffee-dark)] px-5 text-[13px] font-medium text-[#f4eee7]"
      >
        清空筛选
      </button>
    </div>
  );
}

function PageTitle() {
  return (
    <EditorialHero
      imageSrc="/pics/overseas-head.png"
      eyebrow="OVERSEAS INVENTORY"
      title="海外精选烟斗"
      description="精选海外公开库存，持续更新价格与状态。"
      imagePosition="63% 58%"
    />
  );
}

function SearchIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16.2 16.2 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
