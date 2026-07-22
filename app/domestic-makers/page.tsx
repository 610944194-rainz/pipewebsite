import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import MakerStudioDirectoryFilters from "../components/domestic-makers/MakerStudioDirectoryFilters";
import {
  getDemoMakersAndStudios,
  getDemoPublicWorkCount,
  type DemoMakerStudio,
} from "@/lib/demo/maker-studio-fixtures";

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = { searchParams?: Promise<SearchParams> };

const pageSize = 12;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const demo = firstParam(params.demo) === "1";

  return {
    title: "斗师 / 工作室｜烟斗派 YandouBuy",
    description: "记录国内斗师与工作室及其公开作品资料。",
    ...(demo ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function DomesticMakersPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const demo = firstParam(params.demo) === "1";
  const query = firstParam(params.q).trim();
  const requestedRegion = firstParam(params.region).trim();
  const requestedKind = firstParam(params.kind).trim();
  const requestedPage = Number.parseInt(firstParam(params.page) || "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const source = demo ? getDemoMakersAndStudios() : ([] as readonly DemoMakerStudio[]);
  const regions = Array.from(new Set(source.map((entry) => entry.region))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const activeRegion = regions.includes(requestedRegion) ? requestedRegion : "";
  const activeKind = requestedKind === "maker" || requestedKind === "studio" ? requestedKind : "";
  const keyword = query.toLocaleLowerCase("zh-CN");
  const filtered = source.filter((entry) => {
    const searchText = [entry.name, entry.region, entry.intro, entry.longIntro, kindLabel(entry.kind)].join(" ").toLocaleLowerCase("zh-CN");
    return (!keyword || searchText.includes(keyword)) && (!activeRegion || entry.region === activeRegion) && (!activeKind || entry.kind === activeKind);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleEntries = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const returnTo = buildDirectoryHref({ demo, query, region: activeRegion, kind: activeKind, page: safePage });

  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]" style={{ fontFamily: '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif' }}>
      <SiteHeader />

      <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-5 sm:px-6 sm:pb-12 sm:pt-7 lg:px-10 lg:pb-14">
        <header className="relative aspect-[16/9] overflow-hidden rounded-[6px] bg-[var(--coffee-dark)] lg:h-[310px] lg:aspect-auto">
          <Image src="/pics/weekly-featured-head.png" alt="" fill sizes="(max-width: 1023px) 100vw, 1200px" className="object-cover object-[65%_center]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[rgba(36,22,15,0.88)] via-[rgba(36,22,15,0.56)] to-[rgba(36,22,15,0.08)]" />
          <div className="relative flex h-full max-w-[62%] flex-col justify-end px-5 pb-5 sm:max-w-[58%] sm:px-7 sm:pb-7 lg:px-10 lg:pb-9">
            <p className="text-[10px] font-normal uppercase leading-[1.4] tracking-[0.18em] text-[var(--brass)]">PIPE MAKERS &amp; STUDIOS</p>
            <h1 className="mt-2 text-[24px] font-medium leading-[1.35] text-[#f4eee7] lg:text-[30px]">斗师 / 工作室</h1>
            <p className="mt-2 text-[11.5px] font-normal leading-[1.55] text-[rgba(244,238,231,0.82)] lg:max-w-[420px] lg:text-[12px]">
              记录国内斗师与工作室及其公开作品，了解他们的创作方向与在库作品。
            </p>
          </div>
        </header>

        {demo ? (
          <p className="mt-3 text-[11px] font-normal leading-[1.5] text-[var(--brass)]">示例资料 · 仅用于页面开发与功能验收</p>
        ) : null}

        <section className="mt-5 border-b border-[rgba(222,212,200,0.72)] pb-3 sm:mt-6" aria-labelledby="maker-directory-title">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="maker-directory-title" className="text-[20px] font-medium leading-[1.4] text-[var(--text-primary)]">斗师 / 工作室</h2>
            <p className="shrink-0 text-[12px] font-normal text-[var(--text-secondary)]">
              共 <span className="text-[13px] font-medium text-[var(--brass)]">{filtered.length}</span> 位斗师 / 工作室
            </p>
          </div>
        </section>

        <MakerStudioDirectoryFilters
          initialQuery={query}
          activeRegion={activeRegion}
          activeKind={activeKind}
          regions={regions}
          demo={demo}
        />

        {visibleEntries.length > 0 ? (
          <div className="mt-4 grid gap-2.5 md:grid-cols-2 md:gap-3">
            {visibleEntries.map((entry) => (
              <MakerStudioDirectoryCard key={entry.slug} entry={entry} demo={demo} returnTo={returnTo} />
            ))}
          </div>
        ) : demo ? (
          <EmptyState title="暂无匹配结果" copy="可以减少关键词，或清除地区与类型筛选后重试。" />
        ) : (
          <EmptyState title="斗师 / 工作室资料正在整理中" copy="后续将陆续补充国内斗师、工作室与公开作品资料。" />
        )}

        {totalPages > 1 ? (
          <DirectoryPagination currentPage={safePage} totalPages={totalPages} hrefForPage={(targetPage) => buildDirectoryHref({ demo, query, region: activeRegion, kind: activeKind, page: targetPage })} />
        ) : null}
      </section>

      <SiteFooter />
    </main>
  );
}

function MakerStudioDirectoryCard({ entry, demo, returnTo }: { entry: DemoMakerStudio; demo: boolean; returnTo: string }) {
  const count = getDemoPublicWorkCount(entry.slug);
  const detailParams = new URLSearchParams();
  if (demo) detailParams.set("demo", "1");
  detailParams.set("returnTo", returnTo);
  detailParams.set("anchor", makerAnchor(entry.slug));
  const detailHref = `/domestic-makers/${entry.slug}?${detailParams.toString()}`;

  return (
    <article id={makerAnchor(entry.slug)} className="min-w-0">
      <Link href={detailHref} aria-label={`查看${entry.name}资料`} className="group grid min-h-[112px] grid-cols-[92px_minmax(0,1fr)_18px] items-center gap-3 rounded-[5px] border border-[rgba(91,62,43,0.10)] bg-white p-2.5 transition-colors hover:border-[rgba(168,120,62,0.48)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brass)] md:min-h-[132px] md:grid-cols-[112px_minmax(0,1fr)_18px]">
        <div className="relative h-[92px] overflow-hidden rounded-[4px] bg-[#f6f1e9] md:h-[112px]">
          {entry.coverImage ? (
            <Image src={entry.coverImage} alt="" fill sizes="(max-width: 767px) 92px, 112px" className="object-cover object-[68%_center]" />
          ) : (
            <div className="flex h-full items-center justify-center border border-[rgba(91,62,43,0.06)] px-2 text-center text-[18px] font-medium leading-[1.3] text-[var(--coffee)] md:text-[20px]">
              {entry.name.replace(/^示例(?:斗师|工作室)\s*·\s*/, "")}
            </div>
          )}
          <span className="absolute left-1.5 top-1.5 bg-[rgba(86,56,34,0.82)] px-1.5 py-0.5 text-[10px] font-normal leading-[1.35] text-[#f4eee7]">{kindLabel(entry.kind)}</span>
        </div>

        <div className="min-w-0 self-stretch py-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-[15px] font-semibold leading-[1.35] text-[var(--text-primary)]">{entry.name}</h3>
            {demo ? <span className="shrink-0 text-[10px] font-normal text-[var(--text-secondary)]">示例</span> : null}
          </div>
          <p className="mt-1 truncate text-[11.5px] font-normal leading-[1.4] text-[var(--text-secondary)]">{entry.region}</p>
          <p className="mt-1.5 line-clamp-2 text-[11.5px] font-normal leading-[1.45] text-[var(--text-secondary)]">{entry.intro}</p>
          <p className="mt-1.5 text-[11.5px] font-medium leading-[1.4] text-[var(--coffee)]">
            {count > 0 ? `公开作品 ${count} 件` : "暂无公开作品"}
          </p>
        </div>

        <ArrowIcon className="h-4 w-4 text-[var(--text-secondary)] transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" />
      </Link>
    </article>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="mt-5 border-t border-[rgba(222,212,200,0.72)] py-10 text-center sm:py-14">
      <h3 className="text-[18px] font-medium leading-[1.4] text-[var(--text-primary)]">{title}</h3>
      <p className="mx-auto mt-3 max-w-[340px] text-[12px] font-normal leading-[1.65] text-[var(--text-secondary)]">{copy}</p>
    </section>
  );
}

function DirectoryPagination({ currentPage, totalPages, hrefForPage }: { currentPage: number; totalPages: number; hrefForPage: (page: number) => string }) {
  return (
    <nav aria-label="斗师与工作室分页" className="mt-7 flex h-11 items-center justify-between border-y border-[rgba(222,212,200,0.72)] text-[13px] font-normal">
      {currentPage > 1 ? <Link href={hrefForPage(currentPage - 1)} className="text-[var(--text-secondary)] hover:text-[var(--coffee)]">← 上一页</Link> : <span className="text-[rgba(116,102,92,0.42)]">← 上一页</span>}
      <span className="text-[var(--text-primary)]">第 {currentPage} / {totalPages} 页</span>
      {currentPage < totalPages ? <Link href={hrefForPage(currentPage + 1)} className="text-[var(--text-secondary)] hover:text-[var(--coffee)]">下一页 →</Link> : <span className="text-[rgba(116,102,92,0.42)]">下一页 →</span>}
    </nav>
  );
}

function buildDirectoryHref({ demo, query, region, kind, page }: { demo: boolean; query?: string; region?: string; kind?: string; page?: number }) {
  const params = new URLSearchParams();
  if (demo) params.set("demo", "1");
  if (query?.trim()) params.set("q", query.trim());
  if (region) params.set("region", region);
  if (kind) params.set("kind", kind);
  if (page && page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/domestic-makers?${queryString}` : "/domestic-makers";
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function makerAnchor(slug: string) {
  return `maker-${slug}`;
}

function kindLabel(kind: DemoMakerStudio["kind"]) {
  return kind === "maker" ? "斗师" : "工作室";
}

function ArrowIcon({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}><path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
