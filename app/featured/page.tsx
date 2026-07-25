import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import EditorialHero from "../components/page/EditorialHero";
import PageBackBar from "../components/page/PageBackBar";
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
      <PageBackBar />

      <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-1 sm:px-6 sm:pb-12 lg:px-10 lg:pb-14">
        <EditorialHero
          imageSrc="/pics/weekly-featured-head.png"
          eyebrow="WEEKLY SELECTION"
          title="本周精选"
          description="从公开库存中挑选兼具造型、工艺与价格参考价值的烟斗。"
          imagePosition="66% 58%"
        />

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
