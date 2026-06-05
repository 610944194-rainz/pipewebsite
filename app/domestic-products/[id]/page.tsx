import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
import {
  domesticProducts,
  formatDomesticPrice,
  getDomesticProductById,
  getDomesticProductMaker,
  type DomesticProduct,
} from "../../../data/domestic-products";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

const paperTextureStyle = {
  backgroundColor: "#FBF7EF",
  backgroundImage:
    "linear-gradient(135deg, rgba(154, 101, 48, 0.08) 0 1px, transparent 1px), linear-gradient(45deg, rgba(44, 33, 28, 0.04) 0 1px, transparent 1px)",
  backgroundSize: "22px 22px, 30px 30px",
};

export function generateStaticParams() {
  return domesticProducts.map((product) => ({
    id: product.id,
  }));
}

function ProductPlaceholder({ product }: { product: DomesticProduct }) {
  return (
    <div
      className="relative flex aspect-[4/3] min-h-[260px] items-center justify-center overflow-hidden rounded-[24px] border border-[#E5D7C5] p-6"
      style={paperTextureStyle}
    >
      <div className="absolute inset-5 rounded-[22px] border border-[#E8DDCF]" />
      <div className="absolute left-8 top-8 h-px w-28 bg-[#D8C5AE]" />
      <div className="absolute bottom-8 right-8 h-px w-24 bg-[#E5D7C5]" />
      <div className="relative grid place-items-center gap-3 text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border border-[#D8C5AE] bg-[#FFFDF8] text-[24px] font-black text-[#9A6530]">
          {product.makerName.slice(0, 2)}
        </div>
        <p className="text-[13px] font-semibold text-[#75695F]">
          作品图片待合作方补充
        </p>
      </div>

      {product.isSample && (
        <span className="absolute left-4 top-4 rounded-full border border-[#D8C5AE] bg-white px-3 py-1 text-[12px] font-semibold text-[#9A6530]">
          展示样例
        </span>
      )}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#F0E6D8] py-3 last:border-b-0">
      <span className="text-[13px] text-[#75695F]">{label}</span>
      <span className="text-right text-[14px] font-bold text-[#2B211C]">
        {value}
      </span>
    </div>
  );
}

export default async function DomesticProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const product = getDomesticProductById(id);

  if (!product) {
    notFound();
  }

  const maker = getDomesticProductMaker(product);
  const galleryImages = product.galleryImages.filter(Boolean);

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap gap-2">
            <Link
              href={maker ? `/domestic-makers/${maker.slug}` : "/domestic-makers"}
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              返回斗师 / 工作室主页
            </Link>
            <Link
              href="/domestic-makers"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              查看国内目录
            </Link>
          </div>

          <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[28px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-5">
              {product.imageUrl ? (
                <div className="relative flex aspect-[4/3] min-h-[260px] items-center justify-center rounded-[24px] border border-[#E5D7C5] bg-white p-4">
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-auto max-h-[92%] w-auto max-w-[96%] object-contain"
                    draggable={false}
                  />
                  {product.isSample && (
                    <span className="absolute left-4 top-4 rounded-full border border-[#D8C5AE] bg-white px-3 py-1 text-[12px] font-semibold text-[#9A6530]">
                      展示样例
                    </span>
                  )}
                </div>
              ) : (
                <ProductPlaceholder product={product} />
              )}

              {galleryImages.length > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {galleryImages.map((image) => (
                    <div
                      key={image}
                      className="flex aspect-square items-center justify-center rounded-[16px] border border-[#E5D7C5] bg-white p-2"
                    >
                      <img
                        src={image}
                        alt={product.name}
                        className="h-auto max-h-[92%] w-auto max-w-[96%] object-contain"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <article className="rounded-[28px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-7">
              <div className="mb-4 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[#F6F1E8] px-2.5 py-1 text-[12px] font-semibold text-[#9A6530]">
                  {product.status}
                </span>
                <span className="rounded-full bg-[#F6F1E8] px-2.5 py-1 text-[12px] font-semibold text-[#75695F]">
                  {formatDomesticPrice(product)}
                </span>
              </div>

              <p className="mb-1 text-[13px] font-semibold text-[#9A6530]">
                {product.makerName}
              </p>
              <h1 className="text-[30px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
                {product.name}
              </h1>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4">
                  <p className="text-[12px] font-semibold text-[#75695F]">
                    价格方式
                  </p>
                  <p className="mt-1 text-[24px] font-bold leading-none text-[#9A6530]">
                    {formatDomesticPrice(product)}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4">
                  <p className="text-[12px] font-semibold text-[#75695F]">
                    确认说明
                  </p>
                  <p className="mt-1 text-[14px] font-bold leading-6 text-[#2B211C]">
                    最终价格与交付方式需人工确认
                  </p>
                </div>
              </div>

              <p className="mt-4 rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4 text-[13px] leading-6 text-[#75695F]">
                {product.contactNote}
              </p>

              <div className="mt-5 grid gap-2.5 sm:flex sm:flex-wrap">
                <Link
                  href="/request"
                  className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-6 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
                >
                  发起人工咨询
                </Link>
                {maker && (
                  <Link
                    href={`/domestic-makers/${maker.slug}`}
                    className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-6 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                  >
                    查看作者主页
                  </Link>
                )}
              </div>
            </article>
          </section>

          <section className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <article className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                SPECS
              </p>
              <h2 className="text-[22px] font-bold text-[#2B211C]">作品参数</h2>
              <div className="mt-4 rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] px-4">
                <SpecRow label="材质" value={product.material} />
                <SpecRow label="斗型" value={product.shape} />
                <SpecRow label="工艺" value={product.finish} />
                <SpecRow label="烟嘴材质" value={product.stemMaterial} />
                <SpecRow label="滤芯规格" value={product.filterSpec} />
              </div>

              {product.specsText.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {product.specsText.map((spec) => (
                    <span
                      key={spec}
                      className="rounded-full border border-[#E5D7C5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#75695F]"
                    >
                      {spec}
                    </span>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                NOTES
              </p>
              <h2 className="text-[22px] font-bold text-[#2B211C]">作品说明</h2>
              <p className="mt-3 text-[14px] leading-7 text-[#75695F]">
                {product.detail}
              </p>

              <div className="mt-5 rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4 text-[13px] leading-6 text-[#75695F]">
                国内斗师 / 工作室作品的库存、价格、交付周期、售后方式由合作方最终确认。PipeSearch 当前提供展示、资料整理与咨询线索承接，不接入在线支付，不自动成交。
              </div>
            </article>
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
