import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import { parseBrandSummary } from "../../utils/display";
import {
  getCanonicalBrandSlugForInput,
  isNameOnlyBrand,
} from "@/data/brands";
import BrandSeriesFilterDrawer from "@/components/brands/BrandSeriesFilterDrawer";
import ProductGrid from "@/components/products/ProductGrid";
import ProductPagination from "@/components/products/ProductPagination";
import {
  getPublicBrandProfileBySlug,
  type PublicBrandProfile,
} from "@/lib/public-products/brands";
import {
  getPublicBrandSeriesOptions,
  getPublicProductsByIds,
} from "@/lib/public-products/server";
import type { PublicCatalogProduct } from "@/lib/public-products/types";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string; series?: string }>;
};

type BrandFact = {
  label: string;
  value: string;
};

const RELATED_STOCK_PAGE_SIZE = 12;

const CURATED_LOGO_ASSETS: Record<string, string> = {
  peterson: "/brands/featured/peterson-logo-1600x800.png",
  savinelli: "/brands/featured/savinelli-logo-1600x800.png",
  stanwell: "/brands/featured/stanwell-logo-1600x800.png",
  dunhill: "/brands/featured/dunhill-logo-1600x800.png",
  chacom: "/brands/featured/chacom-logo-1600x800.png",
};

const EDITORIAL_HERO_ASSETS: Record<string, string> = {
  peterson: "/pics/peterson-brand-head.png",
};

function buildBrandDetailHref({
  slug,
  page,
  series,
  anchor,
}: {
  slug: string;
  page?: number;
  series?: string;
  anchor?: string;
}) {
  const params = new URLSearchParams();
  if (series?.trim()) params.set("series", series.trim());
  if (page && page > 1) params.set("page", String(page));

  const query = params.toString();
  const href = query ? `/brands/${slug}?${query}` : `/brands/${slug}`;
  return anchor ? `${href}#${anchor}` : href;
}

function isPlaceholder(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return true;

  return [
    "待补充",
    "后续补充",
    "模板资料",
    "资料来源待补充",
    "品牌资料后续补充",
    "以实际库存和人工确认为准",
  ].some((pattern) => text.includes(pattern));
}

function meaningfulText(value?: string | null) {
  const text = String(value || "").trim();
  return isPlaceholder(text) ? "" : text;
}

function chineseText(value?: string | null) {
  return meaningfulText(value)
    .split(/[｜|]\s*(?:EN|English)[:：]/i)[0]
    .trim();
}

function brandDisplayName(brand: PublicBrandProfile) {
  return String(brand.name || "").trim() || "品牌";
}

function brandChineseName(brand: PublicBrandProfile) {
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
  return typeof value === "string" ? value.trim() : "";
}

function brandCountry(brand: PublicBrandProfile) {
  return meaningfulText(brand.country) || meaningfulText(brand.publicCountry);
}

function brandLogoUrl(brand: PublicBrandProfile) {
  const record = brand as Record<string, unknown>;
  const candidates = [
    record.logoUrl,
    record.logo,
    record.logoImage,
    CURATED_LOGO_ASSETS[brand.slug],
  ];
  const value = candidates.find(
    (item) => typeof item === "string" && item.trim()
  );
  return typeof value === "string" ? value : "";
}

function brandSummary(brand: PublicBrandProfile) {
  if (isNameOnlyBrand(brand)) return "";
  return parseBrandSummary(meaningfulText(brand.summary)).zh;
}

function brandIntroduction(brand: PublicBrandProfile, summary: string) {
  const detailed = chineseText(brand.detailIntro) || chineseText(brand.story);
  if (detailed && detailed !== summary) return detailed;
  return "";
}

function brandFacts(brand: PublicBrandProfile): BrandFact[] {
  return [
    { label: "国家 / 地区", value: brandCountry(brand) },
    { label: "创立年份", value: meaningfulText(brand.founded) },
    { label: "公开库存", value: `${brand.productCount} 件` },
  ].filter((fact) => fact.value);
}

