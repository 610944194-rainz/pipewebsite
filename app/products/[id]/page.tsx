import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
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
};

function getDisplayBadges(product: ProductWithExtras) {
  const seen = new Set<string>();
  const candidates = [
    product.conditionLabel || product.condition,
    product.status,
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
    .slice(0, 2);
}

function getDisplayTitle(product: ProductWithExtras) {
  const name = String(product.name || "").trim();
  const brand = String(product.brand || "").trim();
  const brandPrefix = `${brand}, `;

  if (brand && name.startsWith(brandPrefix)) {
    const titleWithoutBrand = name.slice(brandPrefix.length).trim();
    return titleWithoutBrand || name;
  }

  return name;
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
  const displayBadges = getDisplayBadges(product);
  const displayTitle = getDisplayTitle(product);
  const brand = getBrandByName(product.brand);
  const detailSummary =
    "来自 The Danish Pipe Shop 公开页面。页面价格、库存状态、图片和参数为采集时参考信息。实际购买前需人工确认库存、最终价格、国际运费、预计税费和代购服务费用。";

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
        <header className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
                PIPE DETAIL
              </p>

              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-4xl">
                烟斗详情
              </h1>

              <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                页面信息为采集时参考，购买前需人工确认库存、价格、运费和预计税费。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center">
              <Link
                href="/products"
                className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
              >
                返回商品库
              </Link>

              <Link
                href="/"
                className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
              >
                回到首页
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div className="overflow-hidden rounded-[24px] border border-[#E5D7C5] bg-white shadow-[0_5px_18px_rgba(43,33,28,0.03)]">
            <ProductGallery
              productId={product.id}
              name={product.name}
              imageUrl={product.imageUrl}
              galleryImages={galleryImages}
              initialIndex={initialImageIndex}
            />
          </div>

          <div className="space-y-4">
            <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
              <div className="mb-4 flex flex-wrap gap-1.5">
                {displayBadges.map((badge, index) => (
                  <span
                    key={badge}
                    className={`rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium ${
                      index < 2 ? "text-[#9A6530]" : "text-[#75695F]"
                    }`}
                  >
                    {badge}
                  </span>
                ))}
              </div>

              <p className="mb-1 text-[13px] font-semibold text-[#9A6530]">
                {product.brand}
              </p>

              <h2 className="max-w-3xl text-[28px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-4xl">
                {displayTitle}
              </h2>

              <p className="mt-4 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[15px]">
                {detailSummary}
              </p>
            </section>

            <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
              <h3 className="mb-4 text-[20px] font-bold text-[#2B211C]">
                价格与库存参考
              </h3>

              <div className="space-y-2 text-[13px]">
                <div className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] pb-2">
                  <span className="text-[#75695F]">海外原价</span>
                  <span className="font-semibold text-[#9A6530]">
                    {product.originalPrice}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] pb-2">
                  <span className="text-[#75695F]">人民币参考价</span>
                  <span className="font-bold text-[#2B211C]">
                    {product.estimatedCny}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] pb-2">
                  <span className="text-[#75695F]">来源网站</span>
                  <span className="font-semibold text-[#2B211C]">
                    {product.source}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] pb-2">
                  <span className="text-[#75695F]">库存状态</span>
                  <span className="font-semibold text-[#2B211C]">
                    {product.status}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#75695F]">更新时间</span>
                  <span className="font-semibold text-[#2B211C]">
                    {product.updatedAt}
                  </span>
                </div>
              </div>
            </section>

            {brand && (
              <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h3 className="text-[20px] font-bold text-[#2B211C]">
                    品牌信息
                  </h3>
                  <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-semibold text-[#9A6530]">
                    {brand.country}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[12px] font-semibold text-[#2B211C]">
                    {brand.name}
                  </span>
                  <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[12px] font-medium text-[#75695F]">
                    {brand.level}
                  </span>
                </div>

                <p className="mt-3 text-[13px] leading-6 text-[#75695F]">
                  {brand.summary}
                </p>

                <Link
                  href={`/brands/${brand.slug}`}
                  className="mt-4 flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                >
                  查看品牌介绍
                </Link>
              </section>
            )}

            {specsText.length > 0 && (
              <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
                <h3 className="mb-4 text-[20px] font-bold text-[#2B211C]">
                  参数信息
                </h3>

                <div className="grid gap-2 sm:grid-cols-2">
                  {specsText.map((spec) => (
                    <div
                      key={spec}
                      className="rounded-[16px] border border-[#F0E6D8] bg-[#FAF7F0] px-3 py-2.5 text-[13px] font-semibold leading-6 text-[#2B211C]"
                    >
                      {spec}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              {product.sourceUrl && (
                <a
                  href={product.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-5 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                >
                  查看原站链接
                </a>
              )}

              <a
                href="#consult"
                className="flex h-11 items-center justify-center rounded-full bg-[#A9682B] px-5 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
              >
                咨询这只斗
              </a>
            </div>
          </div>
        </section>

        <section
          id="consult"
          className="mt-6 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6"
        >
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
            SERVICE NOTE
          </p>

          <h3 className="mb-4 text-[22px] font-bold text-[#2B211C]">
            咨询代购说明
          </h3>

          <div className="grid gap-3.5 md:grid-cols-3">
            <div className="rounded-[20px] border border-[#E5D7C5] bg-white p-4">
              <p className="mb-2 text-[12px] font-semibold text-[#9A6530]">
                01
              </p>
              <h4 className="mb-1.5 text-[16px] font-bold text-[#2B211C]">
                人工确认库存
              </h4>
              <p className="text-[13px] leading-6 text-[#75695F]">
                页面展示的是采集时信息，下单前需要人工重新确认是否仍有库存。
              </p>
            </div>

            <div className="rounded-[20px] border border-[#E5D7C5] bg-white p-4">
              <p className="mb-2 text-[12px] font-semibold text-[#9A6530]">
                02
              </p>
              <h4 className="mb-1.5 text-[16px] font-bold text-[#2B211C]">
                确认最终成本
              </h4>
              <p className="text-[13px] leading-6 text-[#75695F]">
                最终价格会结合原站价格、国际运费、预计税费与服务费综合确认。
              </p>
            </div>

            <div className="rounded-[20px] border border-[#E5D7C5] bg-white p-4">
              <p className="mb-2 text-[12px] font-semibold text-[#9A6530]">
                03
              </p>
              <h4 className="mb-1.5 text-[16px] font-bold text-[#2B211C]">
                适合找斗参考
              </h4>
              <p className="text-[13px] leading-6 text-[#75695F]">
                已售商品也可以作为品牌、斗型、价格区间参考，用于寻找相近库存。
              </p>
            </div>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
