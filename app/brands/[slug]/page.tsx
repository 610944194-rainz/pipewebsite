import Link from "next/link";
import { notFound } from "next/navigation";
import BackButton from "../../components/BackButton";
import SiteHeader from "../../components/SiteHeader";
import { getRmbReferencePrice, RMB_REFERENCE_LABEL } from "../../utils/price";
import {
  createFallbackBrand,
  getBrandByName,
  getBrandMetaBySlug,
  getProductBrandGroups,
  type PipeBrand,
} from "../../../data/brands";
import { pipeProducts } from "../../../data/pipes";
import type { PipeProduct } from "../../../data/pipes";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<{
    page?: string;
  }>;
};

type BrandProfile = PipeBrand & {
  productCount: number;
  products: PipeProduct[];
};

type IconProps = {
  className?: string;
};

type PaginationItem = number | "ellipsis";

const RELATED_STOCK_PAGE_SIZE = 12;

function getBrandProfiles(): BrandProfile[] {
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
        products: group.products,
      };
    })
    .filter((brand) => brand.productCount > 0);
}

function getBrandProfileBySlug(slug: string) {
  return getBrandProfiles().find((brand) => brand.slug === slug);
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

function buildBrandDetailHref({
  slug,
  page,
}: {
  slug: string;
  page?: number;
}) {
  if (!page || page <= 1) {
    return `/brands/${slug}`;
  }

  return `/brands/${slug}?page=${page}`;
}

function isPlaceholderText(value?: string) {
  const text = String(value || "").trim();

  if (!text) return true;

  const placeholderPatterns = [
    "待补充",
    "后续补充",
    "模板资料",
    "资料来源待补充",
    "品牌资料后续补充",
    "当前收录来自公开库存页",
    "适合希望按品牌查看当前公开库存的用户",
    "以当前库存页和人工确认为准",
  ];

  return placeholderPatterns.some((pattern) => text.includes(pattern));
}

function getMeaningfulText(value?: string) {
  const text = String(value || "").trim();
  return isPlaceholderText(text) ? "" : text;
}

function getMeaningfulList(items?: string[]) {
  return (items || [])
    .map((item) => String(item || "").trim())
    .filter((item) => item && !isPlaceholderText(item));
}

function getBrandLogoUrl(brand: BrandProfile) {
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

function getBrandChineseName(brand: BrandProfile) {
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

  return "BR";
}

function isSoldProduct(product: PipeProduct) {
  return (
    product.status.includes("已售") ||
    product.tags?.some((tag) => tag.includes("已售")) ||
    false
  );
}

function getGalleryCount(product: PipeProduct) {
  return product.galleryImages?.length || 0;
}

function getProductDisplayName(product: PipeProduct) {
  const brandPrefix = `${product.brand}, `;

  if (product.name.startsWith(brandPrefix)) {
    return product.name.slice(brandPrefix.length).trim() || product.name;
  }

  return product.name;
}

function BrandLogoBlock({ brand }: { brand: BrandProfile }) {
  const logoUrl = getBrandLogoUrl(brand);
  const shortName = getBrandShortName(brand.name);

  return (
    <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#E7DDD0] bg-white shadow-[0_8px_20px_rgba(31,26,22,0.04)]">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${brand.name} logo`}
          className="h-full w-full object-contain p-3"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FFFDF8] to-[#F1E7D8]">
          <span
            className="text-[30px] font-semibold tracking-[0.04em] text-[#063B32]"
            style={{
              fontFamily: '"Georgia", "Times New Roman", serif',
            }}
          >
            {shortName}
          </span>
        </div>
      )}
    </div>
  );
}

function BrandHeroCard({ brand }: { brand: BrandProfile }) {
  const chineseName = getBrandChineseName(brand);
  const country = getMeaningfulText(brand.country);
  const summary =
    getMeaningfulText(brand.summary) ||
    "当前收录该品牌的海外公开库存，品牌资料将随整理持续补充。";

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
            {brand.name}
          </h1>

          {chineseName ? (
            <p className="mt-1 text-[15px] font-semibold text-[#8A5D26]">
              {chineseName}
            </p>
          ) : null}

          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F7F3EA] px-3 py-1 text-[#063B32]">
            <InventoryIcon className="h-4 w-4" />
            <span className="text-[13px] font-semibold">
              当前关联库存 {brand.productCount} 件
            </span>
          </div>
        </div>
      </div>

      <p className="mt-5 text-[13px] leading-7 text-[#746A5F]">{summary}</p>
    </section>
  );
}

