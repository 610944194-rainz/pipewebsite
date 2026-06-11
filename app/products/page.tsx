"use client";

import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import {
  getConditionDisplayLabel,
  getProductChineseTitle,
  getProductEnglishTitle,
} from "../utils/display";
import { getRmbReferencePrice, RMB_REFERENCE_LABEL } from "../utils/price";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { pipeProducts } from "../../data/pipes";
import type { PipeProduct } from "../../data/pipes";

type SortMode =
  | "recommended"
  | "priceAsc"
  | "priceDesc"
  | "newest"
  | "galleryFirst";

type StatusMode = "all" | "available" | "sold" | "gallery";

type PaginationItem = number | "ellipsis";

type FilterKind =
  | "brand"
  | "country"
  | "shape"
  | "condition"
  | "weight"
  | "finish"
  | "sort";

type FilterOption = {
  label: string;
  value: string;
};

type ProductFilterOptions = {
  brands: FilterOption[];
  countries: FilterOption[];
  shapes: FilterOption[];
  conditions: FilterOption[];
  weights: FilterOption[];
  finishes: FilterOption[];
};

type IconProps = {
  className?: string;
};

const PAGE_SIZE = 20;

const WEIGHT_RANGE_LABELS: Record<string, string> = {
  light: "轻量 ≤35g",
  medium: "中等 36–55g",
  heavy: "偏重 56–75g",
  "extra-heavy": "重型 >75g",
};

const statusFilterItems: Array<{
  label: string;
  value: StatusMode;
}> = [
  { label: "全部", value: "all" },
  { label: "在售", value: "available" },
  { label: "已售参考", value: "sold" },
  { label: "多图完整", value: "gallery" },
];

const sortItems: Array<{
  label: string;
  value: SortMode;
}> = [
  { label: "推荐", value: "recommended" },
  { label: "价格从低到高", value: "priceAsc" },
  { label: "价格从高到低", value: "priceDesc" },
  { label: "最新更新", value: "newest" },
  { label: "多图优先", value: "galleryFirst" },
];

function isSoldProduct(pipe: PipeProduct) {
  return (
    pipe.status.includes("已售") ||
    pipe.tags?.some((tag) => tag.includes("已售")) ||
    false
  );
}

function getGalleryCount(pipe: PipeProduct) {
  return pipe.galleryImages?.length || 0;
}

function isKnownFilterValue(value: unknown) {
  const text = String(value || "").trim();
  return Boolean(text) && text.toLowerCase() !== "unknown";
}

