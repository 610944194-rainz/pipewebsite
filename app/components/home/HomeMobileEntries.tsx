import Link from "next/link";
import SiteHeader from "../SiteHeader";
import HomeImage, { HomeImagePreload } from "./HomeImage";

function Arrow({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function HomeMobileEntries() {
  return <div className="bg-[#faf8f4] text-[#17120e] lg:hidden">
    <section aria-label="烟斗派首页主视觉" className="relative bg-[#24170f] text-white">
      <HomeImagePreload src="/home/reference-r2/hero.webp" sizes="100vw" media="(max-width: 1023px)" />
      <HomeImage src="/home/reference-r2/hero.webp" media="(max-width: 1023px)" sizes="100vw" loading="eager" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover object-center" />
      <SiteHeader variant="reference" />
      <div className="relative h-[clamp(214px,58vw,400px)] px-5 pt-8 sm:px-7 sm:pt-10">
        <div className="w-[54%] text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">
          <h1 className="text-[20px] font-medium leading-[1.45] tracking-[0.01em] sm:text-[24px]">让好烟斗<br/>找到懂它的人</h1>
          <p className="mt-1.5 whitespace-nowrap text-[8.5px] font-normal leading-[1.4] tracking-[0.12em] text-[rgba(244,238,231,0.62)] sm:text-[9px]">PIPES CONNECT PEOPLE</p>
          <p className="mt-3 text-[11px] font-normal leading-[1.6] text-[rgba(244,238,231,0.78)] sm:text-[12px]">从全球烟斗到斗草百科，<br/>在这里发现、了解并拥有<br/>真正适合你的烟斗生活。</p>
        </div>
      </div>
    </section>
    <section aria-labelledby="explore-yandoubuy" className="px-3.5 pt-4 sm:px-6 sm:pt-6">
      <div className="flex items-center justify-between gap-4 px-0.5 pb-3">
        <h2 id="explore-yandoubuy" className="text-[17px] font-medium leading-[1.4] tracking-[0.01em] sm:text-[19px]">探索烟斗派</h2>
        <p className="hidden text-[11px] font-normal leading-[1.4] text-[#6c6862] sm:block">烟斗与斗草，连接更丰富的生活方式。</p>
      </div>
      <nav aria-label="首页快捷入口" className="grid grid-cols-2 gap-2 sm:gap-3">
        <Link prefetch={false} href="/products" className="group relative aspect-[0.777] min-w-0 overflow-hidden rounded-[8px] bg-[#1f2b37]">
          <HomeImage src="/home/reference-r3/pipes-slate.webp" alt="" media="(max-width: 1023px)" sizes="(min-width: 640px) calc(50vw - 30px), calc(50vw - 18px)" className="absolute inset-0 h-full w-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0" style={{backgroundImage:"linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.12) 48%, transparent 72%)"}} />
          <div className="absolute inset-x-0 bottom-0 p-4 text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.22)] max-[360px]:p-3">
            <h3 className="text-[15px] font-medium leading-[1.35] sm:text-[16px]">海外烟斗</h3>
            <p className="mt-1 text-[11px] font-normal leading-[1.45] text-[rgba(244,238,231,0.78)]">品牌 · 库存 · 新品</p>
            <span className="mt-[11px] inline-flex items-center text-[11px] font-normal leading-[1.4] text-[#e4c18d] sm:text-[11.5px]">查看海外烟斗<Arrow className="ml-1.5 h-2.5 w-2.5 sm:h-3 sm:w-3"/></span>
          </div>
        </Link>
        <a href="/tobacco-encyclopedia/index.html" className="group relative aspect-[0.777] min-w-0 overflow-hidden rounded-[8px] bg-[#373b2f]">
          <HomeImage src="/home/reference-r3/tobacco-olive.webp" alt="" media="(max-width: 1023px)" sizes="(min-width: 640px) calc(50vw - 30px), calc(50vw - 18px)" className="absolute inset-0 h-full w-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0" style={{backgroundImage:"linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.12) 48%, transparent 72%)"}} />
          <div className="absolute inset-x-0 bottom-0 p-4 text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.22)] max-[360px]:p-3">
            <h3 className="text-[15px] font-medium leading-[1.35] sm:text-[16px]">斗草百科</h3>
            <p className="mt-1 text-[11px] font-normal leading-[1.45] text-[rgba(244,238,231,0.78)]">品牌 · 配方 · 切型</p>
            <span className="mt-[11px] inline-flex items-center text-[11px] font-normal leading-[1.4] text-[#e4c18d] sm:text-[11.5px]">进入斗草百科<Arrow className="ml-1.5 h-2.5 w-2.5 sm:h-3 sm:w-3"/></span>
          </div>
        </a>
      </nav>
      <div className="mt-2.5 flex min-h-[76px] items-center gap-1.5 rounded-[7px] bg-[#f4eee5] px-2 py-3 sm:mt-4 sm:gap-4 sm:px-5 sm:py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_40%_40%,#f8f4ed,#e7d9c8)] text-[#9b836b] max-[360px]:hidden sm:h-[64px] sm:w-[64px]"><svg viewBox="0 0 36 40" fill="none" aria-hidden="true" className="h-[29px] w-[27px]"><path d="M25 3H5v34h27V10l-7-7Zm0 0v8h7M10 14h12M10 20h16M10 26h16M10 32h11" stroke="currentColor" strokeWidth="1.5"/></svg></span>
        <div className="min-w-0 flex-1"><h3 className="whitespace-nowrap text-[13px] font-semibold sm:text-[19px]">没找到想要的烟斗？</h3><p className="mt-1.5 text-[9.5px] leading-[1.5] sm:text-[13px]">告诉我们你的品牌、预算和斗型，<br/>我们帮你寻找全球货源。</p></div>
        <Link prefetch={false} href="/request" className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[5px] bg-[#24170f] px-2 text-[10px] text-white sm:h-12 sm:px-4 sm:text-[14px]">提交找斗需求<Arrow/></Link>
      </div>
    </section>
  </div>;
}
