import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
import {
  domesticMakers,
  getDomesticMakerBySlug,
  getDomesticMakerTypeLabel,
  type DomesticMaker,
} from "../../../data/domestic-makers";
import {
  formatDomesticPrice,
  getDomesticProductsByMakerSlug,
  type DomesticProduct,
} from "../../../data/domestic-products";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const paperTextureStyle = {
  backgroundColor: "#FBF7EF",
  backgroundImage:
    "linear-gradient(135deg, rgba(154, 101, 48, 0.08) 0 1px, transparent 1px), linear-gradient(45deg, rgba(44, 33, 28, 0.04) 0 1px, transparent 1px)",
  backgroundSize: "22px 22px, 30px 30px",
};

export function generateStaticParams() {
  return domesticMakers.map((maker) => ({
    slug: maker.slug,
  }));
}

function MakerPortrait({ maker }: { maker: DomesticMaker }) {
  return (
    <div
      className="rounded-[24px] border border-[#E5D7C5] p-5"
      style={paperTextureStyle}
    >
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8]">
        <div className="absolute inset-5 rounded-[20px] border border-[#E8DDCF]" />
        <div className="absolute left-7 top-7 h-px w-24 bg-[#D8C5AE]" />
        <div className="absolute bottom-7 right-7 h-px w-20 bg-[#E5D7C5]" />
        <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#D8C5AE] bg-white text-center text-[24px] font-black leading-tight text-[#9A6530]">
          {maker.displayName.slice(0, 2)}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[16px] border border-[#E5D7C5] bg-white p-3">
          <p className="text-[11px] text-[#75695F]">类型</p>
          <p className="mt-1 text-[15px] font-bold text-[#2B211C]">
            {getDomesticMakerTypeLabel(maker.type)}
          </p>
        </div>
        <div className="rounded-[16px] border border-[#E5D7C5] bg-white p-3">
          <p className="text-[11px] text-[#75695F]">城市</p>
          <p className="mt-1 text-[15px] font-bold text-[#2B211C]">
            {maker.city}
          </p>
        </div>
      </div>
    </div>
  );
}

function SampleProductVisual({ product }: { product: DomesticProduct }) {
  return (
    <div
      className="relative flex min-h-[132px] items-center justify-center overflow-hidden p-4 sm:aspect-[4/3] sm:min-h-0"
      style={paperTextureStyle}
    >
      <div className="absolute inset-4 rounded-[18px] border border-[#E8DDCF]" />
      <div className="absolute left-6 top-6 h-px w-20 bg-[#D8C5AE]" />
      <div className="absolute bottom-6 right-6 h-px w-16 bg-[#E5D7C5]" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[#D8C5AE] bg-[#FFFDF8] text-center text-[18px] font-black text-[#9A6530]">
        {product.makerName.slice(0, 2)}
      </div>
      {product.isSample && (
        <span className="absolute left-3 top-3 rounded-full border border-[#D8C5AE] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#9A6530]">
          展示样例
        </span>
      )}
    </div>
  );
}

function DomesticProductCard({ product }: { product: DomesticProduct }) {
  return (
    <article className="grid grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:flex sm:h-full sm:flex-col">
      <SampleProductVisual product={product} />

      <div className="flex min-w-0 flex-1 flex-col gap-2 border-l border-[#F0E6D8] p-3.5 sm:border-l-0 sm:border-t">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-semibold text-[#9A6530]">
            {product.status}
          </span>
          <span className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-semibold text-[#75695F]">
            {formatDomesticPrice(product)}
          </span>
        </div>

        <div>
          <h3 className="text-[15px] font-bold leading-snug text-[#2B211C]">
            {product.name}
          </h3>
          <p className="mt-1 text-[12px] leading-5 text-[#75695F]">
            {product.material} / {product.shape}
          </p>
        </div>

        <Link
          href={`/domestic-products/${product.id}`}
          className="mt-auto flex h-9 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[12px] font-semibold text-white transition hover:bg-[#8F5522]"
        >
          查看详情
        </Link>
      </div>
    </article>
  );
}

export default async function DomesticMakerDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const maker = getDomesticMakerBySlug(slug);

  if (!maker) {
    notFound();
  }

  const products = getDomesticProductsByMakerSlug(maker.slug).sort(
    (left, right) => {
      const leftIndex = maker.featuredProductIds.indexOf(left.id);
      const rightIndex = maker.featuredProductIds.indexOf(right.id);
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
  );

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <Link
            href="/domestic-makers"
            className="mb-4 inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
          >
            返回国内斗师 / 工作室
          </Link>

          <header className="grid gap-5 rounded-[28px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-7 lg:grid-cols-[0.38fr_0.62fr]">
            <MakerPortrait maker={maker} />

            <div className="flex flex-col justify-center">
              <div className="mb-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[#F6F1E8] px-2.5 py-1 text-[12px] font-semibold text-[#9A6530]">
                  {maker.status}
                </span>
                <span className="rounded-full bg-[#F6F1E8] px-2.5 py-1 text-[12px] font-semibold text-[#75695F]">
                  {maker.city}
                </span>
              </div>

              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
                MAKER PROFILE
              </p>
              <h1 className="text-[32px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
                {maker.displayName}
              </h1>
              <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
                {maker.intro}
              </p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {maker.styleTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[#E5D7C5] bg-white px-2.5 py-1 text-[12px] font-medium text-[#75695F]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <section className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <article className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                ABOUT
              </p>
              <h2 className="text-[22px] font-bold text-[#2B211C]">
                介绍与合作说明
              </h2>
              <p className="mt-3 text-[14px] leading-7 text-[#75695F]">
                {maker.longIntro}
              </p>
              <p className="mt-4 rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4 text-[13px] leading-6 text-[#75695F]">
                {maker.contactNote}
              </p>
            </article>

            <article className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                SPECIALTIES
              </p>
              <h2 className="text-[22px] font-bold text-[#2B211C]">
                擅长斗型与工艺方向
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {maker.specialties.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-[#E5D7C5] bg-[#FAF7F0] px-3 py-1.5 text-[13px] font-semibold text-[#2B211C]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </article>
          </section>

          <section className="mt-7">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                  WORKS
                </p>
                <h2 className="text-[22px] font-bold text-[#2B211C] sm:text-3xl">
                  作品列表
                  <span className="ml-2 text-[15px] font-bold text-[#9A6530]">
                    {products.length} 件
                  </span>
                </h2>
              </div>
            </div>

            {products.length > 0 ? (
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((product) => (
                  <DomesticProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-8 text-center text-[13px] leading-6 text-[#75695F] shadow-[0_5px_18px_rgba(43,33,28,0.03)]">
                该斗师 / 工作室资料正在整理中，欢迎通过合作入驻补充作品信息。
              </div>
            )}
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
