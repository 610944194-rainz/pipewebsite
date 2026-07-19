import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
import { parseBrandSummary } from "../../utils/display";
import { getBrandByName } from "@/data/brands";
import { getProductDisplayName } from "@/lib/product-display-name";
import {
  conditionDisplayLabel,
  countryLabel,
  filterDisplayLabel,
  formatSitePrice,
  inventoryLabel,
  shapeDisplayLabel,
} from "@/lib/public-products/presentation";
import {
  getPublicProductDetailById,
  resolvePublicProductId,
} from "@/lib/public-products/server";
import type {
  PublicDetailProduct,
  PublicDetailSpec,
} from "@/lib/public-products/types";
import ProductGallery, { ProductBackButton } from "./ProductGallery";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type IconProps = {
  className?: string;
};

type SpecRow = {
  label: string;
  value: string;
};

type ProductSpecGroups = {
  basic: SpecRow[];
  dimensions: SpecRow[];
};

const FEATURED_BRAND_LOGOS: Record<
  string,
  { src: string; maxWidth: number; maxHeight: number; scale: number }
> = {
  peterson: {
    src: "/brands/featured/peterson-logo-1600x800.png",
    maxWidth: 130,
    maxHeight: 48,
    scale: 1.08,
  },
  savinelli: {
    src: "/brands/featured/savinelli-logo-1600x800.png",
    maxWidth: 124,
    maxHeight: 48,
    scale: 1,
  },
  stanwell: {
    src: "/brands/featured/stanwell-logo-1600x800.png",
    maxWidth: 118,
    maxHeight: 44,
    scale: 0.88,
  },
  dunhill: {
    src: "/brands/featured/dunhill-logo-1600x800.png",
    maxWidth: 110,
    maxHeight: 44,
    scale: 1,
  },
  chacom: {
    src: "/brands/featured/chacom-logo-1600x800.png",
    maxWidth: 110,
    maxHeight: 46,
    scale: 0.95,
  },
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildDetailHref(
  id: string,
  searchParams: Record<string, string | string[] | undefined>
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    const first = firstParam(value);
    if (first) params.set(key, first);
  }

  const query = params.toString();
  return query ? `/products/${id}?${query}` : `/products/${id}`;
}

