import Link from "next/link";
import SiteFooter from "./components/SiteFooter";
import SiteHeader from "./components/SiteHeader";
import { pipeProducts } from "../data/pipes";
import type { PipeProduct } from "../data/pipes";

function isSoldProduct(pipe: PipeProduct) {
  return (
    pipe.status.includes("已售") ||
    pipe.tags?.some((tag) => tag.includes("已售")) ||
    false
  );
}

function getGalleryCount(pipe: PipeProduct) {
  return pipe.galleryImages?.length || 0;
}

function getFeaturedProducts() {
  return [...pipeProducts]
    .sort((a, b) => {
      const aSold = isSoldProduct(a) ? 1 : 0;
      const bSold = isSoldProduct(b) ? 1 : 0;

      if (aSold !== bSold) {
        return aSold - bSold;
      }

      const galleryDiff = getGalleryCount(b) - getGalleryCount(a);

      if (galleryDiff !== 0) {
        return galleryDiff;
      }

      return a.estimatedCnyValue - b.estimatedCnyValue;
    })
    .slice(0, 4);
}

function FeaturedSlideCard({
  pipe,
  index,
  total,
}: {
  pipe: PipeProduct;
  index: number;
  total: number;
}) {
  const galleryCount = getGalleryCount(pipe);

  return (
    <article className="flex min-w-full snap-center flex-col overflow-hidden rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] shadow-[0_5px_18px_rgba(43,33,28,0.03)]">
      <div className="flex aspect-[16/10] items-center justify-center bg-white p-3">
        <img
          src={pipe.imageUrl}
          alt={pipe.name}
          className="h-auto max-h-[92%] w-auto max-w-[96%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 border-t border-[#F0E6D8] p-4">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#9A6530]">
            今日精选 {index + 1}/{total}
          </span>

          <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#75695F]">
            {pipe.source}
          </span>

          {galleryCount > 1 && (
            <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#9A6530]">
              {galleryCount} 图
            </span>
          )}
        </div>

        <div>
          <p className="mb-0.5 text-[12px] font-medium text-[#9A6530]">
            {pipe.brand}
          </p>

          <h2 className="text-[20px] font-bold leading-snug tracking-tight text-[#2B211C]">
            {pipe.name}
          </h2>
        </div>

        <div className="mt-auto border-t border-[#F0E6D8] pt-2.5">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-[#75695F]">人民币参考</span>
            <span className="font-bold text-[#9A6530]">
              {pipe.estimatedCny}
            </span>
          </div>
        </div>

        <Link
          href={`/products/${pipe.id}`}
          className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-5 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
        >
          查看这只斗
        </Link>
      </div>
    </article>
  );
}

function FeaturedCarousel({ products }: { products: PipeProduct[] }) {
  if (products.length === 0) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-[20px] border border-[#E5D7C5] bg-white text-[#9A6530]">
        暂无商品数据
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <p className="text-[13px] font-semibold text-[#9A6530]">今日精选</p>
        <p className="text-[11px] text-[#75695F]">左右滑动查看更多</p>
      </div>

      <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((pipe, index) => (
          <FeaturedSlideCard
            key={`${pipe.id}-${pipe.sourceUrl}-featured-slide`}
            pipe={pipe}
            index={index}
            total={products.length}
          />
        ))}
      </div>

      <div className="mt-0.5 flex justify-center gap-2">
        {products.map((pipe, index) => (
          <span
            key={`${pipe.id}-dot-${index}`}
            className="h-1.5 w-5 rounded-full bg-[#E5D7C5]"
          />
        ))}
      </div>
    </div>
  );
}

function ProductMiniCard({ pipe }: { pipe: PipeProduct }) {
  const galleryCount = getGalleryCount(pipe);

  return (
    <article className="grid grid-cols-[104px_1fr] overflow-hidden rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:flex sm:h-full sm:flex-col">
      <div className="flex min-h-[122px] items-center justify-center bg-white p-2.5 sm:aspect-[4/3] sm:min-h-0">
        <img
          src={pipe.imageUrl}
          alt={pipe.name}
          className="h-auto max-h-[92%] w-auto max-w-[96%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-l border-[#F0E6D8] p-3.5 sm:border-l-0 sm:border-t">
        <div>
          <p className="mb-0.5 text-[11px] font-semibold text-[#9A6530]">
            {pipe.brand}
          </p>

          <h3 className="text-[14px] font-bold leading-snug text-[#2B211C]">
            {pipe.name}
          </h3>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-3 text-[12px]">
          <span className="text-[#75695F]">参考价</span>
          <span className="font-bold text-[#9A6530]">
            {pipe.estimatedCny}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <span className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-medium text-[#75695F]">
            {pipe.status}
          </span>

          {galleryCount > 1 && (
            <span className="rounded-full bg-[#F6F1E8] px-2 py-0.5 text-[11px] font-medium text-[#9A6530]">
              {galleryCount} 图
            </span>
          )}
        </div>

        <Link
          href={`/products/${pipe.id}`}
          className="mt-auto inline-flex h-9 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[12px] font-semibold text-white transition hover:bg-[#8F5522]"
        >
          查看详情
        </Link>
      </div>
    </article>
  );
}

function StepCard({
  index,
  title,
  desc,
}: {
  index: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)]">
      <p className="mb-2 text-[12px] font-semibold text-[#9A6530]">{index}</p>
      <h3 className="mb-1.5 text-[17px] font-bold text-[#2B211C]">{title}</h3>
      <p className="text-[13px] leading-6 text-[#75695F]">{desc}</p>
    </div>
  );
}