function uniqueOptions(
  products: PipeProduct[],
  valueGetter: (pipe: PipeProduct) => string | undefined,
  labelGetter?: (pipe: PipeProduct) => string | undefined
) {
  const optionMap = new Map<string, string>();

  products.forEach((pipe) => {
    const value = String(valueGetter(pipe) || "").trim();
    if (!isKnownFilterValue(value)) return;

    const label = String(labelGetter?.(pipe) || value).trim();
    optionMap.set(value, label || value);
  });

  return [...optionMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"));
}

function getShapeFilterLabel(pipe: PipeProduct) {
  return String(pipe.shapeZh || pipe.shape || "")
    .replace(/^弯式/, "")
    .replace(/^直式/, "")
    .trim();
}

function getConditionFilterLabel(pipe: PipeProduct) {
  if (pipe.conditionType === "new") return "新斗";
  if (pipe.conditionType === "estate") return "回流";
  return pipe.conditionLabel || pipe.condition || "";
}

function getWeightRangeLabel(value: string | undefined) {
  return value ? WEIGHT_RANGE_LABELS[value] || value : "";
}

function buildProductFilterOptions(products: PipeProduct[]): ProductFilterOptions {
  return {
    brands: uniqueOptions(products, (pipe) => pipe.canonicalBrand || pipe.brand),
    countries: uniqueOptions(products, (pipe) => pipe.brandCountry),
    shapes: uniqueOptions(
      products,
      (pipe) => pipe.shape,
      (pipe) => getShapeFilterLabel(pipe)
    ),
    conditions: uniqueOptions(
      products,
      (pipe) => pipe.conditionType,
      (pipe) => getConditionFilterLabel(pipe)
    ),
    weights: uniqueOptions(
      products,
      (pipe) => pipe.weightRange,
      (pipe) => getWeightRangeLabel(pipe.weightRange)
    ),
    finishes: uniqueOptions(
      products,
      (pipe) => pipe.finish,
      (pipe) => pipe.finishZh || pipe.finish
    ),
  };
}

function getCardMetaTags(pipe: PipeProduct) {
  return [
    pipe.brandCountry,
    getConditionDisplayLabel(pipe),
    pipe.shapeZh,
    getWeightRangeLabel(pipe.weightRange),
    pipe.finishZh,
    pipe.stemMaterialZh,
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => isKnownFilterValue(value))
    .slice(0, 3);
}

function getSearchText(pipe: PipeProduct) {
  return [
    pipe.brand,
    pipe.canonicalBrand,
    pipe.name,
    pipe.nameZh,
    pipe.brandCountry,
    pipe.brandCountryEn,
    pipe.shape,
    pipe.shapeZh,
    pipe.finish,
    pipe.finishZh,
    pipe.material,
    pipe.materialZh,
    pipe.stemMaterial,
    pipe.stemMaterialZh,
    pipe.engineeringFeature,
    pipe.engineeringFeatureZh,
    pipe.grainPattern,
    pipe.grainPatternZh,
    pipe.source,
    pipe.status,
    pipe.condition,
    pipe.conditionLabel,
    pipe.audience,
    pipe.comment,
    pipe.detail,
    ...(pipe.tags || []),
    ...(pipe.parsedTags || []),
    ...(pipe.specsText || []),
  ]
    .join(" ")
    .toLowerCase();
}

function sortProducts(products: PipeProduct[], sortMode: SortMode) {
  const copied = [...products];

  if (sortMode === "priceAsc") {
    return copied.sort((a, b) => a.estimatedCnyValue - b.estimatedCnyValue);
  }

  if (sortMode === "priceDesc") {
    return copied.sort((a, b) => b.estimatedCnyValue - a.estimatedCnyValue);
  }

  if (sortMode === "newest") {
    return copied.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  if (sortMode === "galleryFirst") {
    return copied.sort((a, b) => getGalleryCount(b) - getGalleryCount(a));
  }

  return copied.sort((a, b) => {
    const aSold = isSoldProduct(a) ? 1 : 0;
    const bSold = isSoldProduct(b) ? 1 : 0;

    if (aSold !== bSold) {
      return aSold - bSold;
    }

    const galleryDiff = getGalleryCount(b) - getGalleryCount(a);

    if (galleryDiff !== 0) {
      return galleryDiff;
    }

    return a.estimatedCnyValue - b.estimatedCnyValue;
  });
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

function getStatusLabel(pipe: PipeProduct) {
  return isSoldProduct(pipe) ? "已售参考" : "在售";
}

function getStatusClass(pipe: PipeProduct) {
  return isSoldProduct(pipe)
    ? "bg-[#C47712] text-white"
    : "bg-[#063B32] text-white";
}

function ProductCard({
  pipe,
  returnTo,
}: {
  pipe: PipeProduct;
  returnTo: string;
}) {
  const galleryCount = getGalleryCount(pipe);
  const statusLabel = getStatusLabel(pipe);
  const chineseTitle = getProductChineseTitle(pipe);
  const englishTitle = getProductEnglishTitle(pipe);
  const displayName = chineseTitle || englishTitle || pipe.name;
  const englishName = chineseTitle ? englishTitle : "";
  const metaTags = getCardMetaTags(pipe);

  return (
    <Link
      href={`/products/${pipe.id}?returnTo=${encodeURIComponent(returnTo)}`}
      className="group block h-full overflow-hidden rounded-[18px] border border-[#E7DDD0] bg-white shadow-[0_6px_18px_rgba(31,26,22,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(31,26,22,0.1)]"
    >
      <article className="flex h-full flex-col">
        <div className="relative h-[122px] bg-[#F8F4EC] sm:h-[150px]">
          <img
            src={pipe.imageUrl}
            alt={displayName}
            className="h-full w-full object-contain p-2.5"
            draggable={false}
            loading="lazy"
          />

          <span
            className={[
              "absolute left-2 top-2 rounded-md px-1.5 py-1 text-[10px] font-medium leading-none shadow-sm",
              getStatusClass(pipe),
            ].join(" ")}
          >
            {statusLabel}
          </span>

          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#063B32] shadow-[0_4px_12px_rgba(31,26,22,0.1)]">
            <BookmarkIcon className="h-4 w-4" />
          </span>

          {galleryCount > 1 ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-white/92 px-2 py-0.5 text-[10px] font-medium text-[#746A5F] shadow-sm">
              {galleryCount} 图
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col p-2.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#9A6530]">
            {pipe.canonicalBrand || pipe.brand}
          </p>

          <h3 className="mt-1 line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-[1.35] text-[#1F1A16]">
            {displayName}
          </h3>

          {englishName ? (
            <p className="mt-1 line-clamp-1 min-h-5 text-[11px] leading-5 text-[#8A8176]">
              {englishName}
            </p>
          ) : (
            <span className="mt-1 block min-h-5" aria-hidden="true" />
          )}

          <div className="mt-2 space-y-1 border-t border-[#F0E6D8] pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#746A5F]">{RMB_REFERENCE_LABEL}</span>
              <span className="text-[11px] font-semibold text-[#1F1A16]">
                {getRmbReferencePrice(pipe as unknown as Record<string, unknown>)}
              </span>
            </div>
          </div>

          {metaTags.length > 0 ? (
            <div className="mt-2 flex min-h-[42px] flex-wrap content-start gap-1 overflow-hidden">
              {metaTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#F7F3EA] px-1.5 py-0.5 text-[10px] text-[#746A5F]"
              >
                {tag}
              </span>
              ))}
            </div>
          ) : (
            <span className="mt-2 block min-h-[42px]" aria-hidden="true" />
          )}

          <span className="mt-auto flex h-8 items-center justify-center rounded-full bg-[#063B32] text-[12px] font-semibold tracking-[0.04em] text-[#E7C48A] transition group-hover:bg-[#0A4A3E]">
            查看详情
          </span>
        </div>
      </article>
    </Link>
  );
}

function readProductsQueryFromUrl() {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }

  return new URLSearchParams(window.location.search);
}

function buildProductsHref({
  searchText,
  statusMode,
  sortMode,
  brandFilter,
  countryFilter,
  shapeFilter,
  conditionFilter,
  weightFilter,
  finishFilter,
  page,
}: {
  searchText: string;
  statusMode: StatusMode;
  sortMode: SortMode;
  brandFilter: string;
  countryFilter: string;
  shapeFilter: string;
  conditionFilter: string;
  weightFilter: string;
  finishFilter: string;
  page: number;
}) {
  const params = new URLSearchParams();

  if (searchText.trim()) params.set("q", searchText.trim());
  if (statusMode !== "all") params.set("status", statusMode);
  if (sortMode !== "recommended") params.set("sort", sortMode);
  if (brandFilter) params.set("brand", brandFilter);
  if (countryFilter) params.set("country", countryFilter);
  if (shapeFilter) params.set("shape", shapeFilter);
  if (conditionFilter) params.set("condition", conditionFilter);
  if (weightFilter) params.set("weight", weightFilter);
  if (finishFilter) params.set("finish", finishFilter);
  if (page > 1) params.set("page", String(page));

  const queryString = params.toString();
  return queryString ? `/products?${queryString}` : "/products";
}

function isStatusMode(value: string): value is StatusMode {
  return ["all", "available", "sold", "gallery"].includes(value);
}

function isSortMode(value: string): value is SortMode {
  return ["recommended", "priceAsc", "priceDesc", "newest", "galleryFirst"].includes(
    value
  );
}

export default function ProductsPage() {
  const [inputSearchText, setInputSearchText] = useState("");
  const [activeSearchText, setActiveSearchText] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [statusMode, setStatusMode] = useState<StatusMode>("all");
  const [brandFilter, setBrandFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [shapeFilter, setShapeFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [weightFilter, setWeightFilter] = useState("");
  const [finishFilter, setFinishFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isQueryReady, setIsQueryReady] = useState(false);

  const productListRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToListRef = useRef(false);
  const skipNextPageResetRef = useRef(false);
  const productFilterOptions = useMemo(
    () => buildProductFilterOptions(pipeProducts),
    []
  );

  useEffect(() => {
    const params = readProductsQueryFromUrl();
    const query = params.get("q") || "";
    const status = params.get("status") || "";
    const sort = params.get("sort") || "";
    const page = Number.parseInt(params.get("page") || "1", 10);

    skipNextPageResetRef.current = true;
    setInputSearchText(query);
    setActiveSearchText(query);
    if (isStatusMode(status)) setStatusMode(status);
    if (isSortMode(sort)) setSortMode(sort);
    setBrandFilter(params.get("brand") || "");
    setCountryFilter(params.get("country") || "");
    setShapeFilter(params.get("shape") || "");
    setConditionFilter(params.get("condition") || "");
    setWeightFilter(params.get("weight") || "");
    setFinishFilter(params.get("finish") || "");
    setCurrentPage(Number.isFinite(page) && page > 0 ? page : 1);
    setIsQueryReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveSearchText(inputSearchText);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [inputSearchText]);

  useEffect(() => {
    if (skipNextPageResetRef.current) {
      skipNextPageResetRef.current = false;
      return;
    }

    setCurrentPage(1);
  }, [
    activeSearchText,
    sortMode,
    statusMode,
    brandFilter,
    countryFilter,
    shapeFilter,
    conditionFilter,
    weightFilter,
    finishFilter,
  ]);

  useEffect(() => {
    if (!isQueryReady) return;

    const href = buildProductsHref({
      searchText: activeSearchText,
      statusMode,
      sortMode,
      brandFilter,
      countryFilter,
      shapeFilter,
      conditionFilter,
      weightFilter,
      finishFilter,
      page: currentPage,
    });

    const currentHref = `${window.location.pathname}${window.location.search}`;

    if (href !== currentHref) {
      window.history.replaceState(null, "", href);
    }
  }, [
    activeSearchText,
    statusMode,
    sortMode,
    brandFilter,
    countryFilter,
    shapeFilter,
    conditionFilter,
    weightFilter,
    finishFilter,
    currentPage,
    isQueryReady,
  ]);

  useEffect(() => {
    if (!shouldScrollToListRef.current) return;

    shouldScrollToListRef.current = false;

    requestAnimationFrame(() => {
      productListRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [currentPage]);

  const totalCount = pipeProducts.length;

  const visibleProducts = useMemo(() => {
    const keyword = activeSearchText.trim().toLowerCase();

    const filtered = pipeProducts.filter((pipe) => {
      const matchesSearch = !keyword || getSearchText(pipe).includes(keyword);

      const matchesStatus =
        statusMode === "all" ||
        (statusMode === "available" && !isSoldProduct(pipe)) ||
        (statusMode === "sold" && isSoldProduct(pipe)) ||
        (statusMode === "gallery" && getGalleryCount(pipe) > 1);

      const matchesBrand =
        !brandFilter || (pipe.canonicalBrand || pipe.brand) === brandFilter;
      const matchesCountry =
        !countryFilter || pipe.brandCountry === countryFilter;
      const matchesShape = !shapeFilter || pipe.shape === shapeFilter;
      const matchesCondition =
        !conditionFilter || pipe.conditionType === conditionFilter;
      const matchesWeight =
        !weightFilter || pipe.weightRange === weightFilter;
      const matchesFinish = !finishFilter || pipe.finish === finishFilter;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesBrand &&
        matchesCountry &&
        matchesShape &&
        matchesCondition &&
        matchesWeight &&
        matchesFinish
      );
    });

    return sortProducts(filtered, sortMode);
  }, [
    activeSearchText,
    sortMode,
    statusMode,
    brandFilter,
    countryFilter,
    shapeFilter,
    conditionFilter,
    weightFilter,
    finishFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, visibleProducts.length);

  const paginatedProducts = visibleProducts.slice(startIndex, endIndex);
  const paginationItems = getPaginationItems(safeCurrentPage, totalPages);
  const currentProductsHref = buildProductsHref({
    searchText: activeSearchText,
    statusMode,
    sortMode,
    brandFilter,
    countryFilter,
    shapeFilter,
    conditionFilter,
    weightFilter,
    finishFilter,
    page: safeCurrentPage,
  });

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveSearchText(inputSearchText);
    setCurrentPage(1);
  }

  function clearFilters() {
    setInputSearchText("");
    setActiveSearchText("");
    setStatusMode("all");
    setSortMode("recommended");
    setBrandFilter("");
    setCountryFilter("");
    setShapeFilter("");
    setConditionFilter("");
    setWeightFilter("");
    setFinishFilter("");
    setCurrentPage(1);
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages || page === safeCurrentPage) return;

    shouldScrollToListRef.current = true;
    setCurrentPage(page);
  }

  const hasActiveFilter =
    activeSearchText.trim() ||
    statusMode !== "all" ||
    sortMode !== "recommended" ||
    brandFilter ||
    countryFilter ||
    shapeFilter ||
    conditionFilter ||
    weightFilter ||
    finishFilter;

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

      <div className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-6 lg:px-10">
        <PageTitleCard />

        <SearchFilterCard
          totalCount={totalCount}
          resultCount={visibleProducts.length}
          inputSearchText={inputSearchText}
          setInputSearchText={setInputSearchText}
          handleSearchSubmit={handleSearchSubmit}
          statusMode={statusMode}
          setStatusMode={setStatusMode}
          brandFilter={brandFilter}
          setBrandFilter={setBrandFilter}
          countryFilter={countryFilter}
          setCountryFilter={setCountryFilter}
          shapeFilter={shapeFilter}
          setShapeFilter={setShapeFilter}
          conditionFilter={conditionFilter}
          setConditionFilter={setConditionFilter}
          weightFilter={weightFilter}
          setWeightFilter={setWeightFilter}
          finishFilter={finishFilter}
          setFinishFilter={setFinishFilter}
          productFilterOptions={productFilterOptions}
          sortMode={sortMode}
          setSortMode={setSortMode}
          clearFilters={clearFilters}
          hasActiveFilter={Boolean(hasActiveFilter)}
        />

        <section ref={productListRef} className="mt-6 scroll-mt-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[13px] text-[#746A5F]">
              共{" "}
              <span className="font-semibold text-[#A97838]">
                {visibleProducts.length}
              </span>{" "}
              件商品
            </p>

            <p className="text-[12px] text-[#746A5F]">
              每页 {PAGE_SIZE} 件
            </p>
          </div>

          {visibleProducts.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {paginatedProducts.map((pipe) => (
                  <ProductCard
                    key={`${pipe.id}-${pipe.sourceUrl}-${pipe.name}`}
                    pipe={pipe}
                    returnTo={currentProductsHref}
                  />
                ))}
              </div>

              {totalPages > 1 ? (
                <Pagination
                  safeCurrentPage={safeCurrentPage}
                  totalPages={totalPages}
                  paginationItems={paginationItems}
                  goToPage={goToPage}
                />
              ) : null}
            </>
          ) : (
            <EmptyState clearFilters={clearFilters} />
          )}
        </section>

        <ProductPageInfoFooter />
      </div>
    </main>
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
          <p className="text-[11px] uppercase tracking-[0.34em] text-[#A97838]">
            Overseas Inventory
          </p>

          <h1 className="mt-3 font-serif text-[30px] font-semibold leading-tight tracking-[0.06em] text-[#063B32] sm:text-[46px]">
            海外烟斗库存精选
          </h1>
        </div>
      </div>
    </header>
  );
}

function SearchFilterCard({
  totalCount,
  resultCount,
  inputSearchText,
  setInputSearchText,
  handleSearchSubmit,
  statusMode,
  setStatusMode,
  brandFilter,
  setBrandFilter,
  countryFilter,
  setCountryFilter,
  shapeFilter,
  setShapeFilter,
  conditionFilter,
  setConditionFilter,
  weightFilter,
  setWeightFilter,
  finishFilter,
  setFinishFilter,
  productFilterOptions,
  sortMode,
  setSortMode,
  clearFilters,
  hasActiveFilter,
}: {
  totalCount: number;
  resultCount: number;
  inputSearchText: string;
  setInputSearchText: (value: string) => void;
  handleSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  statusMode: StatusMode;
  setStatusMode: (value: StatusMode) => void;
  brandFilter: string;
  setBrandFilter: (value: string) => void;
  countryFilter: string;
  setCountryFilter: (value: string) => void;
  shapeFilter: string;
  setShapeFilter: (value: string) => void;
  conditionFilter: string;
  setConditionFilter: (value: string) => void;
  weightFilter: string;
  setWeightFilter: (value: string) => void;
  finishFilter: string;
  setFinishFilter: (value: string) => void;
  productFilterOptions: ProductFilterOptions;
  sortMode: SortMode;
  setSortMode: (value: SortMode) => void;
  clearFilters: () => void;
  hasActiveFilter: boolean;
}) {
  const [activeSheet, setActiveSheet] = useState<FilterKind | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [sheetSearchText, setSheetSearchText] = useState("");

  const filterLabels: Record<FilterKind, string> = {
    brand: "品牌",
    country: "国家",
    shape: "斗型",
    condition: "新旧",
    weight: "重量",
    finish: "表面工艺",
    sort: "排序",
  };

  const getCurrentValue = (kind: FilterKind) => {
    if (kind === "brand") return brandFilter;
    if (kind === "country") return countryFilter;
    if (kind === "shape") return shapeFilter;
    if (kind === "condition") return conditionFilter;
    if (kind === "weight") return weightFilter;
    if (kind === "finish") return finishFilter;
    return sortMode;
  };

  const getOptions = (kind: FilterKind): FilterOption[] => {
    if (kind === "brand") return productFilterOptions.brands;
    if (kind === "country") return productFilterOptions.countries;
    if (kind === "shape") return productFilterOptions.shapes;
    if (kind === "condition") return productFilterOptions.conditions;
    if (kind === "weight") return productFilterOptions.weights;
    if (kind === "finish") return productFilterOptions.finishes;
    return sortItems;
  };

  const getSelectedLabel = (kind: FilterKind) => {
    const value = getCurrentValue(kind);
    const label = getOptions(kind).find((option) => option.value === value)?.label;
    return value ? label || value : "";
  };

  const setValue = (kind: FilterKind, value: string) => {
    if (kind === "brand") setBrandFilter(value);
    if (kind === "country") setCountryFilter(value);
    if (kind === "shape") setShapeFilter(value);
    if (kind === "condition") setConditionFilter(value);
    if (kind === "weight") setWeightFilter(value);
    if (kind === "finish") setFinishFilter(value);
    if (kind === "sort") setSortMode(value as SortMode);
  };

  const openSheet = (kind: FilterKind) => {
    setActiveSheet(kind);
    setDraftValue(getCurrentValue(kind));
    setSheetSearchText("");
  };

  const closeSheet = () => {
    setActiveSheet(null);
    setDraftValue("");
    setSheetSearchText("");
  };

  const applySheet = () => {
    if (!activeSheet) return;
    setValue(activeSheet, draftValue);
    closeSheet();
  };

  const clearSheet = () => {
    setDraftValue(activeSheet === "sort" ? "recommended" : "");
  };

  const sheetOptions = activeSheet ? getOptions(activeSheet) : [];
  const filteredSheetOptions = sheetSearchText.trim()
    ? sheetOptions.filter((option) =>
        `${option.label} ${option.value}`
          .toLowerCase()
          .includes(sheetSearchText.trim().toLowerCase())
      )
    : sheetOptions;
  const sheetNeedsSearch =
    activeSheet === "brand" ||
    activeSheet === "country" ||
    activeSheet === "shape" ||
    sheetOptions.length > 18;
  const primaryFilterButtons: Array<{
    kind: FilterKind;
    label: string;
    compact?: boolean;
  }> = [
    { kind: "brand", label: "品牌" },
    { kind: "country", label: "国家" },
    { kind: "shape", label: "斗型" },
    { kind: "condition", label: "新旧" },
    { kind: "weight", label: "重量" },
    { kind: "finish", label: "表面工艺" },
  ];

  return (
    <section className="mt-5 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)] sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[160px_1fr] lg:items-center">
        <div className="rounded-2xl border border-[#E7DDD0] bg-[#FBF7EF] p-4">
          <p className="text-[12px] text-[#746A5F]">
            {hasActiveFilter ? "符合条件" : "总商品数"}
          </p>

          <p
            className="mt-1 text-[34px] font-semibold leading-none text-[#A97838]"
            style={{
              fontFamily: '"Georgia", "Times New Roman", serif',
            }}
          >
            {hasActiveFilter ? resultCount : totalCount}
          </p>
        </div>

        <div>
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-[#D8CFC2] bg-white px-4 text-[#746A5F]">
              <SearchIcon className="h-5 w-5 shrink-0 text-[#8A8176]" />

              <input
                type="search"
                enterKeyHint="search"
                value={inputSearchText}
                onChange={(event) => setInputSearchText(event.target.value)}
                placeholder="搜索品牌、斗型、型号、编号..."
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
      </div>

      <div className="mt-4">
        <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {statusFilterItems.map((item) => {
            const isActive = statusMode === item.value;

            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setStatusMode(item.value)}
                className={[
                  "rounded-full border px-4 py-2 text-[13px] font-semibold transition",
                  isActive
                    ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                    : "border-[#E7DDD0] bg-white text-[#746A5F] hover:border-[#A97838] hover:text-[#8A5D26]",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="-mx-2 mt-3 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primaryFilterButtons.map((item) => {
            const selectedLabel = getSelectedLabel(item.kind);
            const isActive = Boolean(getCurrentValue(item.kind));

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
                {selectedLabel ? `${item.label} · ${selectedLabel}` : item.label}
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => openSheet("sort")}
            className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-[#E7DDD0] bg-white px-4 text-[13px] font-semibold text-[#746A5F] transition hover:border-[#A97838] hover:text-[#8A5D26]"
          >
            更多
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[13px] font-medium text-[#8A5D26] hover:text-[#063B32]"
            >
              清空筛选
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => openSheet("sort")}
            className="flex h-10 items-center gap-1 rounded-full border border-[#E7DDD0] bg-white px-4 text-[13px] font-semibold text-[#1F1A16] transition hover:border-[#A97838] hover:text-[#8A5D26]"
          >
            排序 · {getSelectedLabel("sort") || "推荐"}
            <ChevronDownIcon className="h-4 w-4 text-[#8A8176]" />
          </button>
        </div>
      </div>

      {activeSheet ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F1A16]/26 px-3 pb-3 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`选择${filterLabels[activeSheet]}`}
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
                <p className="text-[11px] uppercase tracking-[0.24em] text-[#A97838]">
                  Filter
                </p>
                <h3 className="mt-1 text-[18px] font-bold text-[#1F1A16]">
                  选择{filterLabels[activeSheet]}
                </h3>
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

            {sheetNeedsSearch ? (
              <div className="border-b border-[#EFE3D4] px-5 py-3">
                <div className="flex h-10 items-center gap-2 rounded-full border border-[#E7DDD0] bg-white px-4">
                  <SearchIcon className="h-4 w-4 text-[#8A8176]" />
                  <input
                    type="search"
                    value={sheetSearchText}
                    onChange={(event) => setSheetSearchText(event.target.value)}
                    placeholder={`搜索${filterLabels[activeSheet]}`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1F1A16] outline-none placeholder:text-[#8A8176]"
                  />
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {filteredSheetOptions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {filteredSheetOptions.map((option) => {
                    const isSelected = draftValue === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraftValue(option.value)}
                        className={[
                          "rounded-full border px-4 py-2 text-[13px] font-semibold transition",
                          isSelected
                            ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                            : "border-[#E7DDD0] bg-white text-[#1F1A16] hover:border-[#A97838] hover:text-[#8A5D26]",
                        ].join(" ")}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-[#746A5F]">
                  没有匹配选项
                </p>
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
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Pagination({
  safeCurrentPage,
  totalPages,
  paginationItems,
  goToPage,
}: {
  safeCurrentPage: number;
  totalPages: number;
  paginationItems: PaginationItem[];
  goToPage: (page: number) => void;
}) {
  return (
    <nav
      className="mt-7 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]"
      aria-label="商品分页"
    >
      <p className="mb-3 text-center text-[12px] text-[#746A5F]">
        第{" "}
        <span className="font-semibold text-[#A97838]">
          {safeCurrentPage}
        </span>{" "}
        / {totalPages} 页
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => goToPage(safeCurrentPage - 1)}
          disabled={safeCurrentPage === 1}
          className={[
            "h-9 rounded-full border px-3 text-[12px] font-semibold transition",
            safeCurrentPage === 1
              ? "cursor-not-allowed border-[#E7DDD0] bg-[#F7F3EA] text-[#B8AA9D]"
              : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
          ].join(" ")}
        >
          上一页
        </button>

        {paginationItems.map((item, index) => {
          if (item === "ellipsis") {
            return (
              <span
                key={`ellipsis-${index}`}
                className="flex h-9 w-7 items-center justify-center text-[12px] font-semibold text-[#746A5F]"
              >
                …
              </span>
            );
          }

          const isActive = item === safeCurrentPage;

          return (
            <button
              key={item}
              type="button"
              onClick={() => goToPage(item)}
              className={[
                "h-9 min-w-9 rounded-full border px-3 text-[12px] font-semibold transition",
                isActive
                  ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                  : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
              ].join(" ")}
            >
              {item}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => goToPage(safeCurrentPage + 1)}
          disabled={safeCurrentPage === totalPages}
          className={[
            "h-9 rounded-full border px-3 text-[12px] font-semibold transition",
            safeCurrentPage === totalPages
              ? "cursor-not-allowed border-[#E7DDD0] bg-[#F7F3EA] text-[#B8AA9D]"
              : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
          ].join(" ")}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}

function EmptyState({ clearFilters }: { clearFilters: () => void }) {
  return (
    <div className="rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-8 text-center shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <p className="text-[20px] font-semibold text-[#1F1A16]">
        暂无匹配结果
      </p>

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

function ProductPageInfoFooter() {
  return (
    <footer className="mt-8 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#B8863B]/70 bg-[#FBF7EF]">
          <img
            src="/pics/yandoubuy-icon.png"
            alt="烟斗派"
            className="h-9 w-9 object-contain"
          />
        </span>

        <div>
          <p className="text-[18px] font-semibold text-[#1F1A16]">
            烟斗派 YandouBuy
          </p>

          <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-[#A97838]">
            Curated Pipes &amp; Sourcing
          </p>
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-7 text-[#746A5F]">
        本站仅展示海外公开烟斗器具库存信息与人工选品咨询，不提供站内支付。
        价格、状态、运费、关税及最终入手成本以人工确认为准。
      </p>

      <div className="mt-5 border-t border-[#E7DDD0] pt-4 text-[12px] leading-7 text-[#746A5F]">
        <p>ICP备案号：备案后展示</p>
        <p>公安备案号：备案后展示</p>
      </div>
    </footer>
  );
}

function SearchIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m16.2 16.2 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BookmarkIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 4.8c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v15.1l-5-3.1-5 3.1V4.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m7 9 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
