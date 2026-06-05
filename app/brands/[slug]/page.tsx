import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import SiteHeader from "../../components/SiteHeader";
import {
  createFallbackBrand,
  getBrandByName,
  getBrandMetaBySlug,
  getProductBrandGroups,
  type PipeBrand,
} from "../../../data/brands";
import { pipeProducts } from "../../../data/pipes";
import type { PipeProduct } from "../../../data/pipes";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

type BrandProfile = PipeBrand & {
  productCount: number;
  products: PipeProduct[];
};

function getBrandProfiles(): BrandProfile[] {
  return getProductBrandGroups(pipeProducts)
    .map((group) => {
      const brandMeta =
        getBrandMetaBySlug(group.slug) ?? getBrandByName(group.name);
      const fallbackBrand = createFallbackBrand(group.name, group.slug);

      return {
        ...fallbackBrand,
        ...(brandMeta ?? {}),
        name: group.name,
        slug: group.slug,
        productCount: group.products.length,
        products: group.products,
      };
    })
    .filter((brand) => brand.productCount > 0);
}

function getBrandProfileBySlug(slug: string) {
  return getBrandProfiles().find((brand) => brand.slug === slug);
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-[#F0E6D8] py-2.5 last:border-b-0 sm:block sm:border-b-0 sm:border-r sm:px-4 sm:py-0 sm:last:border-r-0">
      <p className="text-[11px] font-medium text-[#75695F]">{label}</p>
      <p className="text-[14px] font-bold text-[#2B211C] sm:mt-1 sm:text-[15px]">
        {value}
      </p>
    </div>
  );
}

function TextList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-[#F6F1E8] px-2.5 py-1 text-[12px] font-medium leading-5 text-[#75695F]"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function StockCard({ product }: { product: PipeProduct }) {
  return (
    <article className="grid grid-cols-[104px_minmax(0,1fr)] overflow-hidden rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:flex sm:h-full sm:flex-col">
      <div className="flex min-h-[122px] items-center justify-center bg-white p-2.5 sm:aspect-[4/3] sm:min-h-0 sm:p-3">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-auto max-h-[92%] w-auto max-w-[96%] object-contain"
          draggable={false}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 border-l border-[#F0E6D8] p-3.5 sm:border-l-0 sm:border-t">
        <h3 className="text-[14px] font-bold leading-snug text-[#2B211C] sm:text-[15px]">
          {product.name}
        </h3>

        <div className="space-y-1.5 border-t border-[#F0E6D8] pt-2 text-[12px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#75695F]">人民币参考价</span>
            <span className="font-bold text-[#9A6530]">
              {product.estimatedCny}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[#75695F]">库存状态</span>
            <span className="font-semibold text-[#2B211C]">
              {product.status}
            </span>
          </div>
        </div>

        <Link
          href={`/products/${product.id}`}
          className="mt-auto flex h-9 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[12px] font-semibold text-white transition hover:bg-[#8F5522]"
        >
          查看商品
        </Link>
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return getBrandProfiles().map((brand) => ({
    slug: brand.slug,
  }));
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const brand = getBrandProfileBySlug(slug);

  if (!brand) {
    notFound();
  }

  const relatedProducts = brand.products;

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
            <Link
              href="/brands"
              className="mb-4 inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              返回品牌库
            </Link>

            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
              BRAND PROFILE
            </p>

            <h1 className="text-[34px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-6xl">
              {brand.name}
            </h1>

            <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
              {brand.summary}
            </p>
          </header>

          <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
            <div className="rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-3 sm:flex sm:p-4">
              <InfoBox label="国家 / 地区" value={brand.country} />
              <InfoBox label="创立时间" value={brand.founded} />
              <InfoBox label="定位" value={brand.level} />
            </div>

            <div className="mt-4 rounded-[18px] border border-[#E5D7C5] bg-white p-4">
              <p className="mb-2 text-[13px] font-bold text-[#9A6530]">
                品牌资料待完善
              </p>
              <p className="text-[13px] leading-6 text-[#75695F]">
                {brand.story}
              </p>
            </div>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5">
              <h2 className="mb-3 text-[20px] font-bold text-[#2B211C]">
                品牌特点
              </h2>
              <TextList items={brand.features} />
            </div>

            <div className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5">
              <h2 className="mb-3 text-[20px] font-bold text-[#2B211C]">
                代表风格
              </h2>
              <TextList items={brand.representativeStyles} />
            </div>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5">
              <h2 className="mb-3 text-[20px] font-bold text-[#2B211C]">
                适合人群与价格
              </h2>
              <p className="text-[13px] leading-6 text-[#75695F]">
                {brand.suitableFor}
              </p>

              <div className="mt-4 border-t border-[#F0E6D8] pt-3">
                <p className="mb-1 text-[12px] text-[#75695F]">价格区间</p>
                <p className="text-[15px] font-bold text-[#9A6530]">
                  {brand.priceRange}
                </p>
              </div>
            </div>

            <div className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5">
              <h2 className="mb-3 text-[20px] font-bold text-[#2B211C]">
                资料来源
              </h2>

              {brand.sourceUrls.length > 0 ? (
                <div className="grid gap-2.5">
                  {brand.sourceUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all rounded-[16px] border border-[#E5D7C5] bg-white px-3 py-2.5 text-[12px] font-medium leading-5 text-[#9A6530] transition hover:border-[#A9682B] hover:text-[#A9682B]"
                    >
                      {url}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] leading-6 text-[#75695F]">
                  资料来源待补充
                </p>
              )}
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                  RELATED STOCK
                </p>
                <h2 className="text-[22px] font-bold text-[#2B211C] sm:text-3xl">
                  当前相关库存
                  <span className="ml-2 text-[15px] font-bold text-[#9A6530]">
                    {relatedProducts.length} 件
                  </span>
                </h2>
              </div>
            </div>

            {relatedProducts.length > 0 ? (
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {relatedProducts.map((product) => (
                  <StockCard
                    key={`${product.id}-${product.sourceUrl}`}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-8 text-center text-[13px] leading-6 text-[#75695F] shadow-[0_4px_14px_rgba(43,33,28,0.03)]">
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
