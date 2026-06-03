import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import { pipeBrands, type PipeBrand } from "../../data/brands";
import { pipeProducts } from "../../data/pipes";
import type { PipeProduct } from "../../data/pipes";

function normalizeBrandName(value: string) {
  return value.trim().toLowerCase();
}

function getBrandProducts(brand: PipeBrand) {
  const names = [brand.name, ...brand.aliases].map(normalizeBrandName);

  return pipeProducts.filter((product: PipeProduct) =>
    names.includes(normalizeBrandName(product.brand))
  );
}

export default function BrandsPage() {
  return (
    <main className="min-h-screen bg-[#100a07] text-[#fff8ec]">
      <SiteHeader />

      <section className="px-4 py-7 sm:px-6 sm:py-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-6 border-b border-[#3a2419] pb-5">
            <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
              PIPE BRANDS
            </p>

            <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
              烟斗品牌库
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-7 text-[#d8b58a] sm:text-base">
              整理品牌来源、定位、工艺特点与当前库存关联，方便按品牌快速浏览和比较。
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pipeBrands.map((brand) => {
              const stockCount = getBrandProducts(brand).length;

              return (
                <article
                  key={brand.slug}
                  className="flex h-full flex-col rounded-[1.2rem] border border-[#4a2f20] bg-[#21150f] p-4 sm:p-5"
                >
                  <div className="mb-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs font-bold text-[#d1934a]">
                      {brand.country}
                    </span>
                    <span className="rounded-full bg-[#160d09] px-3 py-1 text-xs font-bold text-[#d8b58a]">
                      {brand.level}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black leading-tight text-[#fff8ec] sm:text-2xl">
                        {brand.name}
                      </h2>
                      <p className="mt-3 text-sm leading-6 text-[#d8b58a]">
                        {brand.summary}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-2xl bg-[#160d09] px-3 py-2 text-center">
                      <p className="text-xl font-black text-[#f6c177]">
                        {stockCount}
                      </p>
                      <p className="mt-0.5 text-[11px] font-bold text-[#b99b7d]">
                        库存
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-[#342116] pt-3">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-[#b99b7d]">当前关联库存</span>
                      <span className="font-black text-[#f6c177]">
                        {stockCount}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/brands/${brand.slug}`}
                    className="mt-4 flex min-h-11 items-center justify-center rounded-full bg-[#d1934a] px-4 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
                  >
                    查看品牌
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
