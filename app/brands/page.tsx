import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import { isNameOnlyBrand } from "@/data/brands";
import { getPublicBrandProfiles, type PublicBrandProfile } from "@/lib/public-products/brands";
import { parseBrandSummary } from "../utils/display";
import BrandAlphabetIndex from "./BrandAlphabetIndex";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    letter?: string;
    page?: string;
  }>;
};

type PaginationItem = number | "ellipsis";

const PAGE_SIZE = 12;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const CURATED_LOGO_ASSETS: Record<string, string> = {
  peterson: "/brands/featured/peterson-logo-1600x800.png",
  savinelli: "/brands/featured/savinelli-logo-1600x800.png",
  stanwell: "/brands/featured/stanwell-logo-1600x800.png",
  dunhill: "/brands/featured/dunhill-logo-1600x800.png",
  chacom: "/brands/featured/chacom-logo-1600x800.png",
};

function priorityRank(priority?: string) {
  const normalizedPriority = String(priority || "").toLowerCase();
  if (normalizedPriority === "high") return 0;
  if (normalizedPriority === "medium") return 1;
  if (normalizedPriority === "low") return 2;
  return 3;
}

function sortBrands(brands: PublicBrandProfile[]) {
  return [...brands].sort((left, right) => {
    const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
    if (priorityDiff !== 0) return priorityDiff;
    if (right.productCount !== left.productCount) return right.productCount - left.productCount;
    return left.name.localeCompare(right.name, "en");
  });
}

function brandInitial(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const match = normalized.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "#";
}

function brandShortName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return words[0] ? words[0].slice(0, 2).toUpperCase() : brandInitial(name);
}

function brandLogoUrl(brand: PublicBrandProfile) {
  const record = brand as Record<string, unknown>;
  const candidates = [
    record.logoUrl,
    record.logo,
    record.imageUrl,
    record.logoImage,
    CURATED_LOGO_ASSETS[brand.slug],
  ];
  const logo = candidates.find((item) => typeof item === "string" && item.trim());
  return typeof logo === "string" ? logo : "";
}

function formatBrandDisplayName(value: string) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  const overrides: Record<string, string> = {
    akb: "AKB",
    bbb: "BBB",
    "gh zhang": "GH Zhang",
    "ser jacopo": "Ser Jacopo",
    "s bang": "S. Bang",
    "s. bang": "S. Bang",
    "old german clay": "Old German Clay",
    "white elephant": "White Elephant",
    "mastro geppetto": "Mastro Geppetto",
    "butz choquin": "Butz-Choquin",
    "butz-choquin": "Butz-Choquin",
    "charatan's": "Charatan's",
    "comoy's": "Comoy's",
    nording: "Nørding",
    "nørding": "Nørding",
    "w.ø. larsen": "W.Ø. Larsen",
  };
  const key = raw
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (overrides[key]) return overrides[key];

  return raw
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && ["by", "for", "and", "of", "the"].includes(lower)) return lower;
      return lower.replace(/(^|-)([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
    })
    .join(" ");
}

function brandChineseName(brand: PublicBrandProfile) {
  const record = brand as Record<string, unknown>;
  const candidates = [record.nameZh, record.brandZh, record.chineseName, record.nameChinese];
  const value = candidates.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value.trim() : "";
}

function brandCountry(brand: PublicBrandProfile) {
  return brand.country || brand.publicCountry || "产地待补充";
}

function brandSummaryParts(brand: PublicBrandProfile) {
  return isNameOnlyBrand(brand) ? { zh: "", en: "" } : parseBrandSummary(brand.summary);
}

function searchText(brand: PublicBrandProfile) {
  const summary = brandSummaryParts(brand);
  return [
    brand.name,
    brandChineseName(brand),
    brandCountry(brand),
    brand.publicCountry,
    summary.zh,
    summary.en,
    ...brand.aliases,
  ]
    .join(" ")
    .toLowerCase();
}

