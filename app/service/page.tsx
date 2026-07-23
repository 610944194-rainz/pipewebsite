import Image from "next/image";
import Link from "next/link";
import BackButton from "../components/BackButton";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";

const needs = [
  "第一次认真选斗",
  "想为现有收藏补充一把",
  "已有明确方向，但不想反复筛选",
  "需要核对尺寸、状态与价格差异",
];

const steps = [
  { number: "01", title: "提交需求", description: "填写找斗需求，告诉我们你的偏好" },
  { number: "02", title: "人工筛选", description: "结合库存与市场，筛出少量合适候选" },
  { number: "03", title: "核对细节", description: "确认尺寸、状态、配件与价格等信息" },
  { number: "04", title: "确认委托", description: "确认服务费用与周期，开始为你留意" },
];

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="text-[15px] font-normal tracking-[0.08em] text-[var(--brass)]">{number}</span>
      <h2 className="text-[17px] font-medium leading-[1.4] text-[var(--text-primary)]">{title}</h2>
    </div>
  );
}

function BackArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.7" cy="10.7" r="5.9" stroke="currentColor" strokeWidth="1.35" />
      <path d="m15.3 15.3 4 4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function PersonIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M5.3 19.2c.5-3.2 2.8-5 6.7-5s6.2 1.8 6.7 5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.2" y="5.6" width="15.6" height="14" rx="1.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M7.5 3.8v3.6M16.5 3.8v3.6M4.2 10h15.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.8 19.2 7v4.4c0 4.2-2.7 7.3-7.2 8.8-4.5-1.5-7.2-4.6-7.2-8.8V7L12 3.8Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}

function ServiceIconFrame({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[rgba(168,120,62,0.18)] text-[var(--brass)] sm:h-14 sm:w-14">
      {children}
    </span>
  );
}

export default function ServicePage() {
  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-[960px] px-4 pb-10 sm:px-6 sm:pb-12 lg:px-10 lg:pb-14">
        <div className="flex h-12 items-center">
          <BackButton
            fallbackHref="/"
            className="inline-flex h-9 w-9 items-center justify-center text-[var(--coffee-dark)] transition-colors hover:text-[var(--brass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]"
          >
            <BackArrowIcon className="h-5 w-5" />
            <span className="sr-only">返回上一页</span>
          </BackButton>
        </div>

        <header className="pb-6 pt-4 sm:pb-7 sm:pt-5">
          <p className="text-[10px] font-normal tracking-[0.2em] text-[var(--brass)]">CURATED SOURCING</p>
          <h1 className="mt-3 text-[30px] font-medium leading-[1.22] tracking-[-0.02em] text-[var(--coffee-dark)] sm:text-[32px]">选品服务</h1>
          <span className="mt-4 block h-px w-10 bg-[var(--brass)]" />
          <p className="mt-4 max-w-[310px] text-[13px] font-normal leading-[1.55] text-[var(--text-primary)] sm:text-[13.5px]">
            把模糊的偏好，<br />
            整理成几把真正值得看的烟斗。
          </p>
        </header>

        <section className="relative aspect-[3/2] overflow-hidden rounded-[5px] bg-[var(--coffee-dark)]" aria-label="选品服务静物图">
          <Image
            src="/pics/service-sourcing-head.png"
            alt="木质桌面上的两把烟斗"
            fill
            priority
            sizes="(max-width: 1023px) calc(100vw - 32px), 880px"
            className="object-cover"
          />
        </section>

        <div className="mt-6 grid gap-3 sm:mt-7 sm:gap-4">
          <section className="border border-[rgba(131,101,73,0.16)] bg-[rgba(255,253,248,0.38)] p-4 sm:p-5">
            <div className="flex gap-4 sm:gap-5">
              <ServiceIconFrame><SearchIcon className="h-6 w-6" /></ServiceIconFrame>
              <div className="min-w-0 pt-0.5">
                <SectionHeading number="01" title="我们会做什么" />
                <p className="mt-3 text-[12.5px] leading-[1.55] text-[var(--text-secondary)]">
                  根据预算、斗型、尺寸、品牌与使用习惯，筛选少量候选，并说明每一把的差异与取舍。
                </p>
              </div>
            </div>
          </section>

          <section className="border border-[rgba(131,101,73,0.16)] bg-[rgba(255,253,248,0.38)] p-4 sm:p-5">
            <div className="flex gap-4 sm:gap-5">
              <ServiceIconFrame><PersonIcon className="h-6 w-6" /></ServiceIconFrame>
              <div className="min-w-0 pt-0.5">
                <SectionHeading number="02" title="适合这些需求" />
                <ul className="mt-3 grid gap-1.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
                  {needs.map((need) => (
                    <li key={need} className="relative pl-3 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-[var(--brass)]">{need}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="border border-[rgba(131,101,73,0.16)] bg-[rgba(255,253,248,0.38)] p-4 sm:p-5">
            <div className="flex gap-4 sm:gap-5">
              <ServiceIconFrame><CalendarIcon className="h-6 w-6" /></ServiceIconFrame>
              <div className="min-w-0 flex-1 pt-0.5">
                <SectionHeading number="03" title="服务流程" />
                <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 sm:gap-x-3">
                  {steps.map((step) => (
                    <li key={step.number} className="relative border-t border-[rgba(168,120,62,0.45)] pt-3 sm:pt-4">
                      <span className="absolute -top-3 left-0 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--brass)] bg-[var(--page-background)] text-[10px] font-medium text-[var(--coffee-dark)] sm:-top-3.5 sm:h-7 sm:w-7">{step.number}</span>
                      <h3 className="mt-2 text-[12px] font-medium leading-[1.4] text-[var(--text-primary)]">{step.title}</h3>
                      <p className="mt-1.5 text-[11px] leading-[1.5] text-[var(--text-secondary)]">{step.description}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          <section className="border border-[rgba(131,101,73,0.16)] bg-[rgba(255,253,248,0.38)] p-4 sm:p-5">
            <div className="flex gap-4 sm:gap-5">
              <ServiceIconFrame><ShieldIcon className="h-6 w-6" /></ServiceIconFrame>
              <div className="min-w-0 pt-0.5">
                <SectionHeading number="04" title="服务边界" />
                <p className="mt-3 text-[12.5px] leading-[1.55] text-[var(--text-secondary)]">
                  只提供烟斗器具的选品、信息整理与委托协助。报价与服务费用会在确认前一次说明清楚，不临时增加项目。
                </p>
              </div>
            </div>
          </section>
        </div>

        <section className="mx-auto mt-6 max-w-[620px] text-center sm:mt-7">
          <Link
            href="/request?source=service"
            className="inline-flex h-12 w-full items-center justify-center rounded-[4px] bg-[#b98242] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#a67337] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--brass)] sm:w-[340px]"
          >
            提交找斗需求
          </Link>
          <p className="mt-3 text-[12px] leading-[1.45] text-[var(--text-secondary)]">即刻开始为你寻找合适的烟斗</p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
