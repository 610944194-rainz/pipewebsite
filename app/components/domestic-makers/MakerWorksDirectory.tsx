"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ProductCardImage from "@/components/products/ProductCardImage";
import type {
  DemoMakerProduct,
  DemoMakerStudio,
} from "@/lib/demo/maker-studio-fixtures";

type WorksMode = "all" | "available";

type MakerWorksProps = {
  maker: DemoMakerStudio;
  works: readonly DemoMakerProduct[];
};

function currentWorksMode(value: string | null): WorksMode {
  return value === "available" ? "available" : "all";
}

function displayedName(name: string) {
  return name.replace(/^示例(?:斗师|工作室)\s*·\s*/, "");
}

function buildStateHref(
  pathname: string,
  searchParams: URLSearchParams,
  works: WorksMode
) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("demo", "1");
  if (works === "available") params.set("works", "available");
  else params.delete("works");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function useWorksState() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = currentWorksMode(searchParams.get("works"));

  function selectWorks(nextMode: WorksMode) {
    if (nextMode === mode) {
      document.getElementById("maker-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    router.push(buildStateHref(pathname, searchParams, nextMode), { scroll: false });
    requestAnimationFrame(() => {
      document.getElementById("maker-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return { mode, pathname, searchParams, selectWorks };
}

export function MakerWorksStats({ maker, works }: MakerWorksProps) {
  const { mode, selectWorks } = useWorksState();
  const availableCount = works.filter((work) => work.availability === "available").length;
  const items = [
    { label: "制斗经验", value: maker.experience },
    { label: "作品集", value: `${works.length} 件`, mode: "all" as const },
    { label: "在售作品", value: `${availableCount} 件`, mode: "available" as const },
    { label: "工作地点", value: maker.region },
  ];

  return (
    <section aria-label="斗师与工作室数据" className="border-y border-[rgba(213,166,81,0.12)] bg-[#3a2518]">
      <div className="mx-auto grid max-w-[1240px] grid-cols-4 divide-x divide-[rgba(213,166,81,0.08)] px-4 sm:px-6 lg:px-10">
        {items.map((item) =>
          item.mode ? (
            <button
              key={item.label}
              type="button"
              aria-pressed={mode === item.mode}
              onClick={() => selectWorks(item.mode)}
              className={`min-w-0 px-2 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#e4c18d] sm:py-5 ${mode === item.mode ? "text-[#e4c18d]" : "text-[#f4eee7]"}`}
            >
              <span className="block text-[10px] font-normal leading-[1.35] text-[rgba(244,238,231,0.56)] sm:text-[10.5px]">{item.label}</span>
              <span className="mt-1.5 block text-[13px] font-medium leading-[1.35] sm:text-[14px]">{item.value}</span>
              <span className={`mx-auto mt-2 block h-px w-5 bg-[#d7a758] transition-opacity ${mode === item.mode ? "opacity-100" : "opacity-0"}`} />
            </button>
          ) : (
            <div key={item.label} className="min-w-0 px-2 py-4 text-center sm:py-5">
              <span className="block text-[10px] font-normal leading-[1.35] text-[rgba(244,238,231,0.56)] sm:text-[10.5px]">{item.label}</span>
              <span className="mt-1.5 block truncate text-[13px] font-medium leading-[1.35] text-[#e4c18d] sm:text-[14px]">{item.value}</span>
            </div>
          )
        )}
      </div>
    </section>
  );
}

export function MakerWorksDirectory({ maker, works }: MakerWorksProps) {
  const { mode, pathname, searchParams, selectWorks } = useWorksState();
  const displayedWorks = mode === "available"
    ? works.filter((work) => work.availability === "available")
    : works;
  const activeTitle = mode === "available" ? "在售作品" : "作品集";

  return (
    <section id="maker-works" className="scroll-mt-5 px-4 py-7 sm:px-6 sm:py-9 lg:px-10">
      <div className="mx-auto max-w-[1240px]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-normal uppercase tracking-[0.16em] text-[#d7a758]">WORKS DIRECTORY</p>
            <h2 className="mt-1 text-[19px] font-medium leading-[1.35] text-[#f4eee7] sm:text-[21px]">{activeTitle}</h2>
          </div>
          <p className="text-[13px] font-medium text-[#e4c18d]">{displayedWorks.length} 件</p>
        </div>

        <div className="mt-4 flex gap-5 border-b border-[rgba(213,166,81,0.1)] text-[13px] font-medium">
          <button type="button" aria-pressed={mode === "all"} onClick={() => selectWorks("all")} className={`relative pb-2.5 focus-visible:outline-none ${mode === "all" ? "text-[#e4c18d] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[#d7a758]" : "text-[rgba(244,238,231,0.56)]"}`}>作品集</button>
          <button type="button" aria-pressed={mode === "available"} onClick={() => selectWorks("available")} className={`relative pb-2.5 focus-visible:outline-none ${mode === "available" ? "text-[#e4c18d] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[#d7a758]" : "text-[rgba(244,238,231,0.56)]"}`}>在售作品</button>
        </div>

        {displayedWorks.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {displayedWorks.map((work) => {
              const returnTo = buildStateHref(pathname, searchParams, mode);
              const params = new URLSearchParams({ demo: "1", returnTo, anchor: `work-${work.id}` });
              const href = `/domestic-makers/${maker.slug}/works/${work.id}?${params.toString()}`;
              return (
                <article id={`work-${work.id}`} key={work.id} className="min-w-0">
                  <Link href={href} aria-label={`查看示例作品：${work.nameZh}`} className="flex h-full min-h-[256px] flex-col overflow-hidden rounded-[5px] border border-[rgba(213,166,81,0.14)] bg-[#342116] transition-colors hover:border-[rgba(213,166,81,0.28)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#e4c18d]">
                    <ProductCardImage imageUrl={work.images[0]} alt={`示例作品：${work.nameZh}`} brandName={null} className="aspect-square" imageClassName="p-2.5">
                      <span className="absolute left-2 top-2 bg-[rgba(42,24,14,0.76)] px-1.5 py-0.5 text-[9px] font-normal leading-[1.3] text-[#f4eee7]">示例</span>
                      {work.availability === "sold-reference" ? <span className="absolute bottom-2 left-2 bg-[rgba(244,238,231,0.88)] px-1.5 py-0.5 text-[9px] font-normal leading-[1.3] text-[#563822]">已售参考</span> : null}
                    </ProductCardImage>
                    <div className="flex min-h-[112px] flex-1 flex-col p-3">
                      <h3 className="line-clamp-2 min-h-[2.8em] text-[12.5px] font-medium leading-[1.4] text-[#f4eee7]">{work.nameZh}</h3>
                      <p className="mt-1 truncate text-[10.5px] font-normal leading-[1.4] text-[rgba(244,238,231,0.62)]">{work.shape} · {work.finish}</p>
                      <p className="mt-auto pt-2 text-[12px] font-medium leading-[1.4] text-[#e4c18d]">示例参考价 ¥{work.demoReferencePrice.toLocaleString("zh-CN")}</p>
                    </div>
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 border-y border-[rgba(213,166,81,0.1)] py-8 text-center">
            <p className="text-[16px] font-medium text-[#f4eee7]">暂无公开作品</p>
            <p className="mt-2 text-[12px] font-normal leading-[1.55] text-[rgba(244,238,231,0.62)]">作品资料正在整理中。</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function MakerProfileAbout({ maker }: { maker: DemoMakerStudio }) {
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const bioRef = useRef<HTMLParagraphElement>(null);
  const displayName = displayedName(maker.name);

  useEffect(() => {
    if (expanded) return;

    const bio = bioRef.current;
    if (!bio) return;

    const measureOverflow = () => {
      setHasOverflow(bio.scrollHeight > bio.clientHeight + 1);
    };

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(bio);
    return () => observer.disconnect();
  }, [expanded, maker.longIntro]);

  return (
    <section className="border-y border-[rgba(213,166,81,0.1)] bg-[#322015] px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1240px]">
        <h2 className="text-[20px] font-medium leading-[1.35] text-[#f4eee7]">关于{displayName}</h2>
        <p
          id={`maker-bio-${maker.slug}`}
          ref={bioRef}
          className={`mt-3 max-w-[760px] whitespace-pre-line text-[13px] font-normal leading-[1.6] text-[rgba(244,238,231,0.72)] ${expanded ? "" : "line-clamp-6"}`}
        >
          {maker.longIntro.trim()}
        </p>
        {hasOverflow || expanded ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`maker-bio-${maker.slug}`}
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 text-[12.5px] font-medium leading-[1.4] text-[#e4c18d] underline decoration-[rgba(228,193,141,0.64)] underline-offset-4 focus-visible:outline-none"
          >
            {expanded ? "收起" : "查看更多"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
