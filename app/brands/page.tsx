import Link from "next/link";
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

type IconProps = {
  className?: string;
};

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

function getBrandShortName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim();

  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  if (words[0]) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return getBrandInitial(name);
}

function getBrandLogoUrl(brand: BrandCard) {
  const record = brand as Record<string, unknown>;
  const candidates = [
    record.logoUrl,
    record.logo,
    record.imageUrl,
    record.logoImage,
  ];

  const logo = candidates.find(
    (item) => typeof item === "string" && item.trim()
  );

  return typeof logo === "string" ? logo : "";
}

function getBrandChineseName(brand: BrandCard) {
  const record = brand as Record<string, unknown>;
  const candidates = [
    record.nameZh,
    record.brandZh,
    record.chineseName,
    record.nameChinese,
  ];

  const value = candidates.find(
    (item) => typeof item === "string" && item.trim()
  );

  return typeof value === "string" ? value : "";
}

function getSearchText(brand: BrandCard) {
  return [
    brand.name,
    getBrandChineseName(brand),
    brand.country,
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
  const hasActiveFilters = Boolean(searchQuery || activeLetter);

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

        <SearchFilterCard
          totalCount={brandCards.length}
          resultCount={filteredBrands.length}
          searchQuery={searchQuery}
          activeLetter={activeLetter}
          letters={letters}
          hasActiveFilters={hasActiveFilters}
        />

        <section className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[13px] text-[#746A5F]">
              共{" "}
              <span className="font-semibold text-[#A97838]">
                {filteredBrands.length}
              </span>{" "}
              个品牌
            </p>

            <p className="text-[12px] text-[#746A5F]">
              每页 {PAGE_SIZE} 个
            </p>
          </div>

          {filteredBrands.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {paginatedBrands.map((brand) => (
                  <BrandCardItem key={brand.slug} brand={brand} />
                ))}
              </div>

              {totalPages > 1 ? (
                <Pagination
                  safeCurrentPage={safeCurrentPage}
                  totalPages={totalPages}
                  paginationItems={paginationItems}
                  searchQuery={searchQuery}
                  activeLetter={activeLetter}
                />
              ) : null}
            </>
          ) : (
            <EmptyState />
          )}
        </section>

        <BrandPageInfoFooter />
      </section>
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
    <header className="overflow-hidden rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <div className="px-5 py-4 sm:px-7 sm:py-6">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[#A97838]">
          Pipe Brands
        </p>

        <h1 className="mt-2 font-serif text-[27px] font-semibold leading-tight tracking-[0.06em] text-[#063B32] sm:text-[40px]">
          烟斗品牌库
        </h1>
      </div>
    </header>
  );
}