function productBackLabel(returnTo: string) {
  if (/^\/(?:[?#]|$)/.test(returnTo)) return "返回首页";
  if (/^\/featured(?:[?#]|$)/.test(returnTo)) return "返回今日精选";
  if (/^\/brands\/[a-z0-9][a-z0-9-]*(?:[?#]|$)/i.test(returnTo)) {
    return "返回品牌页";
  }

  return "返回海外库存";
}

function knownText(value: unknown) {
  const text = String(value ?? "").trim();
  return text && text.toLowerCase() !== "unknown" ? text : "";
}

function formatMillimeter(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value} mm`
    : "";
}

function formatWeight(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value} g` : "";
}

function normalizeLabel(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-:/：]+/g, "")
    .trim();
}

function humanizeSpecKey(key: string) {
  const dictionary: Record<string, string> = {
    buttonWidth: "咬嘴宽度",
    bitWidth: "咬嘴宽度",
    bitThickness: "咬嘴厚度",
    grainPattern: "木纹",
    engineeringFeature: "工程结构",
    material: "材质",
  };

  if (dictionary[key]) return dictionary[key];

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function normalizedSpecValue(spec: PublicDetailSpec) {
  const value = knownText(spec.value);
  if (!value) return "";

  const unit = knownText(spec.unit);
  if (!unit || value.toLowerCase().endsWith(unit.toLowerCase())) return value;
  return `${value} ${unit}`;
}

function basicSpecRows(product: PublicDetailProduct): SpecRow[] {
  const rows: Array<{ label: string; value: unknown }> = [
    { label: "斗型", value: shapeDisplayLabel(product.shape, product.shapeZh) },
    {
      label: "新旧",
      value: conditionDisplayLabel(product.conditionType, product.conditionLabel),
    },
    { label: "表面工艺", value: product.finishZh || product.finish },
    { label: "斗钵材质", value: product.bowlMaterialZh || product.bowlMaterial },
    { label: "斗嘴材质", value: product.stemMaterialZh || product.stemMaterial },
    {
      label: "滤芯",
      value: product.filterSizeMm
        ? `${product.filterSizeMm} mm`
        : filterDisplayLabel(product.filter),
    },
  ];

  return rows
    .map((row) => ({ label: row.label, value: knownText(row.value) }))
    .filter((row) => row.value);
}

function dimensionSpecRows(product: PublicDetailProduct): SpecRow[] {
  const rows: Array<{ label: string; value: unknown }> = [
    { label: "重量", value: formatWeight(product.measurements?.weightGrams) },
    { label: "长度", value: formatMillimeter(product.measurements?.lengthMm) },
    { label: "高度", value: formatMillimeter(product.measurements?.heightMm) },
    {
      label: "烟室内径",
      value: formatMillimeter(product.measurements?.chamberDiameterMm),
    },
    {
      label: "烟室深度",
      value: formatMillimeter(product.measurements?.chamberDepthMm),
    },
    {
      label: "斗钵外径",
      value: formatMillimeter(product.measurements?.outsideDiameterMm),
    },
  ];

  return rows
    .map((row) => ({ label: row.label, value: knownText(row.value) }))
    .filter((row) => row.value);
}

function additionalSpecRows(
  product: PublicDetailProduct,
  existingRows: SpecRow[]
): SpecRow[] {
  const existingLabels = new Set(
    existingRows.map((row) => normalizeLabel(row.label))
  );
  const blockedKeys = new Set([
    "brand",
    "country",
    "source",
    "sourceproductid",
    "productcode",
    "series",
    "year",
    "shape",
    "condition",
    "status",
    "weight",
    "weightgrams",
    "weightg",
    "length",
    "lengthmm",
    "height",
    "heightmm",
    "chamberdiameter",
    "chamberdiametermm",
    "chamberdepth",
    "chamberdepthmm",
    "outsidediameter",
    "outsidediametermm",
    "bowldiameter",
    "bowldiametermm",
    "finish",
    "bowlmaterial",
    "stemmaterial",
    "filter",
    "rawtitle",
    "sourceurl",
    "price",
    "msrp",
  ]);
  const rows: SpecRow[] = [];

  for (const spec of product.normalizedSpecs || []) {
    const key = normalizeLabel(spec.key || "");
    if (!key || blockedKeys.has(key)) continue;

    const label = knownText(spec.labelZh) || humanizeSpecKey(spec.key);
    const value = normalizedSpecValue(spec);
    const normalized = normalizeLabel(label);

    if (!label || !value || existingLabels.has(normalized)) continue;
    existingLabels.add(normalized);
    rows.push({ label, value });
  }

  return rows.slice(0, 12);
}

function productSpecGroups(product: PublicDetailProduct): ProductSpecGroups {
  const basic = basicSpecRows(product);

  return {
    basic: [...basic, ...additionalSpecRows(product, basic)],
    dimensions: dimensionSpecRows(product),
  };
}

function resolveBrandLogo(
  brand: { logoUrl?: string } | undefined,
  brandSlug: string
) {
  const logoUrl = knownText(brand?.logoUrl);
  if (logoUrl) {
    return { src: logoUrl, maxWidth: 130, maxHeight: 48, scale: 1 };
  }

  return FEATURED_BRAND_LOGOS[brandSlug] || null;
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const resolved = resolvePublicProductId(id);

  if (!resolved) notFound();

  if (resolved.legacy) {
    redirect(buildDetailHref(resolved.id, resolvedSearchParams));
  }

  const product = getPublicProductDetailById(resolved.id);
  if (!product) notFound();

  const initialImageIndex = Number.parseInt(
    String(firstParam(resolvedSearchParams.img) || "0"),
    10
  );
  const safeInitialImageIndex = Number.isFinite(initialImageIndex)
    ? initialImageIndex
    : 0;
  const productDisplayName = getProductDisplayName(product);
  const title = productDisplayName.title;
  const subtitle = productDisplayName.subtitle;
  const brand = product.brandName ? getBrandByName(product.brandName) : undefined;
  const brandSummary = parseBrandSummary(brand?.summary);
  const brandSlug = product.brandSlug || brand?.slug || "";
  const specGroups = productSpecGroups(product);
  const hasSpecs =
    specGroups.basic.length > 0 || specGroups.dimensions.length > 0;
  const brandLogo = resolveBrandLogo(brand, brandSlug);
  const mainImage = product.mainImage || product.gallery[0] || "";
  const rawReturnTo = String(
    firstParam(resolvedSearchParams.returnTo) || ""
  ).trim();
  const backLabel = productBackLabel(rawReturnTo);

  return (
    <main
      className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]"
      style={{
        fontFamily:
          '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
        fontVariantNumeric: "lining-nums",
      }}
    >
      <SiteHeader />

      <div className="mx-auto max-w-[1240px] px-4 pb-12 pt-[18px] sm:px-6 lg:px-8 lg:pt-7">
        <ProductBackButton
          productId={product.id}
          fallbackHref="/products"
          ariaLabel={backLabel}
          className="mb-[14px] inline-flex h-10 w-10 items-center justify-center rounded-[4px] border border-[#e9e1d7] bg-transparent text-[var(--coffee-dark)] transition-colors hover:bg-[#f1e9df] active:bg-[#e9ded1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          <span className="sr-only">{backLabel}</span>
        </ProductBackButton>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.16fr)_minmax(360px,0.84fr)] lg:items-start lg:gap-12">
          <div className="lg:sticky lg:top-[88px] lg:self-start">
            <ProductGallery
              productId={product.id}
              name={title}
              imageUrl={mainImage}
              galleryImages={product.gallery}
              initialIndex={safeInitialImageIndex}
            />
          </div>

          <div>
            {brandSlug ? (
              <Link
                href={`/brands/${brandSlug}`}
                className="inline-flex flex-col text-[11px] font-medium uppercase leading-[1.3] tracking-[0.16em] text-[var(--brass)] transition-colors hover:text-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
              >
                {product.brandName || "海外烟斗"}
                <span className="mt-2 h-px w-7 bg-[var(--brass)]" aria-hidden="true" />
              </Link>
            ) : (
              <p className="text-[11px] font-medium uppercase leading-[1.3] tracking-[0.16em] text-[var(--brass)]">
                {product.brandName || "海外烟斗"}
              </p>
            )}

            <h1 className="mt-[10px] break-words text-[20px] font-medium leading-[1.4] tracking-normal text-[var(--text-primary)] lg:text-[28px]">
              {title}
            </h1>

            {subtitle ? (
              <p className="mt-3 line-clamp-2 text-[11.5px] font-normal leading-[1.55] text-[var(--text-secondary)] lg:text-[12px]">
                {subtitle}
              </p>
            ) : null}

            <section className="mt-5 border-y border-[var(--border)] py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[20px] font-medium leading-[1.3] text-[var(--text-primary)]">
                  {formatSitePrice(product)}
                </p>
                {product.inventoryStatus === "sold" ? (
                  <p className="shrink-0 text-[12px] font-normal leading-[1.4] text-[var(--text-secondary)]">
                    已售参考
                  </p>
                ) : (
                  <p className="flex shrink-0 items-center gap-2 text-[12px] font-normal leading-[1.4] text-[var(--text-secondary)]">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[var(--brass)]"
                      aria-hidden="true"
                    />
                    {inventoryLabel(product.inventoryStatus)}
                  </p>
                )}
              </div>
              <Link
                href={`/request?product=${encodeURIComponent(product.id)}`}
                className="mt-4 flex h-[46px] items-center justify-center rounded-[4px] bg-[#2A1710] px-5 text-[13.5px] font-medium tracking-[0.02em] text-[#f4eee7] transition-colors hover:bg-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
              >
                <ChatIcon className="mr-2 h-[17px] w-[17px] text-[var(--brass)]" />
                咨询这只斗
              </Link>
              <p className="mt-3 text-left text-[11px] font-normal leading-[1.6] text-[var(--text-secondary)]">
                库存、最终价格、国际运费及预计税费由人工确认。
              </p>
            </section>
          </div>
        </section>

        {hasSpecs ? (
          <section className="mt-8 border-t border-[var(--border)] pt-5 lg:mt-10 lg:pt-6">
            <ProductArchive groups={specGroups} />
          </section>
        ) : null}

        {brand && brandSlug ? (
          <section className="mt-8 rounded-[6px] bg-[#f3ece3] p-5 lg:mt-10 lg:grid lg:grid-cols-[minmax(150px,0.28fr)_minmax(0,1fr)] lg:items-center lg:gap-8">
            <p className="text-[9.5px] font-normal uppercase tracking-[0.16em] text-[var(--brass)]">
              Brand Profile
            </p>
            <div className="mt-4 lg:col-start-1 lg:row-start-2 lg:mt-0">
              {brandLogo ? (
                <div className="flex h-12 items-center">
                  <img
                    src={brandLogo.src}
                    alt={`${brand.name} Logo`}
                    className="max-h-[48px] w-auto object-contain object-left"
                    style={{
                      maxWidth: `${brandLogo.maxWidth}px`,
                      transform: `scale(${brandLogo.scale})`,
                      transformOrigin: "left center",
                    }}
                  />
                </div>
              ) : (
                <p className="text-[18px] font-medium tracking-[0.04em] text-[var(--coffee-dark)]">
                  {brand.name}
                </p>
              )}
            </div>
            <div className="mt-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
              <h2 className="text-[17px] font-medium leading-[1.4] text-[var(--text-primary)]">
                {brand.nameZh ? `${brand.nameZh} ${brand.name}` : brand.name}
              </h2>
              <p className="mt-1 text-[11px] font-normal leading-[1.4] text-[var(--brass)]">
                {brand.countryZh || countryLabel(brand.country)}
              </p>

              {brandSummary.zh || brandSummary.en ? (
                <p className="mt-3 line-clamp-3 text-[12px] font-normal leading-[1.75] text-[var(--text-secondary)]">
                  {brandSummary.zh || brandSummary.en}
                </p>
              ) : null}

              <Link
                href={`/brands/${brandSlug}`}
                className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--coffee)] underline decoration-[var(--brass)] underline-offset-4 transition-colors hover:text-[var(--brass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
              >
                查看品牌档案
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </section>
        ) : null}

        <section className="mt-7 border-t border-[var(--border)] pt-4 pb-1 lg:mt-8">
          <h2 className="text-[12px] font-medium leading-[1.4] tracking-[0.04em] text-[var(--text-primary)]">
            购买说明
          </h2>
          <p className="mt-2 max-w-3xl text-[11px] font-normal leading-[1.7] text-[var(--text-secondary)]">
            本页价格与库存为采集时参考信息，实际购买前需人工确认库存、最终价格、国际运费、预计税费及代购服务费用。
          </p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function ProductArchive({ groups }: { groups: ProductSpecGroups }) {
  return (
    <div>
      <p className="text-[9.5px] font-normal uppercase tracking-[0.16em] text-[var(--brass)]">
        Specifications
      </p>
      <h2 className="mt-2 text-[18px] font-medium leading-[1.4] text-[var(--text-primary)] lg:text-[20px]">
        产品档案
      </h2>

      {groups.basic.length > 0 ? (
        <ProductSpecGroup title="基本信息" specs={groups.basic} />
      ) : null}
      {groups.dimensions.length > 0 ? (
        <ProductSpecGroup
          title="尺寸数据"
          specs={groups.dimensions}
          className="mt-7"
        />
      ) : null}
    </div>
  );
}

function ProductSpecGroup({
  title,
  specs,
  className = "mt-5",
}: {
  title: string;
  specs: SpecRow[];
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="text-[12px] font-medium leading-[1.4] tracking-[0.04em] text-[var(--text-primary)]">
        {title}
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-x-5 lg:grid-cols-3 lg:gap-x-6">
        {specs.map((spec, index) => (
          <div
            key={`${spec.label}-${index}`}
            className="min-w-0 border-t border-[#e9e1d7] pb-3 pt-2.5"
          >
            <p className="truncate text-[10.5px] font-normal leading-[1.4] text-[var(--text-secondary)]">
              {spec.label}
            </p>
            <p className="mt-1 truncate text-[12.5px] font-medium leading-[1.4] text-[var(--text-primary)]">
              {spec.value}
            </p>
          </div>
        ))}
      </div>
    </section>
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

function ChatIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 11.6a7.5 7.5 0 0 1-8 7.5c-1.2 0-2.4-.3-3.4-.8L4.5 20l1.4-3.8A7.3 7.3 0 0 1 4 11.6 7.7 7.7 0 0 1 12 4a7.7 7.7 0 0 1 8 7.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.6 11.3h6.8M8.6 14.4h4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
