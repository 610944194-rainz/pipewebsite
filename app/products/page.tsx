"use client";

import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { filters, pipeProducts } from "../../data/pipes";
import type { PipeProduct } from "../../data/pipes";

type SortMode =
  | "recommended"
  | "priceAsc"
  | "priceDesc"
  | "newest"
  | "galleryFirst";

type PaginationItem = number | "ellipsis";

const PAGE_SIZE = 15;

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

function ProductCard({ pipe }: { pipe: PipeProduct }) {
  const galleryCount = getGalleryCount(pipe);
  const isSold = isSoldProduct(pipe);

  return (
    <article className="grid grid-cols-[112px_1fr] overflow-hidden rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:flex sm:h-full sm:flex-col">
      <div className="flex min-h-[132px] items-center justify-center bg-white p-3 sm:aspect-[4/3] sm:min-h-0">
        <img
          src={pipe.imageUrl}
          alt={pipe.name}
          className="h-auto max-h-[92%] w-auto max-w-[96%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 border-l border-[#F0E6D8] p-3.5 sm:border-l-0 sm:border-t">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-0.5 text-[11px] font-semibold text-[#9A6530]">
              {pipe.brand}
            </p>

            <h3 className="text-[15px] font-bold leading-snug text-[#2B211C] sm:text-[16px]">
              {pipe.name}
            </h3>
          </div>

          <span className="shrink-0 rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-medium text-[#75695F]">
            {pipe.condition}
          </span>
        </div>

        <p className="hidden text-[13px] leading-6 text-[#75695F] sm:block">
          {pipe.comment}
        </p>

        <div className="space-y-1.5 border-t border-[#F0E6D8] pt-2 text-[12px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#75695F]">海外原价</span>
            <span className="font-semibold text-[#9A6530]">
              {pipe.originalPrice}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[#75695F]">人民币参考</span>
            <span className="font-bold text-[#2B211C]">
              {pipe.estimatedCny}
            </span>
          </div>

          <div className="hidden items-center justify-between gap-3 sm:flex">
            <span className="text-[#75695F]">来源</span>
            <span className="font-semibold text-[#2B211C]">{pipe.source}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[#75695F]">库存</span>
            <span className="font-semibold text-[#2B211C]">{pipe.status}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {pipe.tags?.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-medium text-[#75695F]"
            >
              {tag}
            </span>
          ))}

          {galleryCount > 1 && (
            <span className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-medium text-[#9A6530]">
              {galleryCount} 图
            </span>
          )}

          {isSold && (
            <span className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-medium text-[#9A6530]">
              已售参考
            </span>
          )}
        </div>

        <Link
          href={`/products/${pipe.id}`}
          className="mt-auto flex h-9 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[12px] font-semibold text-white transition hover:bg-[#8F5522]"
        >
          查看详情 / 咨询
        </Link>
      </div>
    </article>
  );
}

export default function ProductsPage() {
  const [selectedFilter, setSelectedFilter] = useState("全部");
  const [inputSearchText, setInputSearchText] = useState("");
  const [activeSearchText, setActiveSearchText] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [hideSold, setHideSold] = useState(false);
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
  }, [selectedFilter, activeSearchText, sortMode, hideSold]);

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
      const matchesFilter =
        selectedFilter === "全部" ||
        pipe.tags?.includes(selectedFilter) ||
        pipe.condition === selectedFilter ||
        pipe.status === selectedFilter;

      const matchesSearch = !keyword || getSearchText(pipe).includes(keyword);

      const matchesSold = hideSold ? !isSoldProduct(pipe) : true;

      return matchesFilter && matchesSearch && matchesSold;
    });

    return sortProducts(filtered, sortMode);
  }, [selectedFilter, activeSearchText, sortMode, hideSold]);

  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, visibleProducts.length);

  const paginatedProducts = visibleProducts.slice(startIndex, endIndex);
  const paginationItems = getPaginationItems(safeCurrentPage, totalPages);

  const visibleStart = visibleProducts.length === 0 ? 0 : startIndex + 1;
  const visibleEnd = visibleProducts.length === 0 ? 0 : endIndex;

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveSearchText(inputSearchText);
    setCurrentPage(1);
  }

  function clearFilters() {
    setInputSearchText("");
    setActiveSearchText("");
    setSelectedFilter("全部");
    setHideSold(false);
    setSortMode("recommended");
    setCurrentPage(1);
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages || page === safeCurrentPage) return;

    shouldScrollToListRef.current = true;
    setCurrentPage(page);
  }

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
        <header className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
                OVERSEAS STOCK
              </p>

              <h1 className="text-[30px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
                海外烟斗库存精选
              </h1>

              <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
                当前为 The Danish Pipe Shop 公开页面采集数据。库存、价格、国际运费和预计税费仅供参考，最终以下单前人工确认为准。
              </p>
            </div>

            <Link
              href="/service"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-5 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              了解代购流程
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <div className="rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] p-3">
              <p className="text-[11px] text-[#75695F]">总商品数</p>
              <p className="mt-1 text-[23px] font-bold leading-none text-[#2B211C]">
                {totalCount}
              </p>
            </div>

            <div className="rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] p-3">
              <p className="text-[11px] text-[#75695F]">当前显示</p>
              <p className="mt-1 text-[23px] font-bold leading-none text-[#2B211C]">
                {visibleProducts.length}
              </p>
            </div>

            <div className="rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] p-3">
              <p className="text-[11px] text-[#75695F]">总页数</p>
              <p className="mt-1 text-[23px] font-bold leading-none text-[#9A6530]">
                {totalPages}
              </p>
            </div>
          </div>
        </header>

        <section className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
          <form
            onSubmit={handleSearchSubmit}
            className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr_0.75fr]"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold text-[#75695F]">
                搜索品牌 / 型号 / 标签
              </span>

              <div className="flex gap-2">
                <input
                  type="search"
                  enterKeyHint="search"
                  value={inputSearchText}
                  onChange={(event) => setInputSearchText(event.target.value)}
                  placeholder="例如 Anne Julie、Berggreen、Castello"
                  className="h-10 min-w-0 flex-1 rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] text-[#2B211C] outline-none transition placeholder:text-[#A09387] focus:border-[#A9682B]"
                />

                <button
                  type="submit"
                  className="h-10 shrink-0 rounded-full bg-[#A9682B] px-4 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
                >
                  搜索
                </button>
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold text-[#75695F]">
                排序方式
              </span>

              <select
                value={sortMode}
                onChange={(event) =>
                  setSortMode(event.target.value as SortMode)
                }
                className="h-10 w-full rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] text-[#2B211C] outline-none transition focus:border-[#A9682B]"
              >
                <option value="recommended">推荐排序</option>
                <option value="priceAsc">价格从低到高</option>
                <option value="priceDesc">价格从高到低</option>
                <option value="newest">最新更新</option>
                <option value="galleryFirst">多图优先</option>
              </select>
            </label>

            <div className="flex items-end">
              <label
                htmlFor="hide-sold-toggle"
                className={[
                  "flex h-10 w-full cursor-pointer select-none items-center justify-between rounded-full border px-4 text-[13px] font-semibold transition",
                  hideSold
                    ? "border-[#A9682B] bg-[#A9682B] text-white"
                    : "border-[#D8C5AE] bg-white text-[#2B211C]",
                ].join(" ")}
              >
                <span>{hideSold ? "已隐藏已售参考" : "隐藏已售参考"}</span>

                <input
                  id="hide-sold-toggle"
                  type="checkbox"
                  checked={hideSold}
                  onChange={(event) => setHideSold(event.target.checked)}
                  className="h-4 w-4 accent-[#A9682B]"
                />
              </label>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#75695F]">
            {activeSearchText.trim() ? (
              <span>
                当前搜索：
                <strong className="text-[#9A6530]">
                  {activeSearchText.trim()}
                </strong>
              </span>
            ) : (
              <span>输入关键词后会自动筛选，也可以点击“搜索”确认。</span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {filters.map((filter) => {
              const isActive = selectedFilter === filter;

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSelectedFilter(filter)}
                  className={[
                    "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                    isActive
                      ? "border-[#A9682B] bg-[#A9682B] text-white"
                      : "border-[#E5D7C5] bg-white text-[#75695F] hover:border-[#A9682B] hover:text-[#9A6530]",
                  ].join(" ")}
                >
                  {filter}
                </button>
              );
            })}
          </div>
        </section>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-[#75695F]">
            当前显示{" "}
            <span className="font-bold text-[#9A6530]">
              {visibleStart}–{visibleEnd}
            </span>{" "}
            /{" "}
            <span className="font-bold text-[#9A6530]">
              {visibleProducts.length}
            </span>{" "}
            只烟斗
          </p>

          {(activeSearchText || selectedFilter !== "全部" || hideSold) && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-start text-[13px] font-semibold text-[#9A6530] hover:text-[#A9682B] sm:self-auto"
            >
              清空筛选
            </button>
          )}
        </div>

        {visibleProducts.length > 0 ? (
          <>
            <div
              ref={productListRef}
              className="grid scroll-mt-4 gap-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"
            >
              {paginatedProducts.map((pipe) => (
                <ProductCard
                  key={`${pipe.id}-${pipe.sourceUrl}-${pipe.name}`}
                  pipe={pipe}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <nav
                className="mt-6 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-3 shadow-[0_4px_14px_rgba(43,33,28,0.03)]"
                aria-label="商品分页"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-center text-[12px] text-[#75695F] sm:text-left">
                    第{" "}
                    <span className="font-bold text-[#9A6530]">
                      {safeCurrentPage}
                    </span>{" "}
                    / {totalPages} 页
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => goToPage(safeCurrentPage - 1)}
                      disabled={safeCurrentPage === 1}
                      className={[
                        "h-9 rounded-full border px-3 text-[12px] font-semibold transition",
                        safeCurrentPage === 1
                          ? "cursor-not-allowed border-[#E5D7C5] bg-[#F6F1E8] text-[#B8AA9D]"
                          : "border-[#D8C5AE] bg-white text-[#2B211C] hover:border-[#A9682B]",
                      ].join(" ")}
                    >
                      上一页
                    </button>

                    {paginationItems.map((item, index) => {
                      if (item === "ellipsis") {
                        return (
                          <span
                            key={`ellipsis-${index}`}
                            className="flex h-9 w-8 items-center justify-center text-[12px] font-semibold text-[#75695F]"
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
                              ? "border-[#A9682B] bg-[#A9682B] text-white"
                              : "border-[#D8C5AE] bg-white text-[#2B211C] hover:border-[#A9682B]",
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
                          ? "cursor-not-allowed border-[#E5D7C5] bg-[#F6F1E8] text-[#B8AA9D]"
                          : "border-[#D8C5AE] bg-white text-[#2B211C] hover:border-[#A9682B]",
                      ].join(" ")}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </nav>
            )}
          </>
        ) : (
          <div className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-8 text-center shadow-[0_5px_18px_rgba(43,33,28,0.03)]">
            <p className="text-[20px] font-bold text-[#2B211C]">
              暂无匹配结果
            </p>
            <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
              可以尝试减少关键词，或者切换到“全部”分类查看完整库存。
            </p>
          </div>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}