"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { filters, pipeProducts } from "../../data/pipes";
import type { PipeProduct } from "../../data/pipes";

type SortMode =
  | "recommended"
  | "priceAsc"
  | "priceDesc"
  | "newest"
  | "galleryFirst";

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

function ProductCard({ pipe }: { pipe: PipeProduct }) {
  const galleryCount = getGalleryCount(pipe);
  const isSold = isSoldProduct(pipe);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-[#4a2f20] bg-[#21150f]">
      <div className="flex aspect-[4/3] items-center justify-center bg-white p-5">
        <img
          src={pipe.imageUrl}
          alt={pipe.name}
          className="h-auto max-h-[94%] w-auto max-w-[98%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-sm text-[#d1934a]">{pipe.brand}</p>
            <h3 className="text-xl font-black leading-snug text-[#fff8ec]">
              {pipe.name}
            </h3>
          </div>

          <span className="shrink-0 rounded-full bg-[#2a1a12] px-3 py-1 text-xs text-[#d1934a]">
            {pipe.condition}
          </span>
        </div>

        <p className="mb-5 line-clamp-3 text-sm leading-7 text-[#f1dfc5]">
          {pipe.comment}
        </p>

        <div className="mb-4 mt-auto space-y-3 border-t border-[#342116] pt-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#b99b7d]">海外原价</span>
            <span className="font-bold text-[#f6c177]">
              {pipe.originalPrice}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-[#b99b7d]">人民币参考</span>
            <span className="font-bold">{pipe.estimatedCny}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-[#b99b7d]">来源</span>
            <span className="font-bold">{pipe.source}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-[#b99b7d]">库存</span>
            <span className="font-bold">{pipe.status}</span>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {pipe.tags?.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d8b58a]"
            >
              {tag}
            </span>
          ))}

          {galleryCount > 1 && (
            <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d1934a]">
              {galleryCount} 图
            </span>
          )}

          {isSold && (
            <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#f6c177]">
              已售参考
            </span>
          )}
        </div>

        <Link
          href={`/products/${pipe.id}`}
          className="flex min-h-12 items-center justify-center rounded-full bg-[#d1934a] px-5 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveSearchText(inputSearchText);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [inputSearchText]);

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

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveSearchText(inputSearchText);
  }

  function clearFilters() {
    setInputSearchText("");
    setActiveSearchText("");
    setSelectedFilter("全部");
    setHideSold(false);
    setSortMode("recommended");
  }

  return (
    <main className="min-h-screen bg-[#100a07] px-4 py-6 text-[#fff8ec] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 border-b border-[#3a2419] pb-6">
          <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.45em] text-[#c9904c]">
                OVERSEAS STOCK
              </p>

              <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
                海外烟斗库存精选
              </h1>

              <p className="mt-4 max-w-3xl text-sm leading-7 text-[#d8b58a] sm:text-base">
                当前为 The Danish Pipe Shop 公开页面采集数据。库存、价格、国际运费和预计税费仅供参考，最终以下单前人工确认为准。
              </p>
            </div>

            <Link
              href="/service"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#6b422b] px-6 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
            >
              了解代购流程
            </Link>
          </div>

          <div className="rounded-[1.5rem] border border-[#3a2419] bg-[#1a100b] p-5">
            <p className="text-sm text-[#b99b7d]">总商品数</p>
            <p className="mt-2 text-4xl font-black">{totalCount}</p>
          </div>
        </header>

        <section className="mb-8 rounded-[1.5rem] border border-[#3a2419] bg-[#1a100b] p-4 sm:p-5">
          <form
            onSubmit={handleSearchSubmit}
            className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr_0.75fr]"
          >
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-[#b99b7d]">
                搜索品牌 / 型号 / 标签
              </span>

              <div className="flex gap-2">
                <input
                  type="search"
                  enterKeyHint="search"
                  value={inputSearchText}
                  onChange={(event) => setInputSearchText(event.target.value)}
                  placeholder="例如 Anne Julie、Berggreen、Castello、高端收藏"
                  className="h-12 min-w-0 flex-1 rounded-full border border-[#4a2f20] bg-[#100a07] px-5 text-sm text-[#fff8ec] outline-none transition placeholder:text-[#7f6754] focus:border-[#d1934a]"
                />

                <button
                  type="submit"
                  className="h-12 shrink-0 rounded-full bg-[#d1934a] px-5 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
                >
                  搜索
                </button>
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold text-[#b99b7d]">
                排序方式
              </span>

              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-12 w-full rounded-full border border-[#4a2f20] bg-[#100a07] px-5 text-sm text-[#fff8ec] outline-none transition focus:border-[#d1934a]"
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
                  "flex min-h-12 w-full cursor-pointer select-none items-center justify-between rounded-full border px-5 text-sm font-bold transition",
                  hideSold
                    ? "border-[#d1934a] bg-[#d1934a] text-[#120b08]"
                    : "border-[#4a2f20] bg-[#100a07] text-[#fff8ec]",
                ].join(" ")}
              >
                <span>{hideSold ? "已隐藏已售参考" : "隐藏已售参考"}</span>

                <input
                  id="hide-sold-toggle"
                  type="checkbox"
                  checked={hideSold}
                  onChange={(event) => setHideSold(event.target.checked)}
                  className="h-5 w-5 accent-[#d1934a]"
                />
              </label>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#b99b7d]">
            {activeSearchText.trim() ? (
              <span>
                当前搜索：
                <strong className="text-[#f6c177]">
                  {activeSearchText.trim()}
                </strong>
              </span>
            ) : (
              <span>输入关键词后会自动筛选，也可以点击“搜索”确认。</span>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {filters.map((filter) => {
              const isActive = selectedFilter === filter;

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSelectedFilter(filter)}
                  className={[
                    "rounded-full border px-4 py-2 text-sm font-bold transition",
                    isActive
                      ? "border-[#d1934a] bg-[#d1934a] text-[#120b08]"
                      : "border-[#4a2f20] bg-[#160d09] text-[#fff8ec] hover:border-[#d1934a] hover:text-[#d1934a]",
                  ].join(" ")}
                >
                  {filter}
                </button>
              );
            })}
          </div>
        </section>

        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-[#b99b7d]">
            当前显示{" "}
            <span className="font-bold text-[#f6c177]">
              {visibleProducts.length}
            </span>{" "}
            只烟斗
          </p>

          {(activeSearchText || selectedFilter !== "全部" || hideSold) && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-bold text-[#d1934a] hover:text-[#f6c177]"
            >
              清空筛选
            </button>
          )}
        </div>

        {visibleProducts.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {visibleProducts.map((pipe) => (
              <ProductCard
                key={`${pipe.id}-${pipe.sourceUrl}-${pipe.name}`}
                pipe={pipe}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[1.5rem] border border-[#3a2419] bg-[#1a100b] p-10 text-center">
            <p className="text-xl font-black">暂无匹配结果</p>
            <p className="mt-3 text-sm leading-7 text-[#b99b7d]">
              可以尝试减少关键词，或者切换到“全部”分类查看完整库存。
            </p>
          </div>
        )}
      </div>
    </main>
  );
}