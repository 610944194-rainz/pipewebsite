import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import EditorialHero from "../components/page/EditorialHero";
import PageBackBar from "../components/page/PageBackBar";

const suitableFor = [
  "第一次认真选斗",
  "为现有收藏补充一把",
  "已有方向，不想反复筛选",
  "需要核对尺寸、状态与价格",
] as const;

const processSteps = [
  {
    index: "01",
    title: "提交需求",
    description: "说明预算、斗型与使用偏好。",
  },
  {
    index: "02",
    title: "人工筛选",
    description: "从库存与市场中缩小范围。",
  },
  {
    index: "03",
    title: "核对细节",
    description: "确认尺寸、状态、配件与价格。",
  },
  {
    index: "04",
    title: "确认委托",
    description: "说清费用与周期后再开始。",
  },
] as const;

function SectionNumber({ children }: { children: string }) {
  return (
    <span className="pt-[2px] text-[10px] font-medium leading-none tracking-[0.12em] text-[var(--brass)]">
      {children}
    </span>
  );
}

function CompactFooter() {
  return (
    <footer className="mt-8 border-t border-[rgba(222,212,200,0.72)]">
      <div className="mx-auto max-w-[720px] px-5 py-6 sm:px-6">
        <img
          src="/pics/yandoubuy-logo-header.png"
          alt="烟斗派 YandouBuy"
          className="h-auto w-[132px] object-contain object-left mix-blend-multiply"
        />
        <p className="mt-3 max-w-[420px] text-[10.5px] font-normal leading-[1.55] text-[var(--text-secondary)]">
          仅展示烟斗器具公开信息，价格与库存需在确认委托前重新核对。
        </p>
        <p className="mt-4 text-[10px] leading-none text-[#94877c]">
          © 2026 烟斗派 YandouBuy
        </p>
      </div>
    </footer>
  );
}

export default function ServicePage() {
  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />
      <PageBackBar />

      <div className="mx-auto max-w-[1240px] px-4 pb-10 pt-1 sm:px-6 lg:px-10">
        <EditorialHero
          imageSrc="/pics/service-sourcing-head.png"
          imageAlt="两把烟斗置于暖色木桌上的静物画面"
          eyebrow="CURATED SOURCING"
          title="选品服务"
          description="把模糊的偏好，整理成几把真正值得看的烟斗。"
          imagePosition="58% 50%"
        />

        <div className="mx-auto max-w-[720px]">

        <div className="mt-6 border-t border-[var(--border)]">
          <section className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 border-b border-[var(--border)] py-5">
            <SectionNumber>01</SectionNumber>
            <div>
              <h2 className="text-[16px] font-medium leading-[1.2] tracking-[-0.02em] text-[var(--coffee-dark)]">
                我们会做什么
              </h2>
              <p className="mt-2 max-w-[560px] text-[12.5px] font-normal leading-[1.55] text-[var(--text-secondary)]">
                根据预算、斗型、尺寸、品牌与使用习惯，筛出少量候选，并直接说明每一把的差异与取舍。
              </p>
            </div>
          </section>

          <section className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 border-b border-[var(--border)] py-5">
            <SectionNumber>02</SectionNumber>
            <div>
              <h2 className="text-[16px] font-medium leading-[1.2] tracking-[-0.02em] text-[var(--coffee-dark)]">
                适合这些需求
              </h2>
              <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5">
                {suitableFor.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[11.5px] font-normal leading-[1.45] text-[var(--text-secondary)]"
                  >
                    <span aria-hidden="true" className="mt-[7px] h-px w-2 shrink-0 bg-[var(--brass)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 border-b border-[var(--border)] py-5">
            <SectionNumber>03</SectionNumber>
            <div>
              <h2 className="text-[16px] font-medium leading-[1.2] tracking-[-0.02em] text-[var(--coffee-dark)]">
                服务流程
              </h2>
              <ol className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 sm:gap-x-4">
                {processSteps.map((step) => (
                  <li key={step.index} className="border-t border-[rgba(168,120,62,0.55)] pt-2.5">
                    <span className="text-[9.5px] font-medium leading-none tracking-[0.08em] text-[var(--brass)]">
                      {step.index}
                    </span>
                    <h3 className="mt-1.5 text-[12.5px] font-medium leading-[1.3] text-[var(--coffee-dark)]">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-[10.5px] font-normal leading-[1.45] text-[var(--text-secondary)]">
                      {step.description}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 border-b border-[var(--border)] py-5">
            <SectionNumber>04</SectionNumber>
            <div>
              <h2 className="text-[16px] font-medium leading-[1.2] tracking-[-0.02em] text-[var(--coffee-dark)]">
                服务边界
              </h2>
              <p className="mt-2 max-w-[560px] text-[12.5px] font-normal leading-[1.55] text-[var(--text-secondary)]">
                只提供烟斗器具的选品、信息整理与委托协助。费用与周期会在确认前一次说明清楚，不临时增加项目。
              </p>
            </div>
          </section>
        </div>

        <div className="py-6">
          <Link
            href="/request?source=service"
            className="group flex h-11 w-full items-center justify-between rounded-[4px] bg-[var(--coffee-dark)] px-4 text-[13px] font-medium tracking-[0.02em] text-[#f7f1e8] transition-colors hover:bg-[var(--coffee)] motion-reduce:transition-none"
          >
            <span>提交找斗需求</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            >
              <path
                d="M5 12h13M13.5 6.5 19 12l-5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <p className="mt-2 text-center text-[10.5px] font-normal leading-[1.4] text-[var(--text-secondary)]">
            从清楚说明需求开始，不急着做决定。
          </p>
        </div>
      </div>
      </div>

      <CompactFooter />
    </main>
  );
}
