import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
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

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<{
    page?: string;
    series?: string;
  }>;
};

type IconProps = {
  className?: string;
};

const RELATED_STOCK_PAGE_SIZE = 12;

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

function placeholderText(value?: string) {
  const text = String(value || "").trim();

  if (!text) return true;

  return [
    "待补充",
    "后续补充",
    "模板资料",
    "资料来源待补充",
    "品牌资料后续补充",
    "当前收录来自公开库存页",
    "适合希望按品牌查看当前公开库存",
    "以当前库存页和人工确认为准",
  ].some((pattern) => text.includes(pattern));
}

function meaningfulText(value?: string) {
  const text = String(value || "").trim();
  return placeholderText(text) ? "" : text;
}

function chineseText(value?: string) {
  return meaningfulText(value)
    .split(/[｜|]\s*(?:EN|English)[:：]/i)[0]
    .trim();
}

function meaningfulList(items?: string[]) {
  return (items || [])
    .map((item) => String(item || "").trim())
    .filter((item) => item && !placeholderText(item));
}

function brandLogoUrl(brand: PublicBrandProfile) {
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


function brandLogoText(brand: PublicBrandProfile) {
  const record = brand as Record<string, unknown>;
  const candidates = [record.logoText, record.wordmarkText, record.name, brand.name];
  const value = candidates.find(
    (item) => typeof item === "string" && item.trim()
  );

  return typeof value === "string" ? value.trim() : brand.name;
}

function formatBrandDisplayName(value: string) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  const overrides: Record<string, string> = {
    "akb": "AKB",
    "bbb": "BBB",
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
    "nording": "Nørding",
    "nørding": "Nørding",
  };
  const key = raw.toLowerCase().replace(/[()]/g, " ").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (overrides[key]) return overrides[key];

  return raw
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && ["by", "for", "and", "of", "the"].includes(lower)) return lower;
      return lower.replace(/(^|[-'’])([a-zøæå])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
    })
    .join(" ");
}

function brandDisplayName(brand: PublicBrandProfile) {
  return formatBrandDisplayName(brand.name);
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

  return typeof value === "string" ? value.replace(/南娜·伊瓦松/g, "娜娜·伊瓦松") : "";
}

function brandCountry(brand: PublicBrandProfile) {
  return meaningfulText(brand.country) || brand.publicCountry || "";
}

function brandShortName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  if (words[0]) return words[0].slice(0, 2).toUpperCase();

  return "BR";
}

function summaryParts(brand: PublicBrandProfile) {
  return parseBrandSummary(meaningfulText(brand.summary));
}

function BrandLogoBlock({ brand }: { brand: PublicBrandProfile }) {
  const logoUrl = brandLogoUrl(brand);
  const displayName = brandDisplayName(brand);
  const shortName = brandShortName(displayName);

  return (
    <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#E7DDD0] bg-white shadow-[0_8px_20px_rgba(31,26,22,0.04)]">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${displayName} logo`}
          className="h-full w-full object-contain p-3"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FFFDF8] to-[#F1E7D8]">
          <span
            className="text-[30px] font-semibold tracking-[0.04em] text-[#063B32]"
            style={{ fontFamily: '"Georgia", "Times New Roman", serif' }}
          >
            {shortName}
          </span>
        </div>
      )}
    </div>
  );
}

