import Image from "next/image";
import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import ProductGrid from "@/components/products/ProductGrid";
import ProductPagination from "@/components/products/ProductPagination";
import { getDailyProductUpdates } from "@/lib/public-products/daily-updates";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function parsePage(value: string | string[] | undefined, totalPages: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw || "1", 10);

  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, Math.max(totalPages, 1));
}

function updatesHref(page: number) {
  return page > 1 ? `/updates?page=${page}` : "/updates";
}

export default async function UpdatesPage({ searchParams }: PageProps) {
  const selection = getDailyProductUpdates();
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (!selection) {
    return (
      <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
        <SiteHeader />
        <section className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6 lg:px-10">
          <h1 className="text-[22px] font-medium leading-[1.35]">今日更新</h1>
          <p className="mt-3 text-[13px] leading-[1.65] text-[var(--text-secondary)]">
            暂未找到可展示的正式公开更新记录。
          </p>
        </section>
        <SiteFooter />
      </main>
    );
  }

  const totalPages = Math.ceil(selection.products.length / PAGE_SIZE);
  const currentPage = parsePage(resolvedSearchParams.page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const products = selection.products.slice(start, start + PAGE_SIZE);
  const returnTo = updatesHref(currentPage);
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
          <Image
            src="/pics/overseas-head.png"
            alt=""
            fill
            priority
            sizes="(max-width: 1279px) calc(100vw - 32px), 1160px"
            className="object-cover object-[62%_58%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[rgba(36,22,15,0.88)] via-[rgba(36,22,15,0.58)] to-transparent" />
          <Link
            href="/"
            aria-label="返回首页"
            className="absolute left-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center bg-transparent text-[#f4eee7] transition-colors hover:text-[var(--brass)] active:text-[rgba(244,238,231,0.78)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit] sm:left-5 sm:top-5"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">返回首页</span>
          </Link>
          <div className="relative flex h-full max-w-[294px] flex-col justify-end px-5 pb-5 sm:max-w-[360px] sm:px-7 sm:pb-7 lg:px-10 lg:pb-9">
            <p className="text-[10px] font-normal uppercase leading-[1.4] tracking-[0.18em] text-[var(--brass)]">
              DAILY UPDATES
            </p>
            <h1 className="mt-2 text-[22px] font-medium leading-[1.35] text-[#f4eee7] lg:text-[28px]">
              今日更新
            </h1>
            <p className="mt-2 text-[11.5px] font-normal leading-[1.6] text-[rgba(244,238,231,0.8)] lg:text-[12px]">
              查看最近进入公开库存的烟斗作品。
            </p>
          </div>
        </header>

        <section
          className="mt-5 border-b border-[rgba(222,212,200,0.72)] pb-3 sm:mt-6"
          aria-labelledby="daily-updates-title"
        >
          <h2
            id="daily-updates-title"
            className="text-[17px] font-medium leading-[1.4] text-[var(--text-primary)]"
          >
            今日更新
          </h2>
        </section>

        <section className="mt-5" aria-label="今日更新商品目录">
          <ProductGrid
            products={products}
            returnTo={returnTo}
            variant="inventory"
            priorityCount={2}
          />
        </section>

        <ProductPagination
          currentPage={currentPage}
          totalPages={totalPages}
          hrefForPage={updatesHref}
          label="今日更新分页"
          variant="editorial"
        />
      </section>

      <SiteFooter />
    </main>
  );
}

function ArrowLeftIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19 12H5M11 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
