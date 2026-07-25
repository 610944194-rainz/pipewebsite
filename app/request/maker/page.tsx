import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import WeChatContactCard from "../../components/contact/WeChatContactCard";
import { getDemoMakerOrStudioBySlug } from "../../../lib/demo/maker-studio-fixtures";
import MakerInquiryCopyButton from "./MakerInquiryCopyButton";

type MakerInquiryPageProps = {
  searchParams?: Promise<{
    makerSlug?: string | string[];
  }>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanMakerName(value: string) {
  return value
    .replace(/^示例斗师\s*·\s*/, "")
    .replace(/^示例工作室\s*·\s*/, "")
    .trim();
}

export default async function MakerInquiryPage({
  searchParams,
}: MakerInquiryPageProps) {
  const params = searchParams ? await searchParams : {};
  const makerSlug = firstValue(params.makerSlug);
  const maker = makerSlug
    ? getDemoMakerOrStudioBySlug(makerSlug)
    : null;

  if (!maker) {
    notFound();
  }

  const makerName = cleanMakerName(maker.name);
  const makerType = maker.kind === "studio" ? "烟斗工作室" : "独立斗师";
  const detailPath = `/domestic-makers/${maker.slug}?demo=1`;
  const image = maker.coverImage || maker.heroImage || "";

  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto w-full max-w-[760px] px-5 pb-10 sm:px-7">
        <div className="flex h-10 items-center">
          <Link
            href={detailPath}
            aria-label={`返回${makerName}详情页`}
            className="-ml-2 inline-flex h-9 w-9 items-center justify-center text-[var(--coffee-dark)] transition-colors hover:text-[var(--brass)]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="h-[20px] w-[20px]"
            >
              <path
                d="M15.5 5.5 9 12l6.5 6.5M9.5 12H20"
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>

        <header className="border-b border-[var(--border)] pb-5 pt-1">
          <p className="text-[9.5px] font-medium uppercase leading-[1.4] tracking-[0.18em] text-[var(--brass)]">
            MAKER INQUIRY
          </p>

          <h1 className="mt-2 text-[24px] font-medium leading-[1.15] tracking-[-0.03em] text-[var(--coffee-dark)]">
            咨询{makerName}的烟斗作品
          </h1>

          <p className="mt-3 text-[12px] font-normal leading-[1.65] text-[var(--text-secondary)]">
            已整理当前咨询对象的信息，复制后发送到微信即可。
          </p>
        </header>

        <section className="border-b border-[var(--border)] py-5">
          <div className="flex items-start gap-4">
            {image ? (
              <div className="relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[5px] border border-[rgba(126,105,87,0.18)] bg-white">
                <img
                  src={image}
                  alt={`${makerName}工作室场景`}
                  className="h-full w-full object-cover object-center"
                />
              </div>
            ) : null}

            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[9.5px] font-medium uppercase tracking-[0.15em] text-[var(--brass)]">
                {makerType}
              </p>

              <h2 className="mt-1.5 text-[18px] font-medium leading-[1.35] text-[var(--coffee-dark)]">
                {makerName}
              </h2>

              <p className="mt-1 text-[11.5px] leading-[1.5] text-[var(--text-secondary)]">
                {maker.region}
              </p>

              <p className="mt-2 text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
                {maker.intro}
              </p>
            </div>
          </div>
        </section>

        <section className="py-5">
          <h2 className="text-[16px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
            咨询凭证
          </h2>

          <dl className="mt-3 border-y border-[var(--border)]">
            <div className="grid grid-cols-[92px_1fr] gap-4 border-b border-[var(--border)] py-3">
              <dt className="text-[11px] text-[var(--text-secondary)]">
                咨询对象
              </dt>
              <dd className="text-[12px] text-[var(--text-primary)]">
                {makerName}
              </dd>
            </div>

            <div className="grid grid-cols-[92px_1fr] gap-4 border-b border-[var(--border)] py-3">
              <dt className="text-[11px] text-[var(--text-secondary)]">
                身份类型
              </dt>
              <dd className="text-[12px] text-[var(--text-primary)]">
                {makerType}
              </dd>
            </div>

            <div className="grid grid-cols-[92px_1fr] gap-4 border-b border-[var(--border)] py-3">
              <dt className="text-[11px] text-[var(--text-secondary)]">
                工作地点
              </dt>
              <dd className="text-[12px] text-[var(--text-primary)]">
                {maker.region}
              </dd>
            </div>

            <div className="grid grid-cols-[92px_1fr] gap-4 py-3">
              <dt className="text-[11px] text-[var(--text-secondary)]">
                作品页面
              </dt>
              <dd className="break-all text-[11.5px] text-[var(--text-primary)]">
                {detailPath}
              </dd>
            </div>
          </dl>

          <MakerInquiryCopyButton
            makerName={makerName}
            makerType={makerType}
            makerRegion={maker.region}
            makerPath={detailPath}
          />

          <p className="mt-2 text-center text-[10.5px] leading-[1.5] text-[#95877b]">
            复制后发送到微信，也可以直接截图本页。
          </p>
        </section>

        <WeChatContactCard className="mt-2" />

        <aside className="mt-6 border-t border-[var(--border)] pt-4 text-[10.5px] leading-[1.7] text-[#93867b]">
          作品库存、定制可行性、制作周期及最终价格均由人工确认。
        </aside>
      </div>
    </main>
  );
}