function brandHeroImage(
  brand: PublicBrandProfile,
  products: PublicCatalogProduct[]
) {
  const editorialAsset = EDITORIAL_HERO_ASSETS[brand.slug];
  if (editorialAsset) return editorialAsset;

  const record = brand as Record<string, unknown>;
  const coverCandidates = [
    record.coverImage,
    record.coverUrl,
    record.heroImage,
    record.heroUrl,
  ];
  const cover = coverCandidates.find(
    (item) => typeof item === "string" && item.trim()
  );
  if (typeof cover === "string") return cover;

  return (
    products.find(
      (product) => product.inventoryStatus === "available" && product.mainImage
    )?.mainImage || products.find((product) => product.mainImage)?.mainImage || ""
  );
}

function BrandDetailTopBar() {
  return (
    <header className="border-b border-[rgba(205,165,105,0.16)] bg-[#2a180e] text-[#f4eee7]">
      <div className="mx-auto grid h-14 max-w-[1240px] grid-cols-[44px_minmax(0,1fr)_44px] items-center px-3 sm:px-6 lg:px-10">
        <Link
          href="/brands"
          aria-label="返回品牌目录"
          className="flex h-11 w-11 items-center justify-center text-[#e4c18d] transition-colors hover:text-[#f4eee7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#d7a758]"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <p className="text-center text-[17px] font-medium tracking-[0.02em]">品牌详情</p>
        <span aria-hidden="true" />
      </div>
    </header>
  );
}

