"use client";

import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
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

type IconProps = {
  className?: string;
};

const PAGE_SIZE = 20;

const futureFilterItems = ["国家", "斗型", "品牌", "价格区间", "材质"];

const statusFilterItems: Array<{
  label: string;
  value: StatusMode;
}> = [
  { label: "全部", value: "all" },
  { label: "在售", value: "available" },
  { label: "已售参考", value: "sold" },
  { label: "多图完整", value: "gallery" },
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

function getSearchText(pipe: PipeProduct) {
  return [
    pipe.brand,
    pipe.name,
    pipe.source,
    pipe.status,
    pipe.condition,
    pipe.audience,
    pipe.comment,
    pipe.detail,
    ...(pipe.tags || []),
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

function ProductCard({ pipe }: { pipe: PipeProduct }) {
  const galleryCount = getGalleryCount(pipe);
  const statusLabel = getStatusLabel(pipe);

  return (
    <Link
      href={`/products/${pipe.id}`}
      className="group block h-full overflow-hidden rounded-[18px] border border-[#E7DDD0] bg-white shadow-[0_6px_18px_rgba(31,26,22,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(31,26,22,0.1)]"
    >
      <article className="flex h-full flex-col">
        <div className="relative h-[122px] bg-[#F8F4EC] sm:h-[150px]">
          <img
            src={pipe.imageUrl}
            alt={pipe.name}
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
            {pipe.brand}
          </p>

          <h3 className="mt-1 line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-[1.35] text-[#1F1A16]">
            {pipe.name}
          </h3>

          

          <div className="mt-2 space-y-1 border-t border-[#F0E6D8] pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#746A5F]">海外原价</span>
              <span
                className="text-[12px] font-medium text-[#A97838]"
                style={{
                  fontFamily:
                    '"Georgia", "Times New Roman", "PingFang SC", serif',
                  fontVariantNumeric: "lining-nums",
                }}
              >
                {pipe.originalPrice}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#746A5F]">人民币参考</span>
              <span className="text-[11px] font-semibold text-[#1F1A16]">
                {pipe.estimatedCny}
              </span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {pipe.tags?.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#F7F3EA] px-1.5 py-0.5 text-[10px] text-[#746A5F]"
              >
                {tag}
              </span>
            ))}
          </div>

          <span className="mt-3 flex h-8 items-center justify-center rounded-full bg-[#063B32] text-[12px] font-semibold tracking-[0.04em] text-[#E7C48A] transition group-hover:bg-[#0A4A3E]">
            查看详情
          </span>
        </div>
      </article>
    </Link>
  );
}

export default function ProductsPage() {
  const [inputSearchText, setInputSearchText] = useState("");
  const [activeSearchText, setActiveSearchText] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [statusMode, setStatusMode] = useState<StatusMode>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const productListRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToListRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveSearchText(inputSearchText);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [inputSearchText]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeSearchText, sortMode, statusMode]);

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

      return matchesSearch && matchesStatus;
    });

    return sortProducts(filtered, sortMode);
  }, [activeSearchText, sortMode, statusMode]);

  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, visibleProducts.length);

  const paginatedProducts = visibleProducts.slice(startIndex, endIndex);
  const paginationItems = getPaginationItems(safeCurrentPage, totalPages);

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
    sortMode !== "recommended";

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
          inputSearchText={inputSearchText}
          setInputSearchText={setInputSearchText}
          handleSearchSubmit={handleSearchSubmit}
          statusMode={statusMode}
          setStatusMode={setStatusMode}
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
  inputSearchText,
  setInputSearchText,
  handleSearchSubmit,
  statusMode,
  setStatusMode,
  sortMode,
  setSortMode,
  clearFilters,
  hasActiveFilter,
}: {
  totalCount: number;
  inputSearchText: string;
  setInputSearchText: (value: string) => void;
  handleSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  statusMode: StatusMode;
  setStatusMode: (value: StatusMode) => void;
  sortMode: SortMode;
  setSortMode: (value: SortMode) => void;
  clearFilters: () => void;
  hasActiveFilter: boolean;
}) {
  return (
    <section className="mt-5 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)] sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[160px_1fr] lg:items-center">
        <div className="rounded-2xl border border-[#E7DDD0] bg-[#FBF7EF] p-4">
          <p className="text-[12px] text-[#746A5F]">总商品数</p>

          <p
            className="mt-1 text-[34px] font-semibold leading-none text-[#A97838]"
            style={{
              fontFamily: '"Georgia", "Times New Roman", serif',
            }}
          >
            {totalCount}
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

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {futureFilterItems.map((item) => (
          <button
            key={item}
            type="button"
            className="flex h-10 items-center justify-center gap-1 rounded-full border border-[#E7DDD0] bg-white px-3 text-[13px] font-medium text-[#1F1A16] transition hover:border-[#A97838] hover:text-[#8A5D26]"
          >
            {item}
            <ChevronDownIcon className="h-3.5 w-3.5 text-[#8A8176]" />
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
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

        <div className="flex items-center gap-2">
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[13px] font-medium text-[#8A5D26] hover:text-[#063B32]"
            >
              清空筛选
            </button>
          ) : null}

          <label className="relative">
            <span className="sr-only">排序方式</span>

            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="h-10 appearance-none rounded-full border border-[#E7DDD0] bg-white pl-4 pr-9 text-[13px] font-medium text-[#1F1A16] outline-none transition focus:border-[#A97838]"
            >
              <option value="recommended">排序：推荐</option>
              <option value="priceAsc">价格从低到高</option>
              <option value="priceDesc">价格从高到低</option>
              <option value="newest">最新更新</option>
              <option value="galleryFirst">多图优先</option>
            </select>

            <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8176]" />
          </label>
        </div>
      </div>
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