function BrandHero({ brand }: { brand: PublicBrandProfile }) {
  const displayName = brandDisplayName(brand);
  const chineseName = brandChineseName(brand);
  const country = brandCountry(brand);
  const summary = isNameOnlyBrand(brand) ? { zh: "", en: "" } : summaryParts(brand);

  return (
    <section className="rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
      <div className="flex gap-4">
        <BrandLogoBlock brand={brand} />

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.26em] text-[#A97838]">
              Brand Profile
            </p>
            {country ? (
              <span className="rounded-full bg-[#F7F3EA] px-2.5 py-1 text-[11px] font-semibold text-[#A97838]">
                {country}
              </span>
            ) : null}
          </div>

          <h1 className="text-[28px] font-bold leading-tight text-[#063B32] sm:text-[42px]">
            {displayName}
          </h1>

          {chineseName ? (
            <p className="mt-1 text-[15px] font-semibold text-[#8A5D26]">
              {chineseName}
            </p>
          ) : null}

          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F7F3EA] px-3 py-1 text-[#063B32]">
            <InventoryIcon className="h-4 w-4" />
            <span className="text-[13px] font-semibold">
              当前公开库存 {brand.productCount} 件
            </span>
          </div>
        </div>
      </div>

      {summary.zh || summary.en ? (
        <div className="mt-5 space-y-2">
          {summary.zh ? (
            <p className="text-[13px] leading-7 text-[#746A5F]">
              {summary.zh}
            </p>
          ) : null}
          {summary.en ? (
            <p className="text-[12px] leading-6 text-[#9A8F84]">
              {summary.en}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function BrandFacts({ brand }: { brand: PublicBrandProfile }) {
  const facts = [
    {
      label: "国家 / 地区",
      value: brandCountry(brand),
    },
    {
      label: "创建时间",
      value: meaningfulText(brand.founded),
    },
    {
      label: "价格区间",
      value: meaningfulText(brand.priceRange),
    },
  ].filter((item) => item.value);

  if (facts.length === 0) return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <h2 className="mb-4 text-[19px] font-bold text-[#1F1A16]">品牌资料</h2>
      <div className="divide-y divide-[#F0E6D8]">
        {facts.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 py-3 text-[13px]"
          >
            <span className="text-[#746A5F]">{item.label}</span>
            <span className="text-right font-semibold text-[#1F1A16]">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrandStory({ brand }: { brand: PublicBrandProfile }) {
  const story = chineseText(brand.story);

  if (!story) return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <h2 className="mb-3 text-[19px] font-bold text-[#1F1A16]">品牌简介</h2>
      <p className="text-[13px] leading-7 text-[#746A5F]">{story}</p>
    </section>
  );
}

function TextListSection({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <h2 className="mb-3 text-[19px] font-bold text-[#1F1A16]">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-medium leading-5 text-[#746A5F]"
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function SuitableForSection({ brand }: { brand: PublicBrandProfile }) {
  const suitableFor = chineseText(brand.suitableFor);

  if (!suitableFor) return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <h2 className="mb-3 text-[19px] font-bold text-[#1F1A16]">适合人群</h2>
      <p className="text-[13px] leading-7 text-[#746A5F]">{suitableFor}</p>
    </section>
  );
}


function BrandReviewNotice({ brand }: { brand: PublicBrandProfile }) {
  const record = brand as Record<string, unknown>;
  const status = String(record.reviewStatus || record.profileStatus || "");
  if (!status || status === "可入库" || status === "confirmed") return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 text-[13px] leading-7 text-[#746A5F] shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      品牌资料仍在整理中，部分信息以公开资料与商品数据为基础，后续将持续校正。
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
  const seriesOptions =
    brand.productCount > 100 ? getPublicBrandSeriesOptions(brand.slug) : [];
  const activeSeries =
    seriesOptions.find((option) => option.series === requestedSeries) || null;
  const activeProductIds = activeSeries
    ? new Set(activeSeries.productIds)
    : null;
  const filteredProducts = activeProductIds
    ? products.filter((product) => activeProductIds.has(product.id))
    : products;
  const showSeriesFilter =
    brand.productCount > 100 && seriesOptions.length > 0;
  const seriesFilterOptions = seriesOptions.map((option) => ({
    series: option.series,
    seriesZh: option.seriesZh,
    count: option.count,
  }));
  const totalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / RELATED_STOCK_PAGE_SIZE)
  );
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * RELATED_STOCK_PAGE_SIZE;
  const pageProducts = filteredProducts.slice(
    start,
    start + RELATED_STOCK_PAGE_SIZE
  );
  const returnTo = buildBrandDetailHref({
    slug: brand.slug,
    page: currentPage,
    series: activeSeries?.series,
  });

  return (
    <section id="brand-stock" className="mt-7 scroll-mt-4">
      {showSeriesFilter ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <BrandSeriesFilterDrawer
            brandSlug={brand.slug}
            options={seriesFilterOptions}
            selectedSeries={activeSeries?.series || ""}
          />
          {activeSeries ? (
            <p className="shrink-0 text-[12px] text-[#746A5F]">
              {activeSeries.count} 件
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.3em] text-[#A97838]">
            Related Stock
          </p>
          <h2 className="text-[23px] font-bold text-[#1F1A16]">
            当前相关库存
            <span className="ml-2 text-[15px] font-semibold text-[#A97838]">
              {filteredProducts.length} 件
            </span>
          </h2>
        </div>

        {totalPages > 1 ? (
          <p className="shrink-0 text-[12px] text-[#746A5F]">
            第 {currentPage} / {totalPages} 页
          </p>
        ) : null}
      </div>

      {pageProducts.length > 0 ? (
        <>
          <ProductGrid
            products={pageProducts}
            returnTo={returnTo}
            variant="compact"
          />
          <ProductPagination
            currentPage={currentPage}
            totalPages={totalPages}
            hrefForPage={(nextPage) =>
              buildBrandDetailHref({
                slug: brand.slug,
                page: nextPage,
                series: activeSeries?.series,
                anchor: "brand-stock",
              })
            }
            label="品牌相关库存分页"
          />
        </>
      ) : (
        <div className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-8 text-center text-[13px] leading-6 text-[#746A5F] shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
          当前暂无关联库存。
        </div>
      )}
    </section>
  );
}

export default async function BrandDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedPage = Number.parseInt(
    String(resolvedSearchParams.page || "1"),
    10
  );
  const requestedSeries = String(resolvedSearchParams.series || "").trim();
  const brand = getPublicBrandProfileBySlug(slug);

  if (!brand) {
    const canonicalSlug = getCanonicalBrandSlugForInput(slug);
    const canonicalBrand = canonicalSlug
      ? getPublicBrandProfileBySlug(canonicalSlug)
      : null;

    if (canonicalBrand && canonicalBrand.slug !== slug) {
      redirect(`/brands/${canonicalBrand.slug}`);
    }

    notFound();
  }

  const features = meaningfulList(brand.features);
  const styles = meaningfulList(brand.representativeStyles);
  const nameOnly = isNameOnlyBrand(brand);

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

      <section className="mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6 lg:px-10">
        <Link
          href="/brands"
          className="mb-4 inline-flex items-center gap-2 text-[14px] font-semibold text-[#063B32]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回品牌库
        </Link>

        <BrandHero brand={brand} />

        {!nameOnly ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <BrandFacts brand={brand} />
            <BrandStory brand={brand} />
            <TextListSection title="品牌特点" items={features} />
            <TextListSection title="代表风格" items={styles} />
            <SuitableForSection brand={brand} />
            <BrandReviewNotice brand={brand} />
          </div>
        ) : null}

        <RelatedStock
          brand={brand}
          page={Number.isFinite(requestedPage) ? requestedPage : 1}
          requestedSeries={requestedSeries}
        />

        <BrandPageInfoFooter />
      </section>
    </main>
  );
}

function TopNotice() {
  return (
    <div className="bg-[#063B32] px-4 py-2 text-center text-[12px] tracking-[0.12em] text-[#E7C48A] sm:text-[13px]">
      <span className="mx-2 text-[#B8863B]">·</span>
      精选海外烟斗库存 · 人工选品咨询
      <span className="mx-2 text-[#B8863B]">·</span>
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
        品牌资料与库存数量会随采集和整理持续更新；具体商品状态以人工确认为准。
      </p>
    </footer>
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

function ArrowLeftIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19 12H5M11 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
