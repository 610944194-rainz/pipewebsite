import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
import {
  getBrandBySlug,
  pipeBrands,
  type PipeBrand,
} from "../../../data/brands";
import { pipeProducts } from "../../../data/pipes";
import type { PipeProduct } from "../../../data/pipes";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

function normalizeBrandName(value: string) {
  return value.trim().toLowerCase();
}

function getBrandProducts(brand: PipeBrand) {
  const names = [brand.name, ...brand.aliases].map(normalizeBrandName);

  return pipeProducts.filter((product: PipeProduct) =>
    names.includes(normalizeBrandName(product.brand))
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[#342116] py-3 last:border-b-0 sm:block sm:border-b-0 sm:border-r sm:px-4 sm:py-0 sm:last:border-r-0">
      <p className="text-xs font-bold text-[#b99b7d]">{label}</p>
      <p className="text-sm font-black text-[#fff8ec] sm:mt-1 sm:text-base">
        {value}
      </p>
    </div>
  );
}

function TextList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-[#160d09] px-3 py-2 text-xs font-bold leading-5 text-[#fff8ec] sm:text-sm"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function StockCard({ product }: { product: PipeProduct }) {
  return (
    <article className="grid grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-[1.2rem] border border-[#4a2f20] bg-[#21150f] sm:flex sm:h-full sm:flex-col">
      <div className="flex min-h-28 items-center justify-center bg-white p-2 sm:aspect-[4/3] sm:min-h-0 sm:p-3">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-auto max-h-[94%] w-auto max-w-[98%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <h3 className="text-sm font-black leading-snug text-[#fff8ec] sm:text-base">
          {product.name}
        </h3>

        <div className="space-y-2 border-t border-[#342116] pt-3 text-xs sm:text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#b99b7d]">人民币参考价</span>
            <span className="font-bold text-[#f6c177]">
              {product.estimatedCny}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[#b99b7d]">库存状态</span>
            <span className="font-bold">{product.status}</span>
          </div>
        </div>

        <Link
          href={`/products/${product.id}`}
          className="mt-auto flex min-h-10 items-center justify-center rounded-full bg-[#d1934a] px-4 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
        >
          查看商品
        </Link>
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return pipeBrands.map((brand) => ({
    slug: brand.slug,
  }));
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const brand = getBrandBySlug(slug);

  if (!brand) {
    notFound();
  }

  const relatedProducts = getBrandProducts(brand);

  return (
    <main className="min-h-screen bg-[#100a07] text-[#fff8ec]">
      <SiteHeader />

      <section className="px-4 py-7 sm:px-6 sm:py-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-6 border-b border-[#3a2419] pb-6">
            <Link
              href="/brands"
              className="mb-5 inline-flex min-h-10 items-center justify-center rounded-full border border-[#6b422b] px-4 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
            >
              返回品牌库
            </Link>

            <p className="mb-3 text-xs uppercase tracking-[0.45em] text-[#c9904c]">
              BRAND PROFILE
            </p>

            <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
              {brand.name}
            </h1>

            <p className="mt-4 max-w-3xl text-base leading-8 text-[#d8b58a] sm:text-lg">
              {brand.summary}
            </p>
          </header>

          <section className="rounded-[1.4rem] border border-[#4a2f20] bg-[#21150f] p-4 sm:p-5">
            <div className="sm:flex">
              <InfoBox label="国家 / 地区" value={brand.country} />
              <InfoBox label="创立时间" value={brand.founded} />
              <InfoBox label="定位" value={brand.level} />
            </div>

            <div className="mt-4 rounded-[1rem] border border-[#4a2f20] bg-[#160d09] p-4">
              <p className="mb-2 text-sm font-black text-[#d1934a]">
                品牌资料待完善
              </p>
              <p className="text-sm leading-7 text-[#d8b58a]">
                {brand.story}
              </p>
            </div>
          </section>

          <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-[1.4rem] border border-[#4a2f20] bg-[#21150f] p-4 sm:p-5">
              <h2 className="mb-3 text-xl font-black">品牌特点</h2>
              <TextList items={brand.features} />
            </div>

            <div className="rounded-[1.4rem] border border-[#4a2f20] bg-[#21150f] p-4 sm:p-5">
              <h2 className="mb-3 text-xl font-black">代表风格</h2>
              <TextList items={brand.representativeStyles} />
            </div>
          </section>

          <section className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[1.4rem] border border-[#4a2f20] bg-[#21150f] p-4 sm:p-5">
              <h2 className="mb-3 text-xl font-black">适合人群与价格</h2>
              <p className="text-sm leading-7 text-[#d8b58a]">
                {brand.suitableFor}
              </p>

              <div className="mt-4 border-t border-[#342116] pt-4">
                <p className="mb-2 text-sm text-[#b99b7d]">价格区间</p>
                <p className="font-black text-[#f6c177]">
                  {brand.priceRange}
                </p>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-[#4a2f20] bg-[#21150f] p-4 sm:p-5">
              <h2 className="mb-3 text-xl font-black">资料来源</h2>
              {brand.sourceUrls.length > 0 ? (
                <div className="grid gap-3">
                  {brand.sourceUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all rounded-2xl bg-[#160d09] px-4 py-3 text-sm font-bold leading-6 text-[#d1934a] transition hover:text-[#f6c177]"
                    >
                      {url}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-7 text-[#d8b58a]">
                  资料来源待补充
                </p>
              )}
            </div>
          </section>

          <section className="mt-7">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
                  RELATED STOCK
                </p>
                <h2 className="text-2xl font-black sm:text-3xl">
                  当前相关库存
                  <span className="ml-2 text-base text-[#f6c177]">
                    {relatedProducts.length} 件
                  </span>
                </h2>
              </div>
            </div>

            {relatedProducts.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {relatedProducts.map((product) => (
                  <StockCard
                    key={`${product.id}-${product.sourceUrl}`}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-[#4a2f20] bg-[#21150f] p-8 text-center text-sm leading-7 text-[#d8b58a]">
                当前暂无关联库存。
              </div>
            )}
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
