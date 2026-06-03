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
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
              PIPE BRANDS
            </p>

            <h1 className="text-[30px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
              烟斗品牌库
            </h1>

            <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
              整理品牌来源、定位、工艺特点与当前库存关联，方便按品牌快速浏览和比较。
            </p>
          </header>

          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {pipeBrands.map((brand) => {
              const stockCount = getBrandProducts(brand).length;

              return (
                <article
                  key={brand.slug}
                  className="flex h-full flex-col rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5"
                >
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#9A6530]">
                      {brand.country}
                    </span>
                    <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-medium text-[#75695F]">
                      {brand.level}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-[20px] font-bold leading-tight text-[#2B211C] sm:text-[22px]">
                        {brand.name}
                      </h2>

                      <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                        {brand.summary}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] px-3 py-2 text-center">
                      <p className="text-[22px] font-bold leading-none text-[#2B211C]">
                        {stockCount}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#75695F]">
                        库存
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-[#F0E6D8] pt-3">
                    <div className="flex items-center justify-between text-[12px] sm:text-[13px]">
                      <span className="text-[#75695F]">当前关联库存</span>
                      <span className="font-bold text-[#9A6530]">
                        {stockCount}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/brands/${brand.slug}`}
                    className="mt-4 flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
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