function BrandHero({
  brand,
  heroImage,
  summary,
}: {
  brand: PublicBrandProfile;
  heroImage: string;
  summary: string;
}) {
  const displayName = brandDisplayName(brand);
  const chineseName = brandChineseName(brand);
  const country = brandCountry(brand);
  const founded = meaningfulText(brand.founded);
  const logoUrl = brandLogoUrl(brand);
  const meta = [country, founded].filter(Boolean).join(" · ");
  const editorialHero = Boolean(EDITORIAL_HERO_ASSETS[brand.slug]);

  return (
    <section className="relative isolate h-[418px] overflow-hidden bg-[#382317] sm:h-[430px] md:h-[500px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_76%_42%,rgba(124,78,40,0.42),transparent_38%),linear-gradient(116deg,#24140c_0%,#382317_52%,#2b180e_100%)]" />
      {heroImage ? (
        <img
          src={heroImage}
          alt={`${displayName} 真实在售商品图`}
          className={editorialHero
            ? "absolute inset-y-0 right-0 h-full w-full object-cover object-[68%_58%] md:!w-[142%] md:object-[67%_60%]"
            : "absolute inset-y-0 right-0 h-full w-full object-cover object-[68%_58%] mix-blend-multiply"}
        />
      ) : null}
      <div className="absolute inset-0 bg-[rgba(29,12,5,0.46)]" />
      <div className="absolute inset-y-0 left-0 w-[66%] bg-gradient-to-r from-[rgba(29,12,5,0.78)] via-[rgba(29,12,5,0.62)] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-[rgba(29,12,5,0.68)] to-transparent" />

      <div className="relative mx-auto flex h-full max-w-[1240px] flex-col justify-center px-4 pb-3 -translate-y-5 sm:px-6 sm:-translate-y-6 md:-translate-y-7 md:px-10 lg:px-10">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${displayName} logo`}
            className="mb-3 h-11 max-w-[176px] object-contain object-left brightness-0 invert md:h-14 md:max-w-[240px]"
          />
        ) : (
          <p className="mb-3 max-w-[260px] text-[25px] font-medium leading-[1.1] tracking-[0.02em] text-[#f4eee7] md:text-[36px]">
            {displayName}
          </p>
        )}
        <h1 className="max-w-[300px] text-[24px] font-medium leading-[1.3] text-[#f4eee7] md:max-w-[440px] md:text-[36px]">
          {displayName}{chineseName ? ` ${chineseName}` : ""}
        </h1>
        {meta ? <p className="mt-2 text-[11px] font-normal tracking-[0.08em] text-[#e4c18d] md:text-[12px]">{meta}</p> : null}
        {summary ? <p className="mt-3 max-w-[310px] line-clamp-3 text-[13px] font-normal leading-[1.55] text-[rgba(244,238,231,0.82)] md:max-w-[440px]">{summary}</p> : null}
      </div>
    </section>
  );
}

function BrandDataBand({ facts }: { facts: BrandFact[] }) {
  if (facts.length === 0) return null;

  return (
    <section className="h-[88px] border-y border-[rgba(213,166,81,0.14)] bg-[#3a2518]">
      <div
        className="mx-auto grid h-full max-w-[1240px] divide-x divide-[rgba(213,166,81,0.1)] px-4 sm:px-6 lg:px-10"
        style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}
      >
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col justify-center px-3 py-4 text-center first:pl-0 last:pr-0">
            <p className="text-[10.5px] font-normal tracking-[0.05em] text-[rgba(244,238,231,0.54)]">{fact.label}</p>
            <p className="mt-1.5 text-[14px] font-medium leading-[1.35] text-[#f4eee7]">{fact.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrandIntroduction({ text }: { text: string }) {
  if (!text) return null;

  return (
    <section className="border-y border-[rgba(213,166,81,0.1)] bg-[#322015] px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1180px]">
        <h2 className="text-[17px] font-medium leading-[1.35] text-[#f4eee7]">品牌简介</h2>
        <p className="mt-3.5 max-w-[780px] text-[13px] font-normal leading-[1.65] text-[rgba(244,238,231,0.72)]">{text}</p>
      </div>
    </section>
  );
}

function RelatedStock({
  brand,
  page,
  requestedSeries,
}: {
  brand: PublicBrandProfile;
  page: number;
  requestedSeries: string;
}) {
  const products = getPublicProductsByIds(brand.productIds);
  const seriesOptions = brand.productCount > 100 ? getPublicBrandSeriesOptions(brand.slug) : [];
  const activeSeries = seriesOptions.find((option) => option.series === requestedSeries) || null;
  const activeProductIds = activeSeries ? new Set(activeSeries.productIds) : null;
  const filteredProducts = activeProductIds ? products.filter((product) => activeProductIds.has(product.id)) : products;
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / RELATED_STOCK_PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const pageProducts = filteredProducts.slice((currentPage - 1) * RELATED_STOCK_PAGE_SIZE, currentPage * RELATED_STOCK_PAGE_SIZE);
  const returnTo = buildBrandDetailHref({ slug: brand.slug, page: currentPage, series: activeSeries?.series });
  const showSeriesFilter = brand.productCount > 100 && seriesOptions.length > 0;

  return (
    <section id="brand-stock" className="mx-auto max-w-[1240px] px-4 py-7 scroll-mt-4 sm:px-6 lg:px-10 lg:py-9">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-baseline text-[19px] font-medium leading-[1.35] text-[#f4eee7] sm:text-[21px]">在库作品 <span className="ml-1.5 text-[13px] font-normal text-[#d7a758]">{filteredProducts.length} 件</span></h2>
        </div>
        {showSeriesFilter ? (
          <BrandSeriesFilterDrawer
            brandSlug={brand.slug}
            options={seriesOptions.map((option) => ({ series: option.series, seriesZh: option.seriesZh, count: option.count }))}
            selectedSeries={activeSeries?.series || ""}
            variant="dossier"
          />
        ) : null}
      </div>

      {pageProducts.length > 0 ? (
        <>
          <ProductGrid products={pageProducts} returnTo={returnTo} variant="dossier" />
          <ProductPagination
            currentPage={currentPage}
            totalPages={totalPages}
            hrefForPage={(nextPage) => buildBrandDetailHref({ slug: brand.slug, page: nextPage, series: activeSeries?.series, anchor: "brand-stock" })}
            label="品牌在库作品分页"
            variant="dossier"
          />
        </>
      ) : (
        <div className="border-y border-[rgba(205,165,105,0.18)] py-10 text-center text-[13px] leading-7 text-[rgba(244,238,231,0.64)]">
          当前暂无公开库存，欢迎提交找斗需求，由人工协助继续寻找。
        </div>
      )}
    </section>
  );
}

function BrandRequestCta({
  brand,
  heroImage,
}: {
  brand: PublicBrandProfile;
  heroImage: string;
}) {
  const displayName = brandDisplayName(brand);
  return (
    <section className="mx-auto max-w-[1240px] px-4 pb-8 sm:px-6 lg:px-10 lg:pb-10">
      <div className="relative isolate flex h-[140px] overflow-hidden rounded-[5px] border border-[rgba(213,166,81,0.16)] bg-[linear-gradient(90deg,#412817_0%,#342014_62%,#2a180e_100%)] px-5 py-5 sm:h-[144px] sm:px-8">
        {heroImage ? <img src={heroImage} alt="" aria-hidden="true" className="absolute inset-y-0 right-0 z-0 h-full w-[44%] object-cover object-[70%_60%] opacity-45 [mask-image:linear-gradient(to_right,transparent,black_35%)]" /> : null}
        <div className="absolute inset-y-0 right-0 z-[1] w-[58%] bg-[linear-gradient(90deg,#342014_0%,transparent_78%)]" />
        <div className="relative z-10 flex w-[65%] min-w-0 flex-col justify-center">
          <h2 className="text-[17px] font-medium leading-[1.35] text-[#f4eee7]">没有找到合适的 {displayName}？</h2>
          <p className="mt-2 line-clamp-2 text-[12px] font-normal leading-[1.55] text-[rgba(244,238,231,0.72)]">提交斗型、系列与预算，<br />由人工协助寻找接近的作品。</p>
          <Link href="/request" className="mt-3 w-fit text-[13px] font-medium text-[#e4c18d] underline decoration-[rgba(228,193,141,0.72)] decoration-[1px] underline-offset-4 transition-colors hover:text-[#f4eee7]">提交找斗需求 →</Link>
        </div>
      </div>
    </section>
  );
}

export default async function BrandDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedPage = Number.parseInt(String(resolvedSearchParams.page || "1"), 10);
  const requestedSeries = String(resolvedSearchParams.series || "").trim();
  const brand = getPublicBrandProfileBySlug(slug);

  if (!brand) {
    const canonicalSlug = getCanonicalBrandSlugForInput(slug);
    const canonicalBrand = canonicalSlug ? getPublicBrandProfileBySlug(canonicalSlug) : null;
    if (canonicalBrand && canonicalBrand.slug !== slug) redirect(`/brands/${canonicalBrand.slug}`);
    notFound();
  }

  const heroProducts = getPublicProductsByIds(brand.productIds.slice(0, 24));
  const heroImage = brandHeroImage(brand, heroProducts);
  const summary = brandSummary(brand);
  const introduction = brandIntroduction(brand, summary);

  return (
    <div className="min-h-screen bg-[#2a180e] text-[#f4eee7] [&_a]:font-inherit [&_button]:font-inherit [&_input]:font-inherit [&_select]:font-inherit" style={{ fontFamily: '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif', fontVariantNumeric: "lining-nums" }}>
      <BrandDetailTopBar />
      <main>
        <BrandHero brand={brand} heroImage={heroImage} summary={summary} />
        <BrandDataBand facts={brandFacts(brand)} />
        <BrandIntroduction text={introduction} />
        <RelatedStock brand={brand} page={Number.isFinite(requestedPage) ? requestedPage : 1} requestedSeries={requestedSeries} />
        <BrandRequestCta brand={brand} heroImage={heroImage} />
      </main>
      <SiteFooter variant="dark" />
    </div>
  );
}

function ArrowLeftIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
