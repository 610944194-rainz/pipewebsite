import Link from "next/link";
import { buildProductsHref } from "@/lib/public-products/url";
import HomeProductRail, { type HomeRailProduct } from "./HomeProductRail";

export type HomeFeaturedBrand = {
  slug: string;
  name: string;
  nameZh?: string;
  logoText?: string;
  country?: string;
};

type HomeEditorialSectionsProps = {
  weeklyProducts: HomeRailProduct[];
  todayProducts: HomeRailProduct[];
  brands: HomeFeaturedBrand[];
};

const collectionCards = [
  { title: "英式风格", desc: "经典传统，绅士之选", href: buildProductsHref({ country: "United Kingdom" }), image: "/pics/collection-british.jpg" },
  { title: "美式风格", desc: "粗犷实用，收藏氛围", href: buildProductsHref({ country: "United States" }), image: "/pics/collection-american.jpg" },
  { title: "意式经典", desc: "工艺精细，设计优雅", href: buildProductsHref({ country: "Italy" }), image: "/pics/collection-italian.jpg" },
  { title: "丹麦手工", desc: "简约自然，手工匠心", href: buildProductsHref({ country: "Denmark" }), image: "/pics/collection-danish.jpg" },
];

export default function HomeEditorialSections({ weeklyProducts, todayProducts, brands }: HomeEditorialSectionsProps) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-9 sm:px-6 sm:pb-12 sm:pt-11 lg:px-10 lg:pb-14 lg:pt-12">
      <section id="weekly-featured" className="scroll-mt-20">
        <SectionHeader title="本周精选" href="/featured" />
        <div className="mt-4"><HomeProductRail products={weeklyProducts} variant="weekly" /></div>
      </section>

      <section className="mt-10 lg:mt-14">
        <SectionHeader title="国内斗师精选" href="/domestic-makers" />
        <Link
          href="/domestic-makers"
          className="group relative mt-4 block aspect-[3/2] overflow-hidden rounded-[10px] bg-[var(--coffee-dark)] sm:aspect-[16/7] lg:max-h-[430px]"
        >
          <img
            src="/pics/home-hero-01-inventory.jpg"
            alt="烟斗制作工具与木质工作台"
            className="absolute inset-0 h-full w-full origin-right scale-[1.5] object-cover object-[88%_76%] transition-transform duration-500 group-hover:scale-[1.53] sm:scale-[1.35] sm:group-hover:scale-[1.38] motion-reduce:transition-none"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,10,6,0.86)_0%,rgba(16,10,6,0.50)_48%,rgba(16,10,6,0.06)_78%)]" />
          <div className="absolute inset-x-0 bottom-0 max-w-[340px] p-5 text-[#f7f2eb] sm:p-7 lg:p-9">
            <h3 className="text-[20px] font-medium leading-[1.4] sm:text-[22px]">首批创作者档案正在整理</h3>
            <p className="mt-2 max-w-[280px] text-[13px] font-normal leading-[1.6] text-[#f7f2eb]/78">发现本土手作力量</p>
            <span className="mt-4 inline-flex items-center border-b border-[var(--brass)] pb-1 text-[13px] font-normal text-[#ead3ae]">
              查看国内斗师目录<ArrowIcon className="ml-2 h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
      </section>

      <section className="mt-11 lg:mt-16">
        <SectionHeader title="品牌精选" href="/brands" />
        <div className="home-rail -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto border-y border-[var(--border)] px-4 py-5 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 lg:py-7">
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={`/brands/${brand.slug}`}
              className="flex min-h-[82px] basis-[38%] shrink-0 snap-start flex-col items-center justify-center px-3 text-center transition-colors hover:text-[var(--coffee)] sm:basis-auto motion-reduce:transition-none"
            >
              <span className="text-[14px] font-medium tracking-[0.02em] text-[var(--text-primary)]">{brand.logoText || brand.name}</span>
              <span className="mt-2 text-[11px] font-normal tracking-[0.08em] text-[var(--text-secondary)]">{brand.nameZh || brand.country || "品牌档案"}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 lg:mt-14">
        <SectionHeader title="海外库存速览" href="/products" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
          {collectionCards.map((item) => (
            <Link key={item.title} href={item.href} className="group relative aspect-[0.78/1] overflow-hidden rounded-[8px] bg-[var(--coffee-dark)]">
              <img src={item.image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.22)]">
                <h3 className="text-[15px] font-medium leading-[1.35]">{item.title}</h3>
                <p className="mt-1 text-[11px] font-normal leading-[1.45] text-[rgba(244,238,231,0.78)]">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 lg:mt-14">
        <SectionHeader title="今日更新" href="/products" />
        <div className="mt-4"><HomeProductRail products={todayProducts} variant="today" /></div>
      </section>

      <section className="mt-11 lg:mt-16">
        <SectionHeader title="烟斗指南" href="/service" />
        <Link href="/service" className="group relative mt-4 block aspect-[2/1] overflow-hidden rounded-[10px] bg-[var(--coffee-dark)] sm:aspect-[3/1]">
          <img src="/pics/guide-beginner.jpg" alt="烟斗入门指南" className="absolute inset-0 h-full w-full origin-left scale-[2.8] object-cover object-left transition-transform duration-500 sm:scale-[3] motion-reduce:transition-none" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(13,8,5,0.78)_0%,rgba(13,8,5,0.40)_52%,rgba(13,8,5,0.02)_80%)]" />
          <div className="absolute inset-y-0 left-0 flex max-w-[320px] flex-col justify-center p-5 text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.22)] sm:p-7">
            <h3 className="text-[18px] font-medium leading-[1.4]">了解烟斗，从这里开始</h3>
            <p className="mt-2 text-[12px] font-normal leading-[1.6] text-[rgba(244,238,231,0.78)]">选购指南 · 保养知识 · 术语百科</p>
            <span className="mt-3 inline-flex w-fit items-center border-b border-[var(--brass)] pb-1 text-[12px] font-normal text-[#e4c18d]">探索指南<ArrowIcon className="ml-2 h-3 w-3" /></span>
          </div>
        </Link>
      </section>
    </div>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-[17px] font-medium leading-[1.4] tracking-[0.01em] text-[var(--text-primary)] sm:text-[19px]">{title}</h2>
      <Link href={href} className="inline-flex items-center text-[12px] font-normal leading-[1.4] text-[var(--text-secondary)] transition-colors hover:text-[var(--coffee)] motion-reduce:transition-none">
        查看全部<ArrowIcon className="ml-1.5 h-3 w-3" />
      </Link>
    </div>
  );
}

function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
