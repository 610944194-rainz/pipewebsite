import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductArchive, {
  type ProductArchiveSpecGroups,
  type ProductArchiveSpecRow,
} from "@/app/components/products/ProductArchive";
import SiteFooter from "@/app/components/SiteFooter";
import SiteHeader from "@/app/components/SiteHeader";
import {
  getDemoMakerOrStudioBySlug,
  type DemoMakerProduct,
  type DemoMakerStudio,
} from "@/lib/demo/maker-studio-fixtures";
import { getDemoMakerProduct } from "@/lib/demo/maker-studio-product-adapter";
import ProductGallery, { ProductBackButton } from "@/app/products/[id]/ProductGallery";

type PageProps = {
  params: Promise<{ slug: string; workId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function displayedName(name: string) {
  return name.replace(/^示例(?:斗师|工作室)\s*·\s*/, "");
}

function formatMillimeter(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)} mm`
    : "";
}

function formatWeight(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)} g`
    : "";
}

function textRow(label: string, value: string | null | undefined): ProductArchiveSpecRow | null {
  const safeValue = String(value || "").trim();
  return safeValue ? { label, value: safeValue } : null;
}

function compactRows(
  rows: Array<ProductArchiveSpecRow | null>
): ProductArchiveSpecRow[] {
  return rows.filter((row): row is ProductArchiveSpecRow => Boolean(row));
}

function workSpecGroups(
  work: DemoMakerProduct,
  maker: DemoMakerStudio
): ProductArchiveSpecGroups {
  return {
    basic: compactRows([
      textRow("斗师 / 工作室", displayedName(maker.name)),
      textRow("城市 / 地区", maker.region),
      textRow("斗型", work.shape),
      textRow("状态", work.availability === "available" ? "在售" : "已售参考"),
    ]),
    materials: compactRows([
      textRow("表面工艺", work.finish),
      textRow("斗钵材质", work.bowlMaterial),
      textRow("斗嘴材质", work.stemMaterial),
      textRow("滤芯", work.filterSpec),
    ]),
    dimensions: compactRows([
      textRow("重量", formatWeight(work.weightGrams)),
      textRow("长度", formatMillimeter(work.lengthMillimeters)),
      textRow("高度", formatMillimeter(work.bowlHeightMillimeters)),
      textRow("烟室内径", formatMillimeter(work.chamberDiameterMillimeters)),
      textRow("烟室深度", formatMillimeter(work.chamberDepthMillimeters)),
      textRow("斗钵外径", formatMillimeter(work.bowlWidthMillimeters)),
    ]),
  };
}

function buildMakerHref(slug: string) {
  return `/domestic-makers/${slug}?demo=1`;
}