function BrandFacts({ brand }: { brand: BrandProfile }) {
  const facts = [
    {
      label: "国家 / 地区",
      value: getMeaningfulText(brand.country),
    },
    {
      label: "创立时间",
      value: getMeaningfulText(brand.founded),
    },
    {
      label: "价格区间",
      value: getMeaningfulText(brand.priceRange),
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
            <span className="font-semibold text-[#1F1A16]">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrandStory({ brand }: { brand: BrandProfile }) {
  const story = getMeaningfulText(brand.story);

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

function SuitableForSection({ brand }: { brand: BrandProfile }) {
  const suitableFor = getMeaningfulText(brand.suitableFor);

  if (!suitableFor) return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <h2 className="mb-3 text-[19px] font-bold text-[#1F1A16]">
        适合人群
      </h2>

      <p className="text-[13px] leading-7 text-[#746A5F]">{suitableFor}</p>
    </section>
  );
}

function SourceSection({ brand }: { brand: BrandProfile }) {
  const urls = (brand.sourceUrls || []).filter(
    (url) => url && !isPlaceholderText(url)
  );

  if (urls.length === 0) return null;

  return (
    <section className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
      <h2 className="mb-3 text-[19px] font-bold text-[#1F1A16]">资料来源</h2>

      <div className="grid gap-2.5">
        {urls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="break-all rounded-[16px] border border-[#E7DDD0] bg-white px-3 py-2.5 text-[12px] font-medium leading-5 text-[#8A5D26] transition hover:border-[#A97838]"
          >
            {url}
          </a>
        ))}
      </div>
    </section>
  );
}

function StockCard({ product }: { product: PipeProduct }) {
  const galleryCount = getGalleryCount(product);
  const statusLabel = isSoldProduct(product) ? "已售参考" : "在售";
  const displayName = getProductDisplayName(product);

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block h-full overflow-hidden rounded-[18px] border border-[#E7DDD0] bg-white shadow-[0_6px_18px_rgba(31,26,22,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(31,26,22,0.1)]"
    >
      <article className="flex h-full flex-col">
        <div className="relative h-[122px] bg-[#F8F4EC] sm:h-[150px]">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-contain p-2.5"
            draggable={false}
            loading="lazy"
          />

          <span
            className={[
              "absolute left-2 top-2 rounded-md px-1.5 py-1 text-[10px] font-medium leading-none shadow-sm",
              isSoldProduct(product)
                ? "bg-[#C47712] text-white"
                : "bg-[#063B32] text-white",
            ].join(" ")}
          >
            {statusLabel}
          </span>

          {galleryCount > 1 ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-white/92 px-2 py-0.5 text-[10px] font-medium text-[#746A5F] shadow-sm">
              {galleryCount} 图
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col p-2.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#9A6530]">
            {product.brand}
          </p>

          <h3 className="mt-1 line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-[1.35] text-[#1F1A16]">
            {displayName}
          </h3>

          <div className="mt-2 space-y-1 border-t border-[#F0E6D8] pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#746A5F]">{RMB_REFERENCE_LABEL}</span>
              <span className="text-[11px] font-semibold text-[#1F1A16]">
                {getRmbReferencePrice(product as unknown as Record<string, unknown>)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#746A5F]">库存状态</span>
              <span className="text-[11px] font-semibold text-[#063B32]">
                {product.status}
              </span>
            </div>
          </div>

          <span className="mt-3 flex h-8 items-center justify-center rounded-full bg-[#063B32] text-[12px] font-semibold tracking-[0.04em] text-[#E7C48A] transition group-hover:bg-[#0A4A3E]">
            查看详情
          </span>
        </div>
      </article>
    </Link>
  );
}

function RelatedStockSection({
  slug,
  products,
  totalCount,
  currentPage,
  totalPages,
  paginationItems,
}: {
  slug: string;
  products: PipeProduct[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  paginationItems: PaginationItem[];
}) {
  const shouldShowPagination = totalPages > 1;

  return (
    <section className="mt-7">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.3em] text-[#A97838]">
            Related Stock
          </p>

          <h2 className="text-[23px] font-bold text-[#1F1A16]">
            当前相关库存
            <span className="ml-2 text-[15px] font-semibold text-[#A97838]">
              {totalCount} 件
            </span>
          </h2>
        </div>

        {shouldShowPagination ? (
          <p className="shrink-0 text-[12px] text-[#746A5F]">
            第 {currentPage} / {totalPages} 页
          </p>
        ) : null}
      </div>

      {products.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {products.map((product) => (
              <StockCard
                key={`${product.id}-${product.sourceUrl}`}
                product={product}
              />
            ))}
          </div>

          {shouldShowPagination ? (
            <nav
              className="mt-7 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]"
              aria-label="品牌相关库存分页"
            >
              <div className="flex flex-wrap items-center justify-center gap-2">
                {currentPage === 1 ? (
                  <span className="h-9 rounded-full border border-[#E7DDD0] bg-[#F7F3EA] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
                    上一页
                  </span>
                ) : (
                  <Link
                    href={buildBrandDetailHref({
                      slug,
                      page: currentPage - 1,
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

                  const isActive = item === currentPage;

                  return (
                    <Link
                      key={item}
                      href={buildBrandDetailHref({
                        slug,
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

                {currentPage === totalPages ? (
                  <span className="h-9 rounded-full border border-[#E7DDD0] bg-[#F7F3EA] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
                    下一页
                  </span>
                ) : (
                  <Link
                    href={buildBrandDetailHref({
                      slug,
                      page: currentPage + 1,
                    })}
                    className="h-9 rounded-full border border-[#D8CFC2] bg-white px-3 py-2 text-[12px] font-semibold text-[#1F1A16] transition hover:border-[#063B32] hover:text-[#063B32]"
                  >
                    下一页
                  </Link>
                )}
              </div>
            </nav>
          ) : null}
        </>
      ) : (
        <div className="rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] p-8 text-center text-[13px] leading-6 text-[#746A5F] shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
          当前暂无关联库存。
        </div>
      )}
    </section>
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

export function generateStaticParams() {
  return getBrandProfiles().map((brand) => ({
    slug: brand.slug,
  }));
}

export default async function BrandDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedPage = Number.parseInt(
    String(resolvedSearchParams?.page || "1"),
    10
  );

  const brand = getBrandProfileBySlug(slug);

  if (!brand) {
    notFound();
  }

  const relatedProducts = brand.products;
  const totalStockPages = Math.max(
    1,
    Math.ceil(relatedProducts.length / RELATED_STOCK_PAGE_SIZE)
  );
  const safeStockPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalStockPages
  );
  const stockStartIndex = (safeStockPage - 1) * RELATED_STOCK_PAGE_SIZE;
  const stockEndIndex = Math.min(
    stockStartIndex + RELATED_STOCK_PAGE_SIZE,
    relatedProducts.length
  );
  const paginatedRelatedProducts = relatedProducts.slice(
    stockStartIndex,
    stockEndIndex
  );
  const stockPaginationItems = getPaginationItems(
    safeStockPage,
    totalStockPages
  );

  const features = getMeaningfulList(brand.features);
  const representativeStyles = getMeaningfulList(brand.representativeStyles);

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
        <BackButton className="mb-4 inline-flex items-center gap-2 text-[14px] font-semibold text-[#063B32]">
          <ArrowLeftIcon className="h-4 w-4" />
          返回
        </BackButton>

        <BrandHeroCard brand={brand} />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <BrandFacts brand={brand} />
          <BrandStory brand={brand} />
          <TextListSection title="品牌特点" items={features} />
          <TextListSection title="代表风格" items={representativeStyles} />
          <SuitableForSection brand={brand} />
          <SourceSection brand={brand} />
        </div>

        <RelatedStockSection
          slug={slug}
          products={paginatedRelatedProducts}
          totalCount={relatedProducts.length}
          currentPage={safeStockPage}
          totalPages={totalStockPages}
          paginationItems={stockPaginationItems}
        />

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
