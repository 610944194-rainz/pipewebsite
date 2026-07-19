import Link from "next/link";
import { buildProductsHref } from "@/lib/public-products/url";
import HomeProductRail, { type HomeRailProduct } from "./HomeProductRail";

export type HomeFeaturedBrand = {
  slug: string;
  name: string;
  nameZh?: string;
  country?: string;
  logoSrc: string;
  logoMaxWidth: string;
  logoMaxHeight: string;
  logoScale: number;
  logoObjectPosition: string;
};

export type HomeFeaturedMaker = {
  slug: string;
  displayName: string;
  city: string;
  typeLabel: string;
  intro: string;
  image: string;
  objectPosition: string;
};

type HomeEditorialSectionsProps = {
  weeklyProducts: HomeRailProduct[];
  todayProducts: HomeRailProduct[];
  brands: HomeFeaturedBrand[];
  makers: HomeFeaturedMaker[];
};

const collectionCards = [
  { title: "英式风格", desc: "经典传统，绅士之选", href: buildProductsHref({ country: "United Kingdom" }), image: "/pics/collection-british.jpg" },
  { title: "美式风格", desc: "粗犷实用，收藏氛围", href: buildProductsHref({ country: "United States" }), image: "/pics/collection-american.jpg" },
  { title: "意式经典", desc: "工艺精细，设计优雅", href: buildProductsHref({ country: "Italy" }), image: "/pics/collection-italian.jpg" },
  { title: "丹麦手工", desc: "简约自然，手工匠心", href: buildProductsHref({ country: "Denmark" }), image: "/pics/collection-danish.jpg" },
];

export default function HomeEditorialSections({ weeklyProducts, todayProducts, brands, makers }: HomeEditorialSectionsProps) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-7 sm:px-6 sm:pb-12 sm:pt-10 lg:px-10 lg:pb-14 lg:pt-12">
      <section id="weekly-featured" className="scroll-mt-20">
        <SectionHeader title="本周精选" href="/featured" />
        <div className="mt-3"><HomeProductRail products={weeklyProducts} variant="weekly" /></div>
      </section>

      <section className="mt-8 lg:mt-12">
        <SectionHeader title="国内斗师精选" href="/domestic-makers" />
        <div className="home-rail -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
          {makers.map((maker) => (
            <Link
              key={maker.slug}
              href={`/domestic-makers/${maker.slug}`}
              className="group relative aspect-[3/2] w-[80vw] shrink-0 snap-start overflow-hidden rounded-[7px] bg-[var(--coffee-dark)] sm:h-[230px] sm:w-auto sm:aspect-auto"
            >
              <img
                src={maker.image}
                alt={`展示样例：${maker.displayName}制斗场景`}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
                style={{ objectPosition: maker.objectPosition }}
              />
              <div className="absolute inset-x-0 bottom-0 h-[56%] bg-gradient-to-t from-black/90 via-black/48 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 px-[18px] pb-[17px] text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.22)]">
                <p className="text-[9px] font-normal leading-[1.3] tracking-[0.08em] text-[rgba(244,238,231,0.62)] sm:text-[10px] sm:leading-[1.3]">展示样例</p>
                <h3 className="mt-[6px] text-[15px] font-medium leading-[1.32] tracking-normal sm:text-[16px] sm:leading-[1.32]">{maker.displayName}</h3>
                <p className="mt-[5px] text-[10.5px] font-normal leading-[1.4] text-[rgba(244,238,231,0.76)] sm:text-[11px]">{maker.city} / {maker.typeLabel}</p>
                <p className="mt-[7px] line-clamp-1 text-[11px] font-normal leading-[1.45] text-[rgba(244,238,231,0.72)] sm:text-[11.5px]">{maker.intro}</p>
                <span className="mt-[11px] inline-flex items-center text-[11px] font-normal leading-[1.4] text-[#e4c18d] sm:text-[11.5px]">查看作品<ArrowIcon className="ml-1.5 h-2.5 w-2.5 sm:h-3 sm:w-3" /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-9 lg:mt-12">
        <SectionHeader title="品牌精选" href="/brands" />
        <div className="home-rail -mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-5 sm:overflow-visible sm:px-0">
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={`/brands/${brand.slug}`}
              className="flex h-[78px] w-[118px] shrink-0 snap-start flex-col items-center justify-center text-center sm:w-auto"
            >
              <span className="flex h-[50px] w-full items-center justify-center">
                <img
                  src={brand.logoSrc}
                  alt={`${brand.name} Logo`}
                  className="h-auto w-auto object-contain"
                  style={{
                    maxWidth: brand.logoMaxWidth,
                    maxHeight: brand.logoMaxHeight,
                    objectPosition: brand.logoObjectPosition,
                    transform: `scale(${brand.logoScale})`,
                  }}
                />
              </span>
              <span className="mt-1.5 text-[11px] font-normal leading-[1.4] text-[var(--text-secondary)]">{brand.nameZh || brand.country || brand.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 lg:mt-12">
        <SectionHeader title="海外库存速览" href="/products" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
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

      <section className="mt-9 lg:mt-12">
        <SectionHeader title="今日更新" href="/products" />
        <div className="mt-3"><HomeProductRail products={todayProducts} variant="today" /></div>
      </section>

      <section className="mt-8 lg:mt-12">
        <SectionHeader title="烟斗指南" href="/service" />
        <Link href="/service" className="group relative mt-3 block aspect-[2/1] overflow-hidden rounded-[10px] bg-[var(--coffee-dark)] sm:aspect-[3/1]">
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
