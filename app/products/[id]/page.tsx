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

function structuredSpecRows(product: PublicDetailProduct): SpecRow[] {
  const rows: Array<{ label: string; value: unknown }> = [
    { label: "品牌", value: product.brandName },
    { label: "国家 / 地区", value: countryLabel(product.brandCountry) },
    { label: "斗型", value: shapeDisplayLabel(product.shape, product.shapeZh) },
    {
      label: "状态",
      value: conditionDisplayLabel(product.conditionType, product.conditionLabel),
    },
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

function productSpecRows(product: PublicDetailProduct) {
  const structured = structuredSpecRows(product);
  return [...structured, ...additionalSpecRows(product, structured)];
}

function displayBadges(product: PublicDetailProduct) {
  const candidates = [
    inventoryLabel(product.inventoryStatus),
    conditionDisplayLabel(product.conditionType, product.conditionLabel),
    product.galleryCount > 1 ? `${product.galleryCount} 图` : "",
  ];
  const seen = new Set<string>();

  return candidates
    .map(knownText)
    .filter(Boolean)
    .filter((badge) => {
      const key = badge.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
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
  const specs = productSpecRows(product);
  const mainImage = product.mainImage || product.gallery[0] || "";
  const rawReturnTo = String(
    firstParam(resolvedSearchParams.returnTo) || ""
  ).trim();
  const backLabel = productBackLabel(rawReturnTo);
  const detailSummary =
    "页面价格与库存为采集时参考信息，实际购买需人工确认。";
  const statusSummary = displayBadges(product).join(" · ");
  const coreSpecs = specs.slice(0, 6);

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
          className="mb-[14px] inline-flex items-center gap-1.5 text-[12px] font-normal leading-[1.4] text-[var(--coffee-dark)] transition-colors hover:text-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          {backLabel}
        </ProductBackButton>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.16fr)_minmax(360px,0.84fr)] lg:items-start lg:gap-12">
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
            {statusSummary ? (
              <p className="text-[10px] font-normal leading-[1.4] text-[var(--brass)]">
                {statusSummary}
              </p>
            ) : null}

            <p className="mt-4 text-[10px] font-normal uppercase tracking-[0.14em] text-[var(--brass)]">
              {product.brandName || "海外烟斗"}
            </p>

            <h1 className="mt-2 break-words text-[21px] font-medium leading-[1.38] tracking-normal text-[var(--text-primary)] sm:text-[22px] lg:text-[30px]">
              {title}
            </h1>

            {subtitle ? (
              <p className="mt-3 line-clamp-2 text-[12px] font-normal leading-[1.6] text-[var(--text-secondary)] lg:text-[13px]">
                {subtitle}
              </p>
            ) : null}

            <p className="mt-4 text-[11.5px] font-normal leading-[1.7] text-[var(--text-secondary)] lg:text-[12px]">
              {detailSummary}
            </p>

            <section className="mt-6 border-y border-[var(--border)] py-5">
              <div className="grid grid-cols-2 gap-x-6">
                <InfoItem label="参考价格" value={formatSitePrice(product)} strong />
                <InfoItem
                  label="库存状态"
                  value={inventoryLabel(product.inventoryStatus)}
                  strong
                />
              </div>
              <Link
                href={`/request?product=${encodeURIComponent(product.id)}`}
                className="mt-5 flex h-[46px] items-center justify-center rounded-[4px] bg-[var(--coffee-dark)] px-5 text-[14px] font-medium text-[#f4eee7] transition-colors hover:bg-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
              >
                <ChatIcon className="mr-2 h-4 w-4" />
                咨询这只斗
              </Link>
              <p className="mt-3 text-left text-[11px] font-normal leading-[1.6] text-[var(--text-secondary)]">
                人工为您确认库存、最终价格、国际运费与预计税费。
              </p>
            </section>

            {specs.length > 0 ? (
              <section className="mt-8 lg:hidden">
                <SpecList specs={specs} />
              </section>
            ) : null}

            {coreSpecs.length > 0 ? (
              <section className="mt-8 hidden lg:block">
                <SpecList specs={coreSpecs} compact />
              </section>
            ) : null}
          </div>
        </section>

        {specs.length > 0 ? (
          <section className="mt-8 hidden border-t border-[var(--border)] pt-5 lg:block">
            <SpecList specs={specs} title="完整产品参数" desktop />
          </section>
        ) : null}

        {brand && brandSlug ? (
          <section className="mt-8 border-y border-[var(--border)] py-6 lg:mt-10 lg:py-8">
            <p className="text-[9.5px] font-normal uppercase tracking-[0.16em] text-[var(--brass)]">
              Brand Profile
            </p>
            <h2 className="mt-2 text-[17px] font-medium leading-[1.4] text-[var(--text-primary)]">
              {brand.name}{brand.nameZh ? `｜${brand.nameZh}` : ""}
            </h2>

            {brandSummary.zh || brandSummary.en ? (
              <div className="mt-3 max-w-2xl space-y-2">
                {brandSummary.zh ? (
                  <p className="text-[12px] font-normal leading-[1.75] text-[var(--text-secondary)]">
                    {brandSummary.zh}
                  </p>
                ) : null}
                {brandSummary.en ? (
                  <p className="hidden text-[11px] font-normal leading-6 text-[var(--text-secondary)]/80 lg:block">
                    {brandSummary.en}
                  </p>
                ) : null}
              </div>
            ) : null}

            <Link
              href={`/brands/${brandSlug}`}
              className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--coffee)] underline decoration-[var(--brass)] underline-offset-4 transition-colors hover:text-[var(--brass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
            >
              查看品牌介绍
              <span aria-hidden="true">→</span>
            </Link>
          </section>
        ) : null}

        <section className="mt-8 pb-1 lg:mt-10">
          <p className="text-[9.5px] font-normal uppercase tracking-[0.16em] text-[var(--brass)]">
            Service Boundary
          </p>
          <h2 className="mt-2 text-[16px] font-medium leading-[1.4] text-[var(--text-primary)]">
            服务边界说明
          </h2>
          <p className="mt-3 max-w-3xl text-[11.5px] font-normal leading-[1.8] text-[var(--text-secondary)] lg:text-[12px]">
            本页展示的是海外公开页面采集时的烟斗器具库存信息与参考价格，不提供站内支付。实际入手前需人工确认库存状态、最终价格、国际运费、预计税费与代购服务费用。已售商品可作为品牌、斗型和价格区间参考。
          </p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function InfoItem({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[12px] text-[#746A5F]">{label}</p>
      <p
        className={[
          "mt-1 leading-tight",
          strong
            ? "text-[18px] font-medium text-[var(--text-primary)]"
            : "text-[14px] font-medium text-[var(--text-primary)]",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

function SpecList({
  specs,
  title = "产品参数",
  compact = false,
  desktop = false,
}: {
  specs: SpecRow[];
  title?: string;
  compact?: boolean;
  desktop?: boolean;
}) {
  return (
    <div>
      <h2 className="text-[18px] font-medium leading-[1.4] text-[var(--text-primary)] lg:text-[20px]">
        {title}
      </h2>
      <div
        className={[
          "mt-4",
          desktop ? "grid gap-x-12 md:grid-cols-2" : "",
        ].join(" ")}
      >
        {specs.map((spec, index) => (
          <div
            key={`${spec.label}-${index}`}
            className="flex min-h-[44px] items-center justify-between gap-5 border-b border-[var(--border)] py-[10px]"
          >
            <span className="text-[11.5px] font-normal text-[var(--text-secondary)]">
              {spec.label}
            </span>
            <span className="text-right text-[12px] font-medium text-[var(--text-primary)]">
              {spec.value}
            </span>
          </div>
        ))}
      </div>
      {compact ? (
        <p className="mt-3 text-[11px] font-normal leading-[1.6] text-[var(--text-secondary)]">
          完整参数请继续向下查看。
        </p>
      ) : null}
    </div>
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
        d="M6.2 17.2 5 20l3.1-1.2c1.1.6 2.4.9 3.9.9 4.4 0 7.8-3 7.8-6.8S16.4 6.1 12 6.1s-7.8 3-7.8 6.8c0 1.6.7 3.1 2 4.3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 12.2h7M8.5 14.8h4.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