function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function buildBrandsHref({ query, letter, page }: { query?: string; letter?: string; page?: number }) {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("q", query.trim());
  if (letter) params.set("letter", letter);
  if (page && page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/brands?${queryString}` : "/brands";
}

export default async function BrandsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const query = String(resolvedSearchParams.q || "").trim();
  const requestedLetter = String(resolvedSearchParams.letter || "").trim().toUpperCase();
  const activeLetter = ALPHABET.includes(requestedLetter) ? requestedLetter : "";
  const requestedPage = Number.parseInt(String(resolvedSearchParams.page || "1"), 10);
  const brands = getPublicBrandProfiles();
  const keyword = query.toLowerCase();
  const filteredBrands = sortBrands(
    brands.filter((brand) => {
      const matchesSearch = !keyword || searchText(brand).includes(keyword);
      const matchesLetter = !activeLetter || brandInitial(brand.name) === activeLetter;
      return matchesSearch && matchesLetter;
    })
  );
  const totalPages = Math.max(1, Math.ceil(filteredBrands.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageBrands = filteredBrands.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />

      <section className="relative isolate h-[220px] overflow-hidden md:h-[320px]">
        <img
          src="/pics/overseas-head.png"
          alt="暖棕色烟斗与海外港口氛围"
          className="absolute inset-0 h-full w-full object-cover object-[65%_center] md:object-[60%_center]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(29,15,8,0.78)] via-[rgba(29,15,8,0.42)] to-transparent" />
        <div className="relative mx-auto flex h-full max-w-[1200px] flex-col justify-end px-4 pb-7 sm:px-6 md:pb-10 lg:px-10">
          <p className="text-[10px] font-normal tracking-[0.22em] text-[#e3bb7d]">PIPE BRANDS</p>
          <h1 className="mt-2 text-[23px] font-medium leading-[1.35] text-[#f5eee6] md:text-[32px]">烟斗品牌档案</h1>
          <p className="mt-2 max-w-[280px] text-[12px] font-normal leading-[1.65] text-[rgba(244,238,231,0.82)] md:max-w-[360px]">
            收录海外烟斗品牌、产地与公开库存索引。
          </p>
          <p className="mt-4 text-[12px] font-medium text-[#e3bb7d]">共 {brands.length} 个品牌</p>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-10 pt-5 sm:px-6 md:pt-7 lg:px-10 lg:pb-14">
        <form action="/brands" className="flex h-11 items-center gap-3 rounded-[5px] border border-[#e3d9ce] bg-white px-3.5">
          {activeLetter ? <input type="hidden" name="letter" value={activeLetter} /> : null}
          <SearchIcon className="h-[19px] w-[19px] shrink-0 text-[var(--coffee)]" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="搜索品牌（中文 / 英文）"
            className="min-w-0 flex-1 bg-transparent text-[13px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[#978a7f]"
          />
          <button type="submit" className="shrink-0 text-[12px] font-normal text-[var(--coffee)] transition-colors hover:text-[var(--brass)]">
            搜索
          </button>
        </form>

        <div className="mt-4 border-b border-[rgba(132,111,91,0.16)]">
          <BrandAlphabetIndex activeLetter={activeLetter} query={query} letters={ALPHABET} />
        </div>

        <div className="mt-6 flex items-center justify-between text-[12px] font-normal text-[var(--text-secondary)]">
          <p>共 <span className="font-medium text-[var(--brass)]">{filteredBrands.length}</span> 个品牌</p>
          <p className="hidden sm:block">每页 {PAGE_SIZE} 个</p>
        </div>

        {pageBrands.length > 0 ? (
          <>
            <div className="mt-3 md:grid md:grid-cols-2 md:gap-x-10">
              {pageBrands.map((brand) => <BrandDirectoryItem key={brand.slug} brand={brand} />)}
            </div>
            {totalPages > 1 ? (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                paginationItems={getPaginationItems(currentPage, totalPages)}
                searchQuery={query}
                activeLetter={activeLetter}
              />
            ) : null}
          </>
        ) : (
          <EmptyState />
        )}
      </section>

      <SiteFooter />
    </main>
  );
}

function BrandDirectoryItem({ brand }: { brand: PublicBrandProfile }) {
  const logoUrl = brandLogoUrl(brand);
  const chineseName = brandChineseName(brand);
  const displayName = formatBrandDisplayName(brand.name);
  const summary = brandSummaryParts(brand);

  return (
    <article className="min-w-0 border-b border-[rgba(132,111,91,0.16)]">
      <Link
        href={`/brands/${brand.slug}`}
        aria-label={`查看 ${displayName} 品牌档案`}
        className="grid min-h-[142px] grid-cols-[80px_minmax(0,1fr)_52px] items-center gap-x-3 py-4 transition-colors hover:text-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brass)] md:min-h-[154px] md:grid-cols-[86px_minmax(0,1fr)_58px] md:py-5"
      >
        <div className="flex h-[80px] w-[80px] items-center justify-center overflow-hidden rounded-[5px] border border-[rgba(132,111,91,0.16)] bg-white md:h-[86px] md:w-[86px]">
          {logoUrl ? (
            <img src={logoUrl} alt={`${displayName} Logo`} className="h-full w-full object-contain p-2.5" loading="lazy" />
          ) : (
            <span className="px-2 text-center text-[16px] font-medium tracking-[0.08em] text-[var(--coffee)] md:text-[17px]">
              {brandShortName(displayName)}
            </span>
          )}
        </div>

        <div className="min-w-0 self-center">
          <h2 className="truncate text-[16px] font-medium leading-[1.35] text-[var(--text-primary)]">{displayName}</h2>
          {chineseName ? <p className="mt-1 text-[12px] font-medium leading-[1.35] text-[var(--brass)]">{chineseName}</p> : null}
          {summary.zh ? <p className="mt-2 line-clamp-2 text-[11.5px] font-normal leading-[1.65] text-[var(--text-secondary)]">{summary.zh}</p> : null}
        </div>

        <div className="flex h-full flex-col items-end justify-center text-right">
          <p className="text-[10.5px] font-normal leading-[1.4] text-[var(--text-secondary)]">{brandCountry(brand)}</p>
          <p className="mt-2 text-[12px] font-medium leading-[1.4] text-[var(--coffee-dark)]">{brand.productCount} 件</p>
          <ArrowRightIcon className="mt-3 h-4 w-4 text-[var(--coffee)]" />
        </div>
      </Link>
    </article>
  );
}

function Pagination({ currentPage, totalPages, paginationItems, searchQuery, activeLetter }: {
  currentPage: number;
  totalPages: number;
  paginationItems: PaginationItem[];
  searchQuery: string;
  activeLetter: string;
}) {
  const previousHref = buildBrandsHref({ query: searchQuery, letter: activeLetter, page: currentPage - 1 });
  const nextHref = buildBrandsHref({ query: searchQuery, letter: activeLetter, page: currentPage + 1 });

  return (
    <nav className="mt-7 border-y border-[rgba(132,111,91,0.16)] py-3" aria-label="品牌分页">
      <div className="grid grid-cols-3 items-center text-[13px] font-normal">
        {currentPage === 1 ? <span className="text-[#aa9c90]">← 上一页</span> : <Link href={previousHref} className="text-[var(--coffee)] hover:text-[var(--brass)]">← 上一页</Link>}
        <span className="text-center text-[var(--text-primary)]">第 {currentPage} / {totalPages} 页</span>
        {currentPage === totalPages ? <span className="text-right text-[#aa9c90]">下一页 →</span> : <Link href={nextHref} className="text-right text-[var(--coffee)] hover:text-[var(--brass)]">下一页 →</Link>}
      </div>
      <div className="mt-4 hidden justify-center gap-5 border-t border-[rgba(132,111,91,0.12)] pt-3 md:flex">
        {paginationItems.map((item, index) => item === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="text-[12px] text-[var(--text-secondary)]">…</span>
        ) : (
          <Link
            key={item}
            href={buildBrandsHref({ query: searchQuery, letter: activeLetter, page: item })}
            aria-current={item === currentPage ? "page" : undefined}
            className={`relative text-[12px] transition-colors ${item === currentPage ? "font-medium text-[var(--coffee-dark)] after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:bg-[var(--brass)]" : "text-[var(--text-secondary)] hover:text-[var(--coffee)]"}`}
          >
            {item}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function EmptyState() {
  return (
    <section className="mt-7 border-y border-[rgba(132,111,91,0.16)] py-10 text-center">
      <h2 className="text-[17px] font-medium text-[var(--text-primary)]">未找到相关品牌</h2>
      <p className="mt-2 text-[12px] leading-[1.7] text-[var(--text-secondary)]">可减少关键词，或清除筛选后查看完整品牌目录。</p>
      <Link href="/brands" className="mt-4 inline-block text-[12px] text-[var(--coffee)] underline decoration-[var(--brass)] underline-offset-4 hover:text-[var(--brass)]">查看全部品牌</Link>
    </section>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" /><path d="m16.2 16.2 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function ArrowRightIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
