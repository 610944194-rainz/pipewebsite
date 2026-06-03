import Link from "next/link";
import SiteFooter from "./components/SiteFooter";
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
    <article className="flex min-w-full snap-center flex-col overflow-hidden rounded-[1.8rem] border border-[#4a2f20] bg-[#21150f]">
      <div className="flex aspect-[4/3] items-center justify-center bg-white p-3">
        <img
          src={pipe.imageUrl}
          alt={pipe.name}
          className="h-auto max-h-[94%] w-auto max-w-[98%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex min-h-8 flex-wrap gap-2">
          <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d1934a]">
            今日精选 {index + 1}/{total}
          </span>

          <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d8b58a]">
            {pipe.source}
          </span>

          {galleryCount > 1 && (
            <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d1934a]">
              {galleryCount} 图
            </span>
          )}
        </div>

        <div className="min-h-24">
          <p className="mb-1 text-sm text-[#d1934a]">{pipe.brand}</p>

          <h2 className="text-2xl font-black leading-snug text-[#fff8ec]">
            {pipe.name}
          </h2>
        </div>

        <div className="border-t border-[#342116] pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#b99b7d]">人民币参考</span>
            <span className="font-black text-[#f6c177]">
              {pipe.estimatedCny}
            </span>
          </div>
        </div>

        <Link
          href={`/products/${pipe.id}`}
          className="mt-auto flex min-h-12 items-center justify-center rounded-full bg-[#d1934a] px-5 text-sm font-black text-[#120b08] transition hover:bg-[#e3a85c]"
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
      <div className="flex aspect-[4/3] items-center justify-center rounded-[1.8rem] border border-[#4a2f20] bg-[#21150f] text-[#c9904c]">
        暂无商品数据
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-sm font-bold text-[#d1934a]">今日精选</p>
        <p className="text-xs text-[#b99b7d]">左右滑动查看更多</p>
      </div>

      <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((pipe, index) => (
          <FeaturedSlideCard
            key={`${pipe.id}-${pipe.sourceUrl}-featured-slide`}
            pipe={pipe}
            index={index}
            total={products.length}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-center gap-2">
        {products.map((pipe, index) => (
          <span
            key={`${pipe.id}-dot-${index}`}
            className="h-1.5 w-6 rounded-full bg-[#4a2f20]"
          />
        ))}
      </div>
    </div>
  );
}

function ProductMiniCard({ pipe }: { pipe: PipeProduct }) {
  const galleryCount = getGalleryCount(pipe);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-[#4a2f20] bg-[#21150f]">
      <div className="flex aspect-[4/3] items-center justify-center bg-white p-3">
        <img
          src={pipe.imageUrl}
          alt={pipe.name}
          className="h-auto max-h-[94%] w-auto max-w-[98%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-h-20">
          <p className="mb-1 text-xs font-bold text-[#d1934a]">
            {pipe.brand}
          </p>

          <h3 className="text-base font-black leading-snug text-[#fff8ec]">
            {pipe.name}
          </h3>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-[#b99b7d]">参考价</span>
          <span className="font-bold text-[#f6c177]">
            {pipe.estimatedCny}
          </span>
        </div>

        <div className="flex min-h-16 flex-wrap content-start gap-2">
          <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d8b58a]">
            {pipe.status}
          </span>

          {galleryCount > 1 && (
            <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs text-[#d1934a]">
              {galleryCount} 图
            </span>
          )}
        </div>

        <Link
          href={`/products/${pipe.id}`}
          className="mt-auto flex min-h-11 items-center justify-center rounded-full bg-[#d1934a] px-4 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
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
    <div className="rounded-[1.4rem] border border-[#4a2f20] bg-[#21150f] p-5">
      <p className="mb-3 text-sm font-black text-[#d1934a]">{index}</p>
      <h3 className="mb-2 text-lg font-black text-[#fff8ec]">{title}</h3>
      <p className="text-sm leading-7 text-[#d8b58a]">{desc}</p>
    </div>
  );
}

export default function HomePage() {
  const featuredProducts = getFeaturedProducts();
  const totalCount = pipeProducts.length;
  const availableCount = pipeProducts.filter((pipe) => !isSoldProduct(pipe)).length;
  const multiImageCount = pipeProducts.filter((pipe) => getGalleryCount(pipe) >= 3).length;

  return (
    <main className="min-h-screen bg-[#100a07] pb-24 text-[#fff8ec] sm:pb-0">
      <section className="px-4 pt-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-6 flex items-center justify-between">
            <Link href="/" className="group">
              <div className="text-lg font-black tracking-tight text-[#fff8ec]">
                Pipe Stock
              </div>
              <div className="text-xs tracking-[0.28em] text-[#c9904c]">
                OVERSEAS SELECT
              </div>
            </Link>

            <Link
              href="/products"
              className="rounded-full border border-[#6b422b] px-4 py-2 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
            >
              商品库
            </Link>
          </header>

          <section className="rounded-[2rem] border border-[#4a2f20] bg-[#1a100b] p-5 sm:p-8 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:p-10">
            <div className="flex flex-col justify-center">
              <p className="mb-4 text-xs uppercase tracking-[0.45em] text-[#c9904c]">
                DANISH PIPE SHOP STOCK
              </p>

              <h1 className="text-4xl font-black leading-tight tracking-tight text-[#fff8ec] sm:text-6xl">
                海外烟斗库存，
                <br />
                先看清楚再决定。
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-8 text-[#d8b58a] sm:text-lg">
                这里整理 The Danish Pipe Shop 公开库存信息，聚合价格、图片、参数与库存状态。适合先筛选、再人工确认库存和最终成本。
              </p>

              <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
                <Link
                  href="/products"
                  className="flex min-h-13 items-center justify-center rounded-full bg-[#d1934a] px-7 text-base font-black text-[#120b08] transition hover:bg-[#e3a85c]"
                >
                  查看海外库存
                </Link>

                <Link
                  href="/service"
                  className="flex min-h-13 items-center justify-center rounded-full border border-[#6b422b] px-7 text-base font-black text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
                >
                  了解代购流程
                </Link>
              </div>

              <div className="mt-7 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-[#100a07] p-4">
                  <p className="text-xs text-[#b99b7d]">商品数</p>
                  <p className="mt-1 text-2xl font-black">{totalCount}</p>
                </div>

                <div className="rounded-2xl bg-[#100a07] p-4">
                  <p className="text-xs text-[#b99b7d]">可关注</p>
                  <p className="mt-1 text-2xl font-black">{availableCount}</p>
                </div>

                <div className="rounded-2xl bg-[#100a07] p-4">
                  <p className="text-xs text-[#b99b7d]">多图</p>
                  <p className="mt-1 text-2xl font-black">{multiImageCount}</p>
                </div>
              </div>
            </div>

            <div className="mt-8 lg:mt-0">
              <FeaturedCarousel products={featuredProducts} />
            </div>
          </section>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
                FEATURED
              </p>
              <h2 className="text-2xl font-black sm:text-3xl">
                近期值得关注
              </h2>
            </div>

            <Link
              href="/products"
              className="hidden text-sm font-bold text-[#d1934a] hover:text-[#f6c177] sm:block"
            >
              查看全部 →
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featuredProducts.map((pipe) => (
              <ProductMiniCard key={`${pipe.id}-${pipe.sourceUrl}`} pipe={pipe} />
            ))}
          </div>

          <Link
            href="/products"
            className="mt-5 flex min-h-12 items-center justify-center rounded-full border border-[#6b422b] px-5 text-sm font-black text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a] sm:hidden"
          >
            查看全部库存
          </Link>
        </div>
      </section>

      <section className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-[#4a2f20] bg-[#1a100b] p-5 sm:p-8">
          <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
            HOW IT WORKS
          </p>

          <h2 className="mb-5 text-2xl font-black sm:text-3xl">
            不是简单转链接，而是先帮你把信息看明白。
          </h2>

          <div className="grid gap-4 md:grid-cols-3">
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

      <section className="px-4 pb-10 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-6 text-center sm:p-10">
          <p className="mb-3 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
            START
          </p>

          <h2 className="text-2xl font-black leading-tight sm:text-4xl">
            先从库存库里挑几只，
            <br className="sm:hidden" />
            再慢慢比较。
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#d8b58a] sm:text-base">
            你可以按品牌、价格、图片完整度、库存状态筛选，也可以把已售商品当作斗型和预算参考。
          </p>

          <div className="mt-7 grid gap-3 sm:flex sm:justify-center">
            <Link
              href="/products"
              className="flex min-h-12 items-center justify-center rounded-full bg-[#d1934a] px-7 text-sm font-black text-[#120b08] transition hover:bg-[#e3a85c]"
            >
              进入商品库
            </Link>

            <Link
              href="/service"
              className="flex min-h-12 items-center justify-center rounded-full border border-[#6b422b] px-7 text-sm font-black text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
            >
              查看服务说明
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#4a2f20] bg-[#100a07]/95 px-4 py-3 backdrop-blur sm:hidden">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/products"
            className="flex min-h-11 items-center justify-center rounded-full bg-[#d1934a] text-sm font-black text-[#120b08]"
          >
            查看库存
          </Link>

          <Link
            href="/service"
            className="flex min-h-11 items-center justify-center rounded-full border border-[#6b422b] text-sm font-black text-[#fff8ec]"
          >
            代购流程
          </Link>
        </div>
      </div>
    </main>
  );
}