export default function HomePage() {
  const featuredProducts = getFeaturedProducts();
  const totalCount = pipeProducts.length;
  const availableCount = pipeProducts.filter((pipe) => !isSoldProduct(pipe)).length;
  const multiImageCount = pipeProducts.filter((pipe) => getGalleryCount(pipe) >= 3).length;

  return (
    <main className="min-h-screen bg-[#FAF7F0] pb-24 text-[#2B211C] sm:pb-0">
      <SiteHeader />

      <section className="px-4 pt-4 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-8 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:p-10">
            <div className="flex flex-col justify-center">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
                DANISH PIPE SHOP STOCK
              </p>

              <h1 className="text-[30px] font-bold leading-[1.15] tracking-tight text-[#2B211C] sm:text-5xl">
                海外烟斗库存，
                <br />
                先看清楚再决定。
              </h1>

              <p className="mt-4 max-w-2xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
                这里整理 The Danish Pipe Shop 公开库存信息，聚合价格、图片、参数与库存状态。适合先筛选、再人工确认库存和最终成本。
              </p>

              <div className="mt-5 grid gap-2.5 sm:flex sm:flex-wrap">
                <Link
                  href="/products"
                  className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-7 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
                >
                  查看海外库存
                </Link>

                <Link
                  href="/service"
                  className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                >
                  了解代购流程
                </Link>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2.5">
                <div className="rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] p-3">
                  <p className="text-[11px] text-[#75695F]">商品数</p>
                  <p className="mt-1 text-[23px] font-bold leading-none text-[#2B211C]">
                    {totalCount}
                  </p>
                </div>

                <div className="rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] p-3">
                  <p className="text-[11px] text-[#75695F]">可关注</p>
                  <p className="mt-1 text-[23px] font-bold leading-none text-[#2B211C]">
                    {availableCount}
                  </p>
                </div>

                <div className="rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] p-3">
                  <p className="text-[11px] text-[#75695F]">多图</p>
                  <p className="mt-1 text-[23px] font-bold leading-none text-[#2B211C]">
                    {multiImageCount}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 lg:mt-0">
              <FeaturedCarousel products={featuredProducts} />
            </div>
          </section>
        </div>
      </section>

      <section className="px-4 py-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                FEATURED
              </p>
              <h2 className="text-[22px] font-bold text-[#2B211C] sm:text-3xl">
                近期值得关注
              </h2>
            </div>

            <Link
              href="/products"
              className="hidden text-sm font-semibold text-[#9A6530] hover:text-[#A9682B] sm:block"
            >
              查看全部 →
            </Link>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {featuredProducts.map((pipe) => (
              <ProductMiniCard key={`${pipe.id}-${pipe.sourceUrl}`} pipe={pipe} />
            ))}
          </div>

          <Link
            href="/products"
            className="mt-4 flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-5 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B] sm:hidden"
          >
            查看全部库存
          </Link>
        </div>
      </section>

      <section className="px-4 pb-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-8">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
            HOW IT WORKS
          </p>

          <h2 className="mb-4 text-[22px] font-bold leading-snug text-[#2B211C] sm:text-3xl">
            不是简单转链接，而是先帮你把信息看明白。
          </h2>

          <div className="grid gap-3.5 md:grid-cols-3">
            <StepCard
              index="01"
              title="先看公开库存"
              desc="整理原站商品、价格、状态、图片和参数，减少你在海外网站里反复翻找的成本。"
            />

            <StepCard
              index="02"
              title="再做人工确认"
              desc="页面只是采集时信息，下单前还需要重新确认库存、价格、运费和税费。"
            />

            <StepCard
              index="03"
              title="最后决定是否购买"
              desc="适合先收藏、对比和咨询，不急着冲动下单。已售商品也可作为找同类款参考。"
            />
          </div>
        </div>
      </section>

      <section className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[24px] border border-[#E5D7C5] bg-white p-5 text-center shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-10">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
            START
          </p>

          <h2 className="text-[22px] font-bold leading-tight text-[#2B211C] sm:text-4xl">
            先从库存库里挑几只，
            <br className="sm:hidden" />
            再慢慢比较。
          </h2>

          <p className="mx-auto mt-3 max-w-2xl text-[13px] leading-6 text-[#75695F] sm:text-base">
            你可以按品牌、价格、图片完整度、库存状态筛选，也可以把已售商品当作斗型和预算参考。
          </p>

          <p className="mx-auto mt-2 max-w-2xl text-[13px] leading-6 text-[#75695F]">
            合作入驻：斗商、斗师与工作室展示入口。
          </p>

          <div className="mt-5 grid gap-2.5 sm:flex sm:justify-center">
            <Link
              href="/products"
              className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-7 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
            >
              进入商品库
            </Link>

            <Link
              href="/service"
              className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              查看服务说明
            </Link>

            <Link
              href="/cooperate"
              className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              合作入驻
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5D7C5] bg-[#FAF7F0]/95 px-4 py-2.5 backdrop-blur sm:hidden">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/products"
            className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] text-[13px] font-semibold text-white"
          >
            查看库存
          </Link>

          <Link
            href="/service"
            className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white text-[13px] font-semibold text-[#2B211C]"
          >
            代购流程
          </Link>
        </div>
      </div>
    </main>
  );
}
