import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import {
  createFallbackBrand,
  getBrandByName,
  getBrandMetaBySlug,
  getProductBrandGroups,
  type PipeBrand,
} from "../../data/brands";
import { pipeProducts } from "../../data/pipes";

type BrandCard = PipeBrand & {
  productCount: number;
};

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    letter?: string;
    page?: string;
  }>;
};

type PaginationItem = number | "ellipsis";

const PAGE_SIZE = 12;

function getBrandCards(): BrandCard[] {
  return getProductBrandGroups(pipeProducts)
    .map((group) => {
      const brandMeta =
        getBrandMetaBySlug(group.slug) ?? getBrandByName(group.name);
      const fallbackBrand = createFallbackBrand(group.name, group.slug);

      return {
        ...fallbackBrand,
        ...(brandMeta ?? {}),
        name: group.name,
        slug: group.slug,
        productCount: group.products.length,
      };
    })
    .filter((brand) => brand.productCount > 0);
}

function sortBrandCards(brands: BrandCard[]) {
  return [...brands].sort((left, right) => {
    if (right.productCount !== left.productCount) {
      return right.productCount - left.productCount;
    }

    return left.name.localeCompare(right.name, "en");
  });
}

function getBrandInitial(name: string) {
  const normalizedName = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const match = normalizedName.match(/[a-z0-9]/i);

  return match ? match[0].toUpperCase() : "#";
}

function getSearchText(brand: BrandCard) {
  return [
    brand.name,
    brand.country,
    brand.level,
    brand.summary,
    ...brand.aliases,
  ]
    .join(" ")
    .toLowerCase();
}

