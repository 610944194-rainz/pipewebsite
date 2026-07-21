import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import ProductGrid from "@/components/products/ProductGrid";
import { getFeaturedProducts } from "@/lib/public-products/server";

export default function FeaturedPage() {
  const featuredProducts = getFeaturedProducts();

  return (
    <main
      className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]"
      style={{
        fontFamily:
          '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
        fontVariantNumeric: "lining-nums",
      }}
    >
      <SiteHeader />

      <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-5 sm:px-6 sm:pb-12 sm:pt-7 lg:px-10 lg:pb-14">
        <header className="relative h-[194px] overflow-hidden rounded-[6px] bg-[var(--coffee-dark)] sm:h-[210px] lg:h-[300px]">
          <img
            src="/pics/weekly-featured-head.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-[66%_58%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[rgba(36,22,15,0.86)] via-[rgba(36,22,15,0.58)] to-transparent" />
          <div className="relative flex h-full max-w-[294px] flex-col justify-end px-5 pb-5 sm:max-w-[360px] sm:px-7 sm:pb-7 lg:px-10 lg:pb-9">
            <p className="text-[10px] font-normal uppercase leading-[1.4] tracking-[0.18em] text-[var(--brass)]">
              WEEKLY SELECTION
            </p>
            <h1 className="mt-2 text-[22px] font-medium leading-[1.35] text-[#f4eee7] lg:text-[28px]">
              本周精选
            </h1>
            <p className="mt-2 text-[11.5px] font-normal leading-[1.6] text-[rgba(244,238,231,0.8)] lg:text-[12px]">
              从公开库存中挑选兼具造型、工艺与价格参考价值的烟斗。
            </p>
          </div>
        </header>

        <section className="mt-5 border-b border-[rgba(222,212,200,0.72)] pb-3 sm:mt-6" aria-labelledby="featured-inventory-title">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="featured-inventory-title" className="text-[17px] font-medium leading-[1.4] text-[var(--text-primary)]">
              本周精选
            </h2>
            <p className="shrink-0 text-[12px] font-normal text-[var(--text-secondary)]">
              共 <span className="text-[13px] font-medium text-[var(--brass)]">{featuredProducts.length}</span> 件
            </p>
          </div>
        </section>

        <section className="mt-5" aria-label="本周精选商品目录">
          <ProductGrid products={featuredProducts} returnTo="/featured" variant="inventory" />
        </section>
      </section>

      <SiteFooter />
    </main>
  );
}
