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
    product.conditionLabel,
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
  const detailSummary =
    "页面价格、库存状态、图片和参数为采集时参考信息。实际入手前需人工确认库存、最终价格、国际运费、预计税费和代购服务费用。";

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

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <ProductBackButton
          fallbackHref="/products"
          className="mb-4 inline-flex items-center gap-2 text-[14px] font-semibold text-[#063B32]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回海外库存
        </ProductBackButton>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div className="overflow-hidden rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <ProductGallery
              productId={product.id}
              name={title}
              imageUrl={mainImage}
              galleryImages={product.gallery}
              initialIndex={safeInitialImageIndex}
            />
          </div>

          <section className="rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <div className="mb-4 flex flex-wrap gap-2">
              {displayBadges(product).map((badge) => (
                <span
                  key={badge}
                  className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-semibold text-[#A97838]"
                >
                  {badge}
                </span>
              ))}
            </div>

            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#A97838]">
              {product.brandName || "海外烟斗"}
            </p>

            <h1 className="mt-2 break-words text-[24px] font-bold leading-[1.22] tracking-tight text-[#1F1A16] sm:text-4xl">
              {title}
            </h1>

            {subtitle ? (
              <p className="mt-3 text-[15px] font-medium leading-7 text-[#746A5F]">
                {subtitle}
              </p>
            ) : null}

            <p className="mt-4 text-[14px] leading-7 text-[#746A5F] sm:text-[15px]">
              {detailSummary}
            </p>
          </section>
        </section>

        <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
          <h2 className="mb-4 text-[20px] font-bold text-[#1F1A16]">
            价格与库存参考
          </h2>

          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <InfoItem label="参考价格" value={formatSitePrice(product)} strong />
            <InfoItem
              label="库存状态"
              value={inventoryLabel(product.inventoryStatus)}
              strong
            />
          </div>
        </section>

        <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
          <Link
            href={`/request?product=${encodeURIComponent(product.id)}`}
            className="flex h-12 items-center justify-center rounded-full bg-[#063B32] px-5 text-[15px] font-semibold tracking-[0.06em] text-[#E7C48A] transition hover:bg-[#0A4A3E]"
          >
            <ChatIcon className="mr-2 h-5 w-5" />
            咨询这只斗
          </Link>
          <p className="mt-3 text-center text-[12px] leading-5 text-[#746A5F]">
            人工为您确认库存、最终价格、国际运费与预计税费。
          </p>
        </section>

        {specs.length > 0 ? (
          <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <h2 className="mb-4 text-[20px] font-bold text-[#1F1A16]">
              产品参数
            </h2>

            <div className="grid gap-x-6 sm:grid-cols-2">
              {specs.map((spec, index) => (
                <div
                  key={`${spec.label}-${index}`}
                  className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] py-2.5 text-[13px]"
                >
                  <span className="text-[#746A5F]">{spec.label}</span>
                  <span className="text-right font-semibold text-[#1F1A16]">
                    {spec.value}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {brand && brandSlug ? (
          <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[20px] font-bold text-[#1F1A16]">
                品牌信息
              </h2>
              {knownText(brand.country) ? (
                <span className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-semibold text-[#A97838]">
                  {countryLabel(brand.country)}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-semibold text-[#1F1A16]">
                {brand.name}
              </span>
            </div>

            {brandSummary.zh || brandSummary.en ? (
              <div className="mt-3 space-y-2">
                {brandSummary.zh ? (
                  <p className="text-[13px] leading-7 text-[#746A5F]">
                    {brandSummary.zh}
                  </p>
                ) : null}
                {brandSummary.en ? (
                  <p className="text-[12px] leading-6 text-[#9A8F84]">
                    {brandSummary.en}
                  </p>
                ) : null}
              </div>
            ) : null}

            <Link
              href={`/brands/${brandSlug}`}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-5 text-[13px] font-semibold text-[#8A5D26] transition hover:border-[#A97838]"
            >
              查看品牌介绍
            </Link>
          </section>
        ) : null}

        <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.26em] text-[#A97838]">
            Service Boundary
          </p>
          <h2 className="text-[20px] font-bold text-[#1F1A16]">
            服务边界说明
          </h2>
          <p className="mt-3 text-[13px] leading-7 text-[#746A5F]">
            本页展示的是海外公开页面采集时的烟斗器具库存信息与参考价格，不提供站内支付。实际入手前需人工确认库存状态、最终价格、国际运费、预计税费与代购服务费用。已售商品可作为品牌、斗型和价格区间参考。
          </p>
        </section>
      </div>

      <SiteFooter />
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
            ? "text-[16px] font-bold text-[#1F1A16]"
            : "text-[14px] font-semibold text-[#1F1A16]",
        ].join(" ")}
      >
        {value}
      </p>
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
