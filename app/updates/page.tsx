import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import EditorialHero from "../components/page/EditorialHero";
import PageBackBar from "../components/page/PageBackBar";
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
        <PageBackBar />
        <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-1 sm:px-6 lg:px-10">
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
      <PageBackBar />

      <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-1 sm:px-6 sm:pb-12 lg:px-10 lg:pb-14">
        <EditorialHero
          imageSrc="/pics/overseas-head.png"
          eyebrow="DAILY UPDATES"
          title="今日更新"
          description="查看最近进入公开库存的烟斗作品。"
          imagePosition="62% 58%"
        />

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