function SearchFilterCard({
  totalCount,
  resultCount,
  searchQuery,
  activeLetter,
  letters,
  hasActiveFilters,
}: {
  totalCount: number;
  resultCount: number;
  searchQuery: string;
  activeLetter: string;
  letters: string[];
  hasActiveFilters: boolean;
}) {
  return (
    <section className="mt-5 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)] sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[160px_1fr] lg:items-center">
        <div className="rounded-2xl border border-[#E7DDD0] bg-[#FBF7EF] p-4">
          <p className="text-[12px] text-[#746A5F]">总品牌数</p>

          <p
            className="mt-1 text-[34px] font-semibold leading-none text-[#A97838]"
            style={{
              fontFamily: '"Georgia", "Times New Roman", serif',
            }}
          >
            {totalCount}
          </p>

          {hasActiveFilters ? (
            <p className="mt-2 text-[12px] text-[#746A5F]">
              筛选结果{" "}
              <span className="font-semibold text-[#063B32]">
                {resultCount}
              </span>
            </p>
          ) : null}
        </div>

        <form action="/brands" className="flex gap-2">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-[#D8CFC2] bg-white px-4 text-[#746A5F]">
            <SearchIcon className="h-5 w-5 shrink-0 text-[#8A8176]" />

            <input
              type="search"
              name="q"
              defaultValue={searchQuery}
              placeholder="搜索品牌（中文 / 英文）"
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

      <div className="mt-4 -mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max gap-2">
          <Link
            href="/brands"
            className={[
              "flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-[12px] font-semibold transition",
              !activeLetter && !searchQuery
                ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                : "border-[#E7DDD0] bg-white text-[#746A5F] hover:border-[#063B32] hover:text-[#063B32]",
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
                  "flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-[12px] font-semibold transition",
                  isActive
                    ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                    : "border-[#E7DDD0] bg-white text-[#746A5F] hover:border-[#063B32] hover:text-[#063B32]",
                ].join(" ")}
              >
                {letter}
              </Link>
            );
          })}
        </div>
      </div>

      {hasActiveFilters ? (
        <div className="mt-3 flex justify-end">
          <Link
            href="/brands"
            className="text-[13px] font-semibold text-[#8A5D26] hover:text-[#063B32]"
          >
            清空筛选
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function BrandCardItem({ brand }: { brand: BrandCard }) {
  const logoUrl = getBrandLogoUrl(brand);
  const chineseName = getBrandChineseName(brand);
  const shortName = getBrandShortName(brand.name);

  return (
    <article className="flex h-full flex-col rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_8px_22px_rgba(31,26,22,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(31,26,22,0.1)] sm:p-5">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
        <div className="flex h-[92px] w-[92px] items-center justify-center overflow-hidden rounded-2xl border border-[#E7DDD0] bg-white">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${brand.name} logo`}
              className="h-full w-full object-contain p-3"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FFFDF8] to-[#F1E7D8]">
              <span
                className="text-[28px] font-semibold tracking-[0.04em] text-[#063B32]"
                style={{
                  fontFamily: '"Georgia", "Times New Roman", serif',
                }}
              >
                {shortName}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-[#F7F3EA] px-2.5 py-1 text-[11px] font-semibold text-[#A97838]">
              {brand.country}
            </span>

            <div className="flex items-center gap-1.5 rounded-full bg-[#F7F3EA] px-2.5 py-1 text-[#063B32]">
              <InventoryIcon className="h-3.5 w-3.5" />
              <span className="text-[13px] font-semibold">
                {brand.productCount}
              </span>
            </div>
          </div>

          <h2 className="text-[19px] font-bold leading-tight text-[#063B32]">
            {brand.name}
          </h2>

          {chineseName ? (
            <p className="mt-1 text-[13px] font-semibold text-[#8A5D26]">
              {chineseName}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 flex-1 text-[13px] leading-7 text-[#746A5F]">
        {brand.summary}
      </p>

      <div className="mt-4 border-t border-[#F0E6D8] pt-4">
        <Link
          href={`/brands/${brand.slug}`}
          className="flex h-10 items-center justify-center rounded-full bg-[#063B32] px-4 text-[13px] font-semibold tracking-[0.04em] text-[#E7C48A] transition hover:bg-[#0A4A3E]"
        >
          查看品牌
        </Link>
      </div>
    </article>
  );
}

function Pagination({
  safeCurrentPage,
  totalPages,
  paginationItems,
  searchQuery,
  activeLetter,
}: {
  safeCurrentPage: number;
  totalPages: number;
  paginationItems: PaginationItem[];
  searchQuery: string;
  activeLetter: string;
}) {
  return (
    <nav
      className="mt-7 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]"
      aria-label="品牌分页"
    >
      <p className="mb-3 text-center text-[12px] text-[#746A5F]">
        第{" "}
        <span className="font-semibold text-[#A97838]">
          {safeCurrentPage}
        </span>{" "}
        / {totalPages} 页
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {safeCurrentPage === 1 ? (
          <span className="h-9 rounded-full border border-[#E7DDD0] bg-[#F7F3EA] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
            上一页
          </span>
        ) : (
          <Link
            href={buildBrandsHref({
              query: searchQuery,
              letter: activeLetter,
              page: safeCurrentPage - 1,
            })}
            className="h-9 rounded-full border border-[#D8CFC2] bg-white px-3 py-2 text-[12px] font-semibold text-[#1F1A16] transition hover:border-[#063B32] hover:text-[#063B32]"
          >
            上一页
          </Link>
        )}

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
                  ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                  : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
              ].join(" ")}
            >
              {item}
            </Link>
          );
        })}

        {safeCurrentPage === totalPages ? (
          <span className="h-9 rounded-full border border-[#E7DDD0] bg-[#F7F3EA] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
            下一页
          </span>
        ) : (
          <Link
            href={buildBrandsHref({
              query: searchQuery,
              letter: activeLetter,
              page: safeCurrentPage + 1,
            })}
            className="h-9 rounded-full border border-[#D8CFC2] bg-white px-3 py-2 text-[12px] font-semibold text-[#1F1A16] transition hover:border-[#063B32] hover:text-[#063B32]"
          >
            下一页
          </Link>
        )}
      </div>
    </nav>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-8 text-center shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <p className="text-[20px] font-semibold text-[#1F1A16]">
        未找到相关品牌
      </p>

      <p className="mt-2 text-[13px] leading-6 text-[#746A5F]">
        可以尝试减少关键词，或切换回 All 查看完整品牌库。
      </p>

      <Link
        href="/brands"
        className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[#063B32] px-5 text-[13px] font-semibold text-[#E7C48A]"
      >
        查看全部品牌
      </Link>
    </div>
  );
}

function BrandPageInfoFooter() {
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
        品牌资料与库存数量会随采集和整理持续更新，具体商品状态以人工确认为准。
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

function InventoryIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.5 8.5h13l-1.2 10.2c-.1.8-.8 1.3-1.6 1.3H8.3c-.8 0-1.5-.6-1.6-1.3L5.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.7 8.5c.4-2.7 1.5-4 3.3-4s2.9 1.3 3.3 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PipeLineIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path
        d="M34 73c-10 0-18-8-18-18V37c0-7 5-12 12-12h25c7 0 12 5 12 12v18c0 10-8 18-18 18H34Z"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M63 53c18 0 32-7 42-20"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M79 45c9 4 17 12 25 23"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M23 82c12 8 27 9 43 3"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}