function consultationHref(
  makerSlug: string,
  workId: string,
  returnTo: string
) {
  const params = new URLSearchParams({
    makerSlug,
    workId,
    demo: "1",
    returnTo,
  });
  return `/request?${params.toString()}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug, workId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (firstParam(resolvedSearchParams.demo) !== "1") return {};

  const maker = getDemoMakerOrStudioBySlug(slug);
  const work = getDemoMakerProduct(workId);
  if (!maker || !work || work.makerSlug !== maker.slug) return {};

  return {
    title: `${work.nameZh}｜示例国内作品｜烟斗派 YandouBuy`,
    robots: { index: false, follow: false },
  };
}

export default async function DemoMakerWorkDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug, workId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (firstParam(resolvedSearchParams.demo) !== "1") notFound();

  const maker = getDemoMakerOrStudioBySlug(slug);
  const work = getDemoMakerProduct(workId);
  if (!maker || !work || work.makerSlug !== maker.slug) notFound();

  const initialImageIndex = Number.parseInt(firstParam(resolvedSearchParams.img), 10);
  const safeInitialImageIndex = Number.isFinite(initialImageIndex)
    ? initialImageIndex
    : 0;
  const fallbackHref = buildMakerHref(maker.slug);
  const rawReturnTo = firstParam(resolvedSearchParams.returnTo).trim();
  const price = Number.isFinite(work.demoReferencePrice) && work.demoReferencePrice > 0
    ? `示例参考价 ¥${work.demoReferencePrice.toLocaleString("zh-CN")}`
    : "";
  const specGroups = workSpecGroups(work, maker);
  const profileTitle = maker.kind === "maker" ? "斗师档案" : "工作室档案";
  const profileEyebrow = maker.kind === "maker" ? "MAKER PROFILE" : "STUDIO PROFILE";
  const profileLinkText = maker.kind === "maker" ? "查看斗师档案" : "查看工作室档案";
  const typeLabel = maker.kind === "maker" ? "斗师" : "工作室";
  const makerName = displayedName(maker.name);

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

      <div className="mx-auto max-w-[1240px] px-4 pb-12 pt-[18px] sm:px-6 lg:px-8 lg:pt-7">
        <ProductBackButton
          productId={work.id}
          fallbackHref={fallbackHref}
          returnScope="maker-work"
          ariaLabel="返回"
          className="mb-[14px] inline-flex h-8 w-8 items-center justify-center bg-transparent text-[var(--coffee-dark)] transition-colors hover:text-[var(--brass)] active:text-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">返回</span>
        </ProductBackButton>

        <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.16fr)_minmax(360px,0.84fr)] lg:items-start lg:gap-12">
          <div className="min-w-0 lg:sticky lg:top-[88px] lg:self-start">
            <ProductGallery
              productId={work.id}
              name={work.nameZh}
              imageUrl={work.images[0] || ""}
              galleryImages={work.images}
              initialIndex={safeInitialImageIndex}
            />
          </div>

          <div>
            <p className="inline-flex flex-col text-[11px] font-medium leading-[1.3] tracking-[0.16em] text-[var(--brass)]">
              示例作品
              <span className="mt-2 h-px w-7 bg-[var(--brass)]" aria-hidden="true" />
            </p>

            <h1 className="mt-[10px] break-words text-[20px] font-medium leading-[1.4] tracking-normal text-[var(--text-primary)] lg:text-[28px]">
              {work.nameZh}
            </h1>
            <Link
              href={fallbackHref}
              className="mt-3 inline-flex text-[11.5px] font-normal leading-[1.55] text-[var(--text-secondary)] transition-colors hover:text-[var(--brass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)]"
            >
              {makerName}
            </Link>

            <section className="mt-5 border-y border-[var(--border)] py-4">
              <div className="flex items-center justify-between gap-4">
                {price ? (
                  <p className="text-[20px] font-medium leading-[1.3] text-[var(--text-primary)]">
                    {price}
                  </p>
                ) : null}
                <p
                  className={`${price ? "shrink-0" : ""} text-[12px] font-normal leading-[1.4] text-[var(--text-secondary)]`}
                >
                  {work.availability === "available" ? "在售" : "已售参考"}
                </p>
              </div>
              <Link
                href={consultationHref(
                  maker.slug,
                  work.id,
                  rawReturnTo || fallbackHref
                )}
                className="mt-4 flex h-[46px] items-center justify-center rounded-[4px] bg-[#2A1710] px-5 text-[13.5px] font-medium tracking-[0.02em] text-[#f4eee7] transition-colors hover:bg-[var(--coffee)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
              >
                咨询这件作品
              </Link>
              <p className="mt-3 text-left text-[11px] font-normal leading-[1.6] text-[var(--text-secondary)]">
                作品信息、参考价格与可咨询状态由人工确认。
              </p>
            </section>
          </div>
        </section>

        <section className="mt-8 border-t border-[var(--border)] pt-[9px] lg:mt-10 lg:pt-6">
          <ProductArchive groups={specGroups} />
        </section>

        <section className="mt-8 rounded-[6px] bg-[#f3ece3] p-5 lg:mt-10 lg:grid lg:grid-cols-[minmax(150px,0.28fr)_minmax(0,1fr)] lg:items-center lg:gap-8">
          <p className="text-[9.5px] font-normal uppercase tracking-[0.16em] text-[var(--brass)]">
            {profileEyebrow}
          </p>
          <div className="mt-4 lg:col-start-1 lg:row-start-2 lg:mt-0">
            {maker.coverImage ? (
              <div className="flex h-16 items-center">
                <img
                  src={maker.coverImage}
                  alt={`${makerName} ${profileTitle}`}
                  className="h-16 w-full max-w-[150px] rounded-[4px] object-cover object-center"
                />
              </div>
            ) : (
              <div className="flex h-16 max-w-[150px] items-center rounded-[4px] border border-[rgba(126,105,87,0.16)] bg-[#ece3d6] px-3 text-[14px] font-medium leading-[1.3] text-[var(--coffee-dark)]">
                {makerName}
              </div>
            )}
          </div>
          <div className="mt-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
            <h2 className="text-[17px] font-medium leading-[1.4] text-[var(--text-primary)]">
              {profileTitle}
            </h2>
            <p className="mt-1 text-[11px] font-normal leading-[1.4] text-[var(--brass)]">
              {makerName} · {typeLabel} · {maker.region}
            </p>
            <p className="mt-3 line-clamp-3 text-[12px] font-normal leading-[1.75] text-[var(--text-secondary)]">
              {maker.intro}
            </p>
            <Link
              href={fallbackHref}
              className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--coffee)] underline decoration-[var(--brass)] underline-offset-4 transition-colors hover:text-[var(--brass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brass)] [font-family:inherit]"
            >
              {profileLinkText}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </div>

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
