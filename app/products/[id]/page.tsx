import Link from "next/link";
import { notFound } from "next/navigation";
import BackButton from "../../components/BackButton";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
import {
  getConditionDisplayLabel,
  getProductChineseTitle,
  getProductEnglishTitle,
  parseBrandSummary,
} from "../../utils/display";
import { getRmbReferencePrice, RMB_REFERENCE_LABEL } from "../../utils/price";
import { getBrandByName } from "../../../data/brands";
import { pipeProducts } from "../../../data/pipes";
import ProductGallery from "./ProductGallery";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    img?: string;
  }>;
};

type ProductWithExtras = (typeof pipeProducts)[number] & {
  galleryImages?: string[];
  specsText?: string[];
  tags?: string[];
  sourceUrl?: string;
  conditionLabel?: string;
  brandZh?: string;
  brandChinese?: string;
  nameZh?: string;
  titleZh?: string;
  translatedName?: string;
  chineseName?: string;
};

type IconProps = {
  className?: string;
};

function getDisplayBadges(product: ProductWithExtras, galleryCount: number) {
  const seen = new Set<string>();
  const candidates = [
    getConditionDisplayLabel(product),
    product.status,
    galleryCount > 0 ? `${galleryCount} 图` : "",
  ];

  return candidates
    .map((badge) => String(badge || "").trim())
    .filter(Boolean)
    .filter((badge) => {
      const key = badge.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function getProductChineseName(product: ProductWithExtras) {
  return getProductChineseTitle(product);
}

function isKnownDetailValue(value: unknown) {
  const text = String(value || "").trim();
  return Boolean(text) && text.toLowerCase() !== "unknown";
}

function formatMillimeter(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value} mm`
    : "";
}

function formatWeight(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value} g` : "";
}

function getStructuredSpecs(product: ProductWithExtras) {
  const dimensions = product.dimensions;
  const rows = [
    { label: "品牌", value: product.canonicalBrand || product.brand },
    { label: "国家", value: product.brandCountry },
    { label: "斗型", value: product.shapeZh },
    { label: "状态", value: getConditionDisplayLabel(product) },
    { label: "重量", value: formatWeight(product.weightGrams) },
    { label: "长度", value: formatMillimeter(dimensions?.lengthMm) },
    { label: "高度", value: formatMillimeter(dimensions?.heightMm) },
    { label: "斗钵室内径", value: formatMillimeter(dimensions?.chamberDiameterMm) },
    { label: "斗钵室深", value: formatMillimeter(dimensions?.chamberDepthMm) },
    { label: "斗钵壁直径", value: formatMillimeter(dimensions?.bowlOuterDiameterMm) },
    { label: "咬嘴宽度", value: formatMillimeter(dimensions?.buttonWidthMm) },
    { label: "咬嘴厚度", value: formatMillimeter(dimensions?.bitThicknessMm) },
    { label: "表面工艺", value: product.finishZh },
    { label: "木纹", value: product.grainPatternZh },
    { label: "材质", value: product.materialZh },
    { label: "斗嘴材质", value: product.stemMaterialZh },
    { label: "工程结构", value: product.engineeringFeatureZh },
  ];

  return rows.filter((row) => isKnownDetailValue(row.value));
}

function getBrandChineseName(
  product: ProductWithExtras,
  brand: ReturnType<typeof getBrandByName>
) {
  const brandRecord = brand as Record<string, unknown> | undefined;

  const fromProduct = product.brandZh || product.brandChinese;

  if (fromProduct) return String(fromProduct);

  const fromBrand =
    brandRecord?.nameZh ||
    brandRecord?.brandZh ||
    brandRecord?.chineseName ||
    brandRecord?.nameChinese;

  return typeof fromBrand === "string" ? fromBrand : "";
}

function getUniqueImageCount(product: ProductWithExtras) {
  const seen = new Set<string>();

  [product.imageUrl, ...(product.galleryImages || [])].forEach((image) => {
    if (image) seen.add(image);
  });

  return seen.size;
}

function cleanSpecText(spec: string) {
  return String(spec || "")
    .replace(/^\s*[A-Z]\s*[:：]\s*/i, "")
    .trim();
}

function translateSpecLabel(label: string) {
  const normalized = label.trim().toLowerCase();

  const dictionary: Record<string, string> = {
    "button width": "咬嘴宽度",
    "bit thickness": "咬嘴厚度",
    length: "长度",
    height: "高度",
    weight: "重量",
  };

  return dictionary[normalized] || label.trim();
}

function parseSpec(spec: string) {
  const cleaned = cleanSpecText(spec);
  const parts = cleaned.split(/[:：]/);

  if (parts.length >= 2) {
    const label = translateSpecLabel(parts[0]);
    const value = parts.slice(1).join(":").trim();

    return {
      label,
      value,
    };
  }

  return {
    label: cleaned,
    value: "",
  };
}

function normalizeSpecLabel(label: string) {
  return String(label || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isCoveredSpecLabel(label: string, structuredLabels: Set<string>) {
  const normalized = normalizeSpecLabel(label);
  const duplicatePatterns = [
    "brand",
    "品牌",
    "country",
    "国家",
    "shape",
    "斗型",
    "condition",
    "status",
    "状态",
    "weight",
    "重量",
    "length",
    "长度",
    "height",
    "高度",
    "chamber diameter",
    "斗钵室内径",
    "chamber depth",
    "斗钵室深",
    "bowl diameter",
    "斗钵壁直径",
    "斗钵直径",
    "button width",
    "bit width",
    "咬嘴宽度",
    "bit thickness",
    "咬嘴厚度",
    "filter",
    "滤芯",
    "material",
    "材质",
    "finish",
    "表面工艺",
  ];

  return (
    structuredLabels.has(normalized) ||
    duplicatePatterns.some((pattern) =>
      /[\u4e00-\u9fff]/.test(pattern)
        ? normalized === pattern
        : normalized.includes(pattern)
    )
  );
}

function getAdditionalSpecs(
  specsText: string[],
  structuredSpecs: Array<{ label: string; value: unknown }>
) {
  const structuredLabels = new Set(
    structuredSpecs.map((spec) => normalizeSpecLabel(spec.label))
  );

  return specsText
    .map(parseSpec)
    .filter((spec) => spec.label)
    .filter((spec) => !isCoveredSpecLabel(spec.label, structuredLabels));
}

export function generateStaticParams() {
  return pipeProducts.map((product) => ({
    id: String(product.id),
  }));
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialImageIndex = Number(resolvedSearchParams.img || 0);

  const product = pipeProducts.find(
    (item) => String(item.id) === String(id)
  ) as ProductWithExtras | undefined;

  if (!product) {
    notFound();
  }

  const galleryImages = product.galleryImages ?? [];
  const specsText = product.specsText ?? [];
  const galleryCount = getUniqueImageCount(product);
  const displayBadges = getDisplayBadges(product, galleryCount);
  const chineseProductName = getProductChineseName(product);
  const englishProductName = getProductEnglishTitle(product);
  const displayTitle = chineseProductName || englishProductName;
  const subtitleTitle = chineseProductName ? englishProductName : "";
  const displayBrand = product.canonicalBrand || product.brand;
  const brand = getBrandByName(displayBrand);
  const rmbReferencePrice = getRmbReferencePrice(
    product as unknown as Record<string, unknown>
  );
  const structuredSpecs = getStructuredSpecs(product);
  const additionalSpecs = getAdditionalSpecs(specsText, structuredSpecs);
  const productSpecs = [...structuredSpecs, ...additionalSpecs];
  const brandSummary = parseBrandSummary(brand?.summary);
  const detailSummary = `来自 ${product.source} 公开页面。页面价格、库存状态、图片和参数为采集时参考信息。实际购买前需人工确认库存、最终价格、国际运费、预计税费和代购服务费用。`;

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
        <BackButton className="mb-4 inline-flex items-center gap-2 text-[14px] font-semibold text-[#063B32]">
  <ArrowLeftIcon className="h-4 w-4" />
  返回
</BackButton>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div className="overflow-hidden rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <ProductGallery
              productId={product.id}
              name={product.name}
              imageUrl={product.imageUrl}
              galleryImages={galleryImages}
              initialIndex={initialImageIndex}
            />
          </div>

          <section className="rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <div className="mb-4 flex flex-wrap gap-2">
              {displayBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-semibold text-[#A97838]"
                >
                  {badge}
                </span>
              ))}
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#A97838]">
                {displayBrand}
              </p>
            </div>

            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#1F1A16] sm:text-4xl">
              {displayTitle}
            </h1>

            {subtitleTitle ? (
              <p className="mt-3 text-[15px] font-medium leading-7 text-[#746A5F]">
                {subtitleTitle}
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

          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
            <InfoItem label={RMB_REFERENCE_LABEL} value={rmbReferencePrice} strong />
            <InfoItem label="库存状态" value={product.status} strong />
            <InfoItem label="来源网站" value={product.source} />
          </div>

          <div className="mt-4 border-t border-[#F0E6D8] pt-3">
            <InfoItem label="更新时间" value={product.updatedAt} horizontal />
          </div>
        </section>

        <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
          <Link
            href={`/request?product=${encodeURIComponent(String(product.id))}`}
            className="flex h-12 items-center justify-center rounded-full bg-[#063B32] px-5 text-[15px] font-semibold tracking-[0.06em] text-[#E7C48A] transition hover:bg-[#0A4A3E]"
          >
            <ChatIcon className="mr-2 h-5 w-5" />
            咨询这只斗
          </Link>

          <p className="mt-3 text-center text-[12px] leading-5 text-[#746A5F]">
            人工为您确认库存、最终价格、国际运费与预计税费。
          </p>
        </section>

        {productSpecs.length > 0 ? (
          <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <h2 className="mb-4 text-[20px] font-bold text-[#1F1A16]">
              产品参数
            </h2>

            <div className="grid gap-x-6 sm:grid-cols-2">
              {productSpecs.map((spec, index) => (
                <div
                  key={`${spec.label}-${index}`}
                  className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] py-2.5 text-[13px]"
                >
                  <span className="text-[#746A5F]">{spec.label}</span>
                  {spec.value ? (
                    <span className="font-semibold text-[#1F1A16]">
                      {spec.value}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {brand ? (
          <section className="mt-4 rounded-[26px] border border-[#E7DDD0] bg-[#FFFDF8] p-5 shadow-[0_10px_28px_rgba(31,26,22,0.045)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[20px] font-bold text-[#1F1A16]">
                品牌信息
              </h2>

              <span className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-semibold text-[#A97838]">
                {brand.country}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-semibold text-[#1F1A16]">
                {brand.name}
              </span>

              <span className="rounded-full bg-[#F7F3EA] px-3 py-1 text-[12px] font-medium text-[#746A5F]">
                {brand.level}
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
              href={`/brands/${brand.slug}`}
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
            本页展示的是海外公开页面采集时的烟斗器具库存信息与参考价格，不提供站内支付。
            实际入手前需人工确认库存状态、最终价格、国际运费、预计税费与代购服务费用。
            已售商品可作为品牌、斗型和价格区间参考。
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
  gold = false,
  strong = false,
  horizontal = false,
}: {
  label: string;
  value: string;
  gold?: boolean;
  strong?: boolean;
  horizontal?: boolean;
}) {
  if (horizontal) {
    return (
      <div className="flex items-center justify-between gap-4 text-[13px]">
        <span className="text-[#746A5F]">{label}</span>
        <span className="font-semibold text-[#1F1A16]">{value}</span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] text-[#746A5F]">{label}</p>
      <p
        className={[
          "mt-1 leading-tight",
          gold
            ? "text-[22px] font-medium text-[#A97838]"
            : strong
              ? "text-[16px] font-bold text-[#1F1A16]"
              : "text-[14px] font-semibold text-[#1F1A16]",
        ].join(" ")}
        style={
          gold
            ? {
                fontFamily: '"Georgia", "Times New Roman", serif',
                fontVariantNumeric: "lining-nums",
              }
            : undefined
        }
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
