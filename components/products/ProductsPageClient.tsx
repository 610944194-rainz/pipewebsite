"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/app/components/SiteHeader";
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
  { label: "多图完整", value: "gallery" },
];

const FILTER_LABELS: Record<FilterKind, string> = {
  brand: "品牌",
  country: "国家",
  shape: "斗型",
  condition: "新旧",
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
  { kind: "weight", label: "重量" },
  { kind: "finish", label: "表面工艺" },
];

const SECONDARY_FILTERS: Array<{ kind: FilterKind; label: string }> = [
  { kind: "source", label: "来源" },
  { kind: "bowlMaterial", label: "斗钵材质" },
  { kind: "stemMaterial", label: "斗嘴材质" },
  { kind: "filter", label: "滤芯" },
];

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
      state.inventory !== "all" ||
      state.galleryOnly ||
      state.sort !== "default"
  );
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
    return result.state[kind];
  }

  function optionsFor(kind: FilterKind): PublicFilterOption[] {
    if (kind === "sort") return sortOptions();
    return filters[kind] || [];
  }

  function selectedLabel(kind: FilterKind) {
    const value = currentValue(kind);
    if (!value || (kind === "sort" && value === "default")) return "";
    const option = optionsFor(kind).find((item) => item.value === value);
    return option ? optionPrimaryText(kind, option) : String(value);
  }

  function openSheet(kind: SheetKind) {
    setActiveSheet(kind);
    setDraftValue(kind === "more" ? "" : String(currentValue(kind)));
    setSheetSearchText("");
  }

  function closeSheet() {
    setActiveSheet(null);
    setDraftValue("");
    setSheetSearchText("");
  }

  function applySheet() {
    if (!activeSheet || activeSheet === "more") return;

    if (activeSheet === "sort") {
      navigate({ sort: draftValue as ProductSortMode });
    } else {
      navigate({ [activeSheet]: draftValue } as Partial<ProductQueryState>);
    }

    closeSheet();
  }

  function clearSheet() {
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
  const secondaryActive = SECONDARY_FILTERS.some(({ kind }) =>
    Boolean(currentValue(kind))
  );

  return (
    <main
      className="min-h-screen bg-[#FBF7EF] text-[#1F1A16]"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "PingFang TC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
        fontVariantNumeric: "lining-nums",
      }}
    >
      <TopNotice />
      <SiteHeader />

      <section className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-6 lg:px-10">
        <PageTitleCard />

        <section className="mt-5 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)] sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[160px_1fr] lg:items-center">
            <div className="rounded-2xl border border-[#E7DDD0] bg-[#FBF7EF] p-4">
              <p className="text-[12px] text-[#746A5F]">
                {active ? "符合条件" : "总商品数"}
              </p>
              <p
                className="mt-1 text-[34px] font-semibold leading-none text-[#A97838]"
                style={{ fontFamily: '"Georgia", "Times New Roman", serif' }}
              >
                {active ? result.filteredCount : result.totalCount}
              </p>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <div className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-[#D8CFC2] bg-white px-4 text-[#746A5F]">
                <SearchIcon className="h-5 w-5 shrink-0 text-[#8A8176]" />
                <input
                  type="search"
                  enterKeyHint="search"
                  value={inputSearchText}
                  onChange={(event) => setInputSearchText(event.target.value)}
                  placeholder="搜索品牌、斗型、名称、编号..."
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-[#1F1A16] outline-none placeholder:text-[#8A8176]"
                />
              </div>
              <button
                type="submit"
                className="h-12 shrink-0 rounded-full bg-[#063B32] px-5 text-[14px] font-semibold text-[#E7C48A] shadow-sm transition hover:bg-[#0A4A3E]"
              >
                搜索
              </button>
            </form>
          </div>

          <div className="mt-4">
            <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {STATUS_ITEMS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setStatus(item.value)}
                  className={[
                    "shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition",
                    currentStatus === item.value
                      ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                      : "border-[#E7DDD0] bg-white text-[#746A5F] hover:border-[#A97838] hover:text-[#8A5D26]",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="-mx-2 mt-3 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {PRIMARY_FILTERS.map((item) => {
                const label = selectedLabel(item.kind);
                const isActive = Boolean(currentValue(item.kind));

                return (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => openSheet(item.kind)}
                    className={[
                      "flex h-9 shrink-0 items-center gap-1 rounded-full border px-4 text-[13px] font-semibold transition",
                      isActive
                        ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                        : "border-[#E7DDD0] bg-white text-[#746A5F] hover:border-[#A97838] hover:text-[#8A5D26]",
                    ].join(" ")}
                  >
                    {label ? `${item.label} · ${label}` : item.label}
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => openSheet("more")}
                className={[
                  "flex h-9 shrink-0 items-center gap-1 rounded-full border px-4 text-[13px] font-semibold transition",
                  secondaryActive
                    ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                    : "border-[#E7DDD0] bg-white text-[#746A5F] hover:border-[#A97838] hover:text-[#8A5D26]",
                ].join(" ")}
              >
                更多筛选
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 flex min-h-10 items-center justify-between gap-2">
              {active ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[13px] font-medium text-[#8A5D26] hover:text-[#063B32]"
                >
                  清空筛选
                </button>
              ) : (
                <span />
              )}

              <button
                type="button"
                onClick={() => openSheet("sort")}
                className="flex h-10 items-center gap-1 rounded-full border border-[#E7DDD0] bg-white px-4 text-[13px] font-semibold text-[#1F1A16] transition hover:border-[#A97838] hover:text-[#8A5D26]"
              >
                排序 · {selectedLabel("sort") || "推荐"}
                <ChevronDownIcon className="h-4 w-4 text-[#8A8176]" />
              </button>
            </div>
          </div>
        </section>

        <section ref={productListRef} id="product-list" className="mt-6 scroll-mt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-[#746A5F]">
              共 <span className="font-semibold text-[#A97838]">{result.filteredCount}</span> 件商品
            </p>
            <p className="text-[12px] text-[#746A5F]">每页 {result.pageSize} 件</p>
          </div>

          {result.products.length > 0 ? (
            <>
              <ProductGrid products={result.products} returnTo={returnTo} />
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

        <ProductPageInfoFooter />
      </section>

      {activeSheet ? (
        <FilterSheet
          activeSheet={activeSheet}
          draftValue={draftValue}
          setDraftValue={setDraftValue}
          sheetSearchText={sheetSearchText}
          setSheetSearchText={setSheetSearchText}
          sheetNeedsSearch={sheetNeedsSearch}
          filteredSheetOptions={filteredSheetOptions}
          selectedLabel={selectedLabel}
          openSheet={openSheet}
          closeSheet={closeSheet}
          clearSheet={clearSheet}
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
  selectedLabel,
  openSheet,
  closeSheet,
  clearSheet,
  applySheet,
}: {
  activeSheet: SheetKind;
  draftValue: string;
  setDraftValue: (value: string) => void;
  sheetSearchText: string;
  setSheetSearchText: (value: string) => void;
  sheetNeedsSearch: boolean;
  filteredSheetOptions: PublicFilterOption[];
  selectedLabel: (kind: FilterKind) => string;
  openSheet: (kind: SheetKind) => void;
  closeSheet: () => void;
  clearSheet: () => void;
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

      <div className="relative z-10 flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_22px_60px_rgba(31,26,22,0.18)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#EFE3D4] px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[#A97838]">Filter</p>
            <h3 className="mt-1 text-[18px] font-bold text-[#1F1A16]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={closeSheet}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E7DDD0] bg-white text-[18px] font-semibold text-[#746A5F]"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {activeSheet === "more" ? (
          <div className="grid gap-3 overflow-y-auto px-5 py-5 sm:grid-cols-2">
            {SECONDARY_FILTERS.map((item) => {
              const value = selectedLabel(item.kind);
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => openSheet(item.kind)}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-[#E7DDD0] bg-white px-4 py-3 text-left transition hover:border-[#A97838]"
                >
                  <span className="text-[13px] font-semibold text-[#1F1A16]">{item.label}</span>
                  <span className="line-clamp-1 text-[12px] text-[#8A5D26]">{value || "全部"}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {sheetNeedsSearch ? (
              <div className="border-b border-[#EFE3D4] px-5 py-3">
                <div className="flex h-10 items-center gap-2 rounded-full border border-[#E7DDD0] bg-white px-4">
                  <SearchIcon className="h-4 w-4 text-[#8A8176]" />
                  <input
                    type="search"
                    value={sheetSearchText}
                    onChange={(event) => setSheetSearchText(event.target.value)}
                    placeholder={`搜索${FILTER_LABELS[activeSheet]}`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1F1A16] outline-none placeholder:text-[#8A8176]"
                  />
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {filteredSheetOptions.length > 0 ? (
                <div
                  className={
                    activeSheet !== "sort"
                      ? "grid grid-cols-2 gap-2"
                      : "flex flex-wrap gap-2"
                  }
                >
                  {filteredSheetOptions.map((option) => {
                    const selected = draftValue === option.value;
                    const primary = optionPrimaryText(activeSheet, option);
                    const secondary = optionSecondaryText(activeSheet, option);
                    const cardLayout = activeSheet !== "sort";

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraftValue(option.value)}
                        className={[
                          cardLayout
                            ? "min-w-0 rounded-2xl border px-3 py-2.5 text-left transition"
                            : "rounded-full border px-4 py-2 text-[13px] font-semibold transition",
                          selected
                            ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                            : "border-[#E7DDD0] bg-white text-[#1F1A16] hover:border-[#A97838] hover:text-[#8A5D26]",
                        ].join(" ")}
                      >
                        {cardLayout ? (
                          <span className="flex min-w-0 items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block line-clamp-1 text-[13px] font-semibold">
                                {primary}
                              </span>
                              {secondary ? (
                                <span
                                  className={[
                                    "mt-0.5 block line-clamp-1 text-[10px]",
                                    selected ? "text-[#E7C48A]/75" : "text-[#8A8176]",
                                  ].join(" ")}
                                >
                                  {secondary}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={[
                                "shrink-0 text-[10px] font-semibold",
                                selected ? "text-[#E7C48A]/80" : "text-[#A97838]",
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

            <div className="grid grid-cols-2 gap-3 border-t border-[#EFE3D4] bg-[#FBF7EF] px-5 py-4">
              <button
                type="button"
                onClick={clearSheet}
                className="h-11 rounded-full border border-[#D8CFC2] bg-white text-[14px] font-semibold text-[#746A5F]"
              >
                清除
              </button>
              <button
                type="button"
                onClick={applySheet}
                className="h-11 rounded-full bg-[#063B32] text-[14px] font-semibold text-[#E7C48A]"
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
      className="mt-7 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]"
      aria-label="商品分页"
    >
      <p className="mb-3 text-center text-[12px] text-[#746A5F]">
        第 <span className="font-semibold text-[#A97838]">{currentPage}</span> / {totalPages} 页
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
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
              className="flex h-9 w-7 items-center justify-center text-[12px] font-semibold text-[#746A5F]"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => goToPage(item)}
              className={[
                "h-9 min-w-9 rounded-full border px-3 text-[12px] font-semibold transition",
                item === currentPage
                  ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                  : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
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
        "h-9 rounded-full border px-3 text-[12px] font-semibold transition",
        disabled
          ? "cursor-not-allowed border-[#E7DDD0] bg-[#F7F3EA] text-[#B8AA9D]"
          : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function EmptyState({ clearFilters }: { clearFilters: () => void }) {
  return (
    <div className="rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-8 text-center shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <p className="text-[20px] font-semibold text-[#1F1A16]">暂无匹配结果</p>
      <p className="mt-2 text-[13px] leading-6 text-[#746A5F]">
        可以尝试减少关键词，或清空筛选查看完整库存。
      </p>
      <button
        type="button"
        onClick={clearFilters}
        className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[#063B32] px-5 text-[13px] font-semibold text-[#E7C48A]"
      >
        清空筛选
      </button>
    </div>
  );
}

function TopNotice() {
  return (
    <div className="bg-[#063B32] px-4 py-2 text-center text-[12px] tracking-[0.12em] text-[#E7C48A] sm:text-[13px]">
      <span className="mx-2 text-[#B8863B]">•</span>
      精选海外烟斗库存 · 人工选品咨询
      <span className="mx-2 text-[#B8863B]">•</span>
    </div>
  );
}

function PageTitleCard() {
  return (
    <header className="overflow-hidden rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <div className="relative min-h-[142px] px-5 py-5 sm:min-h-[180px] sm:px-8 sm:py-8">
        <div className="absolute inset-y-0 right-0 hidden w-[44%] bg-[url('/pics/home-hero-01-inventory.jpg')] bg-cover bg-center opacity-80 sm:block" />
        <div className="absolute inset-y-0 right-0 hidden w-[52%] bg-gradient-to-r from-[#FFFDF8] via-[#FFFDF8]/86 to-transparent sm:block" />
        <div className="relative z-10">
          <p className="text-[11px] uppercase tracking-[0.34em] text-[#A97838]">Overseas Inventory</p>
          <h1 className="mt-3 font-serif text-[30px] font-semibold leading-tight tracking-[0.06em] text-[#063B32] sm:text-[46px]">
            海外烟斗库存精选
          </h1>
        </div>
      </div>
    </header>
  );
}

function ProductPageInfoFooter() {
  return (
    <footer className="mt-8 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#B8863B]/70 bg-[#FBF7EF]">
          <img src="/pics/yandoubuy-icon.png" alt="烟斗派" className="h-9 w-9 object-contain" />
        </span>
        <div>
          <p className="text-[18px] font-semibold text-[#1F1A16]">烟斗派 YandouBuy</p>
          <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-[#A97838]">Curated Pipes &amp; Sourcing</p>
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-7 text-[#746A5F]">
        本站仅展示海外公开烟斗器具库存信息与人工选品咨询，不提供站内支付。价格、状态、运费、关税及最终入手成本以人工确认为准。
      </p>
    </footer>
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