function getAvailableLetters(brands: BrandCard[]) {
  return Array.from(new Set(brands.map((brand) => getBrandInitial(brand.name))))
    .sort((left, right) => left.localeCompare(right, "en"));
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

function buildBrandsHref({
  query,
  letter,
  page,
}: {
  query?: string;
  letter?: string;
  page?: number;
}) {
  const params = new URLSearchParams();

  if (query?.trim()) {
    params.set("q", query.trim());
  }

  if (letter) {
    params.set("letter", letter);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const queryString = params.toString();

  return queryString ? `/brands?${queryString}` : "/brands";
}

export default async function BrandsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = String(resolvedSearchParams?.q || "").trim();
  const activeLetter = String(resolvedSearchParams?.letter || "").trim();
  const requestedPage = Number.parseInt(
    String(resolvedSearchParams?.page || "1"),
    10
  );
  const brandCards = getBrandCards();
  const letters = getAvailableLetters(brandCards);
  const searchKeyword = searchQuery.toLowerCase();
  const filteredBrands = sortBrandCards(
    brandCards.filter((brand) => {
      const matchesSearch =
        !searchKeyword || getSearchText(brand).includes(searchKeyword);
      const matchesLetter =
        !activeLetter || getBrandInitial(brand.name) === activeLetter;

      return matchesSearch && matchesLetter;
    })
  );
  const totalPages = Math.max(1, Math.ceil(filteredBrands.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages
  );
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredBrands.length);
  const paginatedBrands = filteredBrands.slice(startIndex, endIndex);
  const paginationItems = getPaginationItems(safeCurrentPage, totalPages);
  const visibleStart = filteredBrands.length === 0 ? 0 : startIndex + 1;
  const visibleEnd = filteredBrands.length === 0 ? 0 : endIndex;
  const hasActiveFilters = Boolean(searchQuery || activeLetter);

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
              PIPE BRANDS
            </p>

            <h1 className="text-[30px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
              烟斗品牌库
            </h1>

            <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
              整理品牌来源、定位、工艺特点与当前库存关联，方便按品牌快速浏览和比较。
            </p>
          </header>

          <section className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
            <form
              action="/brands"
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-[#75695F]">
                  搜索品牌
                </span>

                <input
                  type="search"
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="例如 Chacom、Dunhill、W. O. Larsen"
                  className="h-10 w-full rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] text-[#2B211C] outline-none transition placeholder:text-[#A09387] focus:border-[#A9682B]"
                />
              </label>

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="h-10 rounded-full bg-[#A9682B] px-5 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
                >
                  搜索
                </button>

                {hasActiveFilters && (
                  <Link
                    href="/brands"
                    className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                  >
                    清空
                  </Link>
                )}
              </div>
            </form>

            <div className="mt-4 flex flex-col gap-2 text-[12px] text-[#75695F] sm:flex-row sm:items-center sm:justify-between">
              <p>
                当前共{" "}
                <span className="font-bold text-[#9A6530]">
                  {brandCards.length}
                </span>{" "}
                个品牌，筛选结果{" "}
                <span className="font-bold text-[#9A6530]">
                  {filteredBrands.length}
                </span>{" "}
                个
              </p>

              {filteredBrands.length > 0 && (
                <p>
                  当前显示{" "}
                  <span className="font-bold text-[#9A6530]">
                    {visibleStart}-{visibleEnd}
                  </span>
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/brands"
                className={[
                  "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                  !activeLetter && !searchQuery
                    ? "border-[#A9682B] bg-[#A9682B] text-white"
                    : "border-[#E5D7C5] bg-white text-[#75695F] hover:border-[#A9682B] hover:text-[#9A6530]",
                ].join(" ")}
              >
                All
              </Link>

              {letters.map((letter) => {
                const isActive = activeLetter === letter && !searchQuery;

                return (
                  <Link
                    key={letter}
                    href={buildBrandsHref({ letter })}
                    className={[
                      "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                      isActive
                        ? "border-[#A9682B] bg-[#A9682B] text-white"
                        : "border-[#E5D7C5] bg-white text-[#75695F] hover:border-[#A9682B] hover:text-[#9A6530]",
                    ].join(" ")}
                  >
                    {letter}
                  </Link>
                );
              })}
            </div>
          </section>

          {filteredBrands.length > 0 ? (
            <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {paginatedBrands.map((brand) => {
              return (
                <article
                  key={brand.slug}
                  className="flex h-full flex-col rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5"
                >
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#9A6530]">
                      {brand.country}
                    </span>
                    <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#75695F]">
                      {brand.level}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-[20px] font-bold leading-tight text-[#2B211C] sm:text-[22px]">
                        {brand.name}
                      </h2>

                      <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                        {brand.summary}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] px-3 py-2 text-center">
                      <p className="text-[22px] font-bold leading-none text-[#2B211C]">
                        {brand.productCount}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#75695F]">
                        库存
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-[#F0E6D8] pt-3">
                    <div className="flex items-center justify-between text-[12px] sm:text-[13px]">
                      <span className="text-[#75695F]">当前关联库存</span>
                      <span className="font-bold text-[#9A6530]">
                        {brand.productCount}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/brands/${brand.slug}`}
                    className="mt-4 flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
                  >
                    查看品牌
                  </Link>
                </article>
              );
              })}
            </div>
          ) : (
            <div className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-8 text-center shadow-[0_5px_18px_rgba(43,33,28,0.03)]">
              <p className="text-[20px] font-bold text-[#2B211C]">
                未找到相关品牌
              </p>
              <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                可以尝试减少关键词，或切换回 All 查看完整品牌库。
              </p>
            </div>
          )}

          {filteredBrands.length > 0 && totalPages > 1 && (
            <nav
              className="mt-6 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-3 shadow-[0_4px_14px_rgba(43,33,28,0.03)]"
              aria-label="品牌分页"
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
                  {safeCurrentPage === 1 ? (
                    <span className="h-9 rounded-full border border-[#E5D7C5] bg-[#F6F1E8] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
                      上一页
                    </span>
                  ) : (
                    <Link
                      href={buildBrandsHref({
                        query: searchQuery,
                        letter: activeLetter,
                        page: safeCurrentPage - 1,
                      })}
                      className="h-9 rounded-full border border-[#D8C5AE] bg-white px-3 py-2 text-[12px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                    >
                      上一页
                    </Link>
                  )}

                  {paginationItems.map((item, index) => {
                    if (item === "ellipsis") {
                      return (
                        <span
                          key={`ellipsis-${index}`}
                          className="flex h-9 w-8 items-center justify-center text-[12px] font-semibold text-[#75695F]"
                        >
                          ...
                        </span>
                      );
                    }

                    const isActive = item === safeCurrentPage;

                    return (
                      <Link
                        key={item}
                        href={buildBrandsHref({
                          query: searchQuery,
                          letter: activeLetter,
                          page: item,
                        })}
                        className={[
                          "h-9 min-w-9 rounded-full border px-3 py-2 text-center text-[12px] font-semibold transition",
                          isActive
                            ? "border-[#A9682B] bg-[#A9682B] text-white"
                            : "border-[#D8C5AE] bg-white text-[#2B211C] hover:border-[#A9682B]",
                        ].join(" ")}
                      >
                        {item}
                      </Link>
                    );
                  })}

                  {safeCurrentPage === totalPages ? (
                    <span className="h-9 rounded-full border border-[#E5D7C5] bg-[#F6F1E8] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
                      下一页
                    </span>
                  ) : (
                    <Link
                      href={buildBrandsHref({
                        query: searchQuery,
                        letter: activeLetter,
                        page: safeCurrentPage + 1,
                      })}
                      className="h-9 rounded-full border border-[#D8C5AE] bg-white px-3 py-2 text-[12px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                    >
                      下一页
                    </Link>
                  )}
                </div>
              </div>
            </nav>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
