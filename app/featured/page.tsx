import Link from "next/link";
import ProductGrid from "@/components/products/ProductGrid";
import { getFeaturedProducts } from "@/lib/public-products/server";
import SiteHeader from "../components/SiteHeader";

export default function FeaturedPage() {
  const featuredProducts = getFeaturedProducts();

  return (
    <main
      className="min-h-screen bg-[#FBF7EF] text-[#1F1A16]"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "PingFang TC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
        fontVariantNumeric: "lining-nums",
      }}
    >
      <TopNotice />
      <SiteHeader />

      <section className="mx-auto max-w-7xl px-4 pb-12 pt-5 sm:px-6 lg:px-10">
        <header className="overflow-hidden rounded-[24px] border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_8px_22px_rgba(31,26,22,0.04)]">
          <div className="px-5 py-5 sm:px-7 sm:py-7">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#A97838]">
              Daily Picks
            </p>
            <h1 className="mt-2 font-serif text-[30px] font-semibold leading-tight tracking-[0.06em] text-[#063B32] sm:text-[42px]">
              今日精选
            </h1>
            <p className="mt-3 max-w-2xl text-[13px] leading-7 text-[#746A5F] sm:text-[14px]">
              每日从在售库存中按品牌、图片数量、资料完整度与价格有效性自动筛选。
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/"
                className="flex h-11 items-center justify-center rounded-full border border-[#D8CFC2] bg-white px-5 text-[13px] font-semibold text-[#1F1A16] transition hover:border-[#063B32] hover:text-[#063B32]"
              >
                返回首页
              </Link>
              <Link
                href="/products"
                className="flex h-11 items-center justify-center rounded-full bg-[#063B32] px-5 text-[13px] font-semibold text-[#E7C48A] transition hover:bg-[#0A4A3E]"
              >
                前往海外库存
              </Link>
            </div>
          </div>
        </header>

        <section className="mt-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[12px] uppercase tracking-[0.2em] text-[#A97838]">
                Curated Inventory
              </p>
              <h2 className="mt-1 text-[20px] font-semibold text-[#1F1A16]">
                今日 20 把精选
              </h2>
            </div>
            <p className="shrink-0 text-[12px] text-[#746A5F]">
              共 {featuredProducts.length} 把
            </p>
          </div>

          <ProductGrid products={featuredProducts} returnTo="/featured" />
        </section>
      </section>
    </main>
  );
}

function TopNotice() {
  return (
    <div className="bg-[#063B32] px-4 py-2 text-center text-[12px] tracking-[0.12em] text-[#E7C48A] sm:text-[13px]">
      <span className="mx-2 text-[#B8863B]">·</span>
      精选海外烟斗库存 · 每日自动更新
      <span className="mx-2 text-[#B8863B]">·</span>
    </div>
  );
}
