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
        <p className="text-center text-[15px] font-medium tracking-[0.04em]">品牌详情</p>
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

  return (
    <section className="relative isolate h-[390px] overflow-hidden border-b border-[rgba(205,165,105,0.2)] bg-[#382317] sm:h-[430px] md:h-[540px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_76%_42%,rgba(124,78,40,0.52),transparent_34%),linear-gradient(116deg,#24140c_0%,#382317_48%,#2b180e_100%)]" />
      {heroImage ? (
        <img
          src={heroImage}
          alt={`${displayName} 真实在售商品图`}
          className="absolute inset-y-0 right-0 h-full w-[68%] object-contain object-right mix-blend-multiply opacity-80 [mask-image:radial-gradient(ellipse_at_64%_50%,black_24%,transparent_75%)] md:w-[62%]"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-[#24140c] via-[rgba(36,20,12,0.78)] to-transparent" />

      <div className="relative mx-auto flex h-full max-w-[1240px] flex-col justify-end px-4 pb-8 sm:px-6 md:pb-12 lg:px-10">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${displayName} logo`}
            className="mb-4 h-12 max-w-[190px] object-contain object-left brightness-0 invert md:h-16 md:max-w-[270px]"
          />
        ) : (
          <p className="mb-4 max-w-[260px] text-[26px] font-medium leading-[1.1] tracking-[0.02em] text-[#f4eee7] md:text-[38px]">
            {displayName}
          </p>
        )}
        <h1 className="max-w-[300px] text-[25px] font-medium leading-[1.3] text-[#f4eee7] md:max-w-[440px] md:text-[38px]">
          {displayName}{chineseName ? ` ${chineseName}` : ""}
        </h1>
        {meta ? <p className="mt-2 text-[12px] font-normal tracking-[0.08em] text-[#e4c18d] md:text-[13px]">{meta}</p> : null}
        {summary ? <p className="mt-4 max-w-[310px] line-clamp-3 text-[12px] font-normal leading-[1.7] text-[rgba(244,238,231,0.8)] md:max-w-[440px] md:text-[13px]">{summary}</p> : null}
      </div>
    </section>
  );
}

function BrandDataBand({ facts }: { facts: BrandFact[] }) {
  if (facts.length === 0) return null;

  return (
    <section className="border-y border-[rgba(205,165,105,0.18)] bg-[#3a2518]">
      <div
        className="mx-auto grid max-w-[1240px] divide-x divide-[rgba(205,165,105,0.18)] px-4 sm:px-6 lg:px-10"
        style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}
      >
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 px-3 py-5 text-center first:pl-0 last:pr-0 sm:py-6">
            <p className="text-[10px] font-normal tracking-[0.08em] text-[rgba(244,238,231,0.56)]">{fact.label}</p>
            <p className="mt-2 text-[14px] font-medium leading-[1.35] text-[#f4eee7] sm:text-[16px]">{fact.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrandIntroduction({ text }: { text: string }) {
  if (!text) return null;

  return (
    <section className="border-y border-[rgba(205,165,105,0.16)] bg-[#322015] px-4 py-7 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-[1180px]">
        <h2 className="text-[18px] font-medium leading-[1.35] text-[#f4eee7]">品牌简介</h2>
        <p className="mt-3 max-w-[780px] text-[12px] font-normal leading-[1.8] text-[rgba(244,238,231,0.72)] sm:text-[13px]">{text}</p>
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
    <section id="brand-stock" className="mx-auto max-w-[1240px] px-4 py-10 scroll-mt-4 sm:px-6 lg:px-10 lg:py-14">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-medium leading-[1.35] text-[#f4eee7] sm:text-[22px]">在库作品 <span className="ml-1.5 text-[14px] font-normal text-[#d7a758]">{filteredProducts.length} 件</span></h2>
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

function BrandRequestCta({ brand }: { brand: PublicBrandProfile }) {
  const displayName = brandDisplayName(brand);
  return (
    <section className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-6 lg:px-10 lg:pb-14">
      <div className="flex min-h-[144px] flex-col justify-center border border-[rgba(205,165,105,0.3)] bg-[linear-gradient(112deg,#412919,#2b180e)] px-5 py-6 sm:min-h-[150px] sm:px-8">
        <h2 className="text-[18px] font-medium leading-[1.35] text-[#f4eee7]">没有找到合适的 {displayName}？</h2>
        <p className="mt-2 max-w-[420px] text-[12px] font-normal leading-[1.7] text-[rgba(244,238,231,0.7)]">提交斗型、系列与预算，由人工协助寻找接近的作品。</p>
        <Link href="/request" className="mt-4 w-fit text-[12px] font-normal text-[#e4c18d] underline decoration-[rgba(228,193,141,0.58)] underline-offset-4 transition-colors hover:text-[#f4eee7]">提交找斗需求 →</Link>
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
  const summary = brandSummary(brand);
  const introduction = brandIntroduction(brand, summary);

  return (
    <div className="min-h-screen bg-[#2a180e] text-[#f4eee7] [&_a]:font-inherit [&_button]:font-inherit [&_input]:font-inherit [&_select]:font-inherit" style={{ fontFamily: '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif', fontVariantNumeric: "lining-nums" }}>
      <BrandDetailTopBar />
      <main>
        <BrandHero brand={brand} heroImage={brandHeroImage(brand, heroProducts)} summary={summary} />
        <BrandDataBand facts={brandFacts(brand)} />
        <BrandIntroduction text={introduction} />
        <RelatedStock brand={brand} page={Number.isFinite(requestedPage) ? requestedPage : 1} requestedSeries={requestedSeries} />
        <BrandRequestCta brand={brand} />
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
