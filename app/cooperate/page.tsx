import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import WeChatContactCard from "../components/contact/WeChatContactCard";
import CooperationCopyButton from "./CooperationCopyButton";

const cooperationTargets = [
  {
    title: "斗师 / 工作室",
    description:
      "展示作品、创作方向与联系入口，让更多真正关注烟斗的人看见。",
  },
  {
    title: "品牌方 / 代理商",
    description:
      "整理品牌资料、公开库存与代表系列，建立清晰稳定的展示入口。",
  },
  {
    title: "回流渠道 / 内容伙伴",
    description:
      "围绕优质回流作品、专题内容与行业资料开展长期合作。",
  },
];

const displayForms = [
  ["作品展示", "斗师与工作室主页、作品集和故事。"],
  ["库存展示", "海外及国内公开库存的结构化呈现。"],
  ["品牌专题", "品牌资料、代表系列与长期内容整理。"],
  ["内容合作", "专题文章、视频、活动与联合传播。"],
];

const advantages = [
  ["垂直定位", "专注烟斗产品、品牌与作品内容。"],
  ["人工整理", "公开信息经过人工筛选与结构化呈现。"],
  ["体系互通", "产品库、品牌页和斗师作品页相互连接。"],
  ["咨询闭环", "从浏览、比较到微信咨询保持清晰连贯。"],
];

const cooperationSteps = [
  ["01", "提交意向"],
  ["02", "沟通方向"],
  ["03", "确认资料"],
  ["04", "上线展示"],
];

export default function CooperationPage() {
  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto w-full max-w-[760px] px-4 pb-10 sm:px-6">
        <div className="flex h-10 items-center">
          <Link
            href="/"
            aria-label="返回首页"
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

        <header className="relative h-[194px] overflow-hidden rounded-[6px] bg-[var(--coffee-dark)] sm:h-[250px]">
          <img
            src="/pics/cooperation-hero.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[rgba(34,20,13,0.9)] via-[rgba(34,20,13,0.58)] to-[rgba(34,20,13,0.04)]" />

          <div className="relative flex h-full max-w-[74%] flex-col justify-end px-5 pb-5 sm:max-w-[62%] sm:px-7 sm:pb-7">
            <p className="text-[9.5px] font-medium uppercase leading-[1.4] tracking-[0.18em] text-[var(--brass)]">
              COOPERATION
            </p>

            <h1 className="mt-2 text-[18px] font-medium leading-[1.28] tracking-[-0.018em] text-[#f4eee7] sm:text-[21px]">
              让优质烟斗作品，被真正需要的人看见
            </h1>

            <p className="mt-2.5 text-[10.5px] font-normal leading-[1.58] text-[rgba(244,238,231,0.78)] sm:text-[11.5px]">
              整理公开库存、品牌资料与国内斗师作品，为玩家提供更清晰的浏览与咨询入口。
            </p>
          </div>
        </header>

        <section className="border-b border-[var(--border)] py-6">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--brass)]">
            PARTNERS
          </p>

          <h2 className="mt-1.5 text-[17px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
            合作对象
          </h2>

          <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {cooperationTargets.map((item, index) => (
              <div
                key={item.title}
                className="grid grid-cols-[30px_1fr] gap-3 py-4"
              >
                <span className="pt-0.5 text-[9.5px] font-medium tracking-[0.1em] text-[var(--brass)]">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <div>
                  <h3 className="text-[13px] font-medium leading-[1.45] text-[var(--coffee-dark)]">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-[11px] font-normal leading-[1.65] text-[var(--text-secondary)]">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--border)] py-6">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--brass)]">
            DISPLAY
          </p>

          <h2 className="mt-1.5 text-[17px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
            展示方式
          </h2>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {displayForms.map(([title, description]) => (
              <article
                key={title}
                className="rounded-[5px] border border-[rgba(126,105,87,0.18)] bg-white px-3.5 py-3.5"
              >
                <h3 className="text-[12px] font-medium leading-[1.45] text-[var(--coffee-dark)]">
                  {title}
                </h3>
                <p className="mt-1.5 text-[10.5px] font-normal leading-[1.6] text-[var(--text-secondary)]">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--border)] py-6">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--brass)]">
            WHY YANDOUBUY
          </p>

          <h2 className="mt-1.5 text-[17px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
            为什么选择烟斗派
          </h2>

          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {advantages.map(([title, description]) => (
              <div key={title}>
                <h3 className="text-[12px] font-medium leading-[1.45] text-[var(--coffee-dark)]">
                  {title}
                </h3>
                <p className="mt-1 text-[10.5px] font-normal leading-[1.6] text-[var(--text-secondary)]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--border)] py-6">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--brass)]">
            PROCESS
          </p>

          <h2 className="mt-1.5 text-[17px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
            合作流程
          </h2>

          <div className="mt-4 grid grid-cols-4 border-y border-[var(--border)] py-4">
            {cooperationSteps.map(([index, label]) => (
              <div
                key={index}
                className="border-r border-[rgba(222,212,200,0.72)] px-1.5 text-center last:border-r-0"
              >
                <span className="block text-[9px] font-medium tracking-[0.1em] text-[var(--brass)]">
                  {index}
                </span>
                <span className="mt-1.5 block text-[10px] font-normal leading-[1.4] text-[var(--text-secondary)]">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="py-6">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--brass)]">
            GET IN TOUCH
          </p>

          <h2 className="mt-1.5 text-[17px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
            提交合作意向
          </h2>

          <p className="mt-2 text-[11px] font-normal leading-[1.65] text-[var(--text-secondary)]">
            复制基础合作信息后，通过微信补充您的身份、资料和希望合作的方向。
          </p>

          <div className="mt-4">
            <CooperationCopyButton />
          </div>
        </section>

        <WeChatContactCard />

        <p className="mt-5 text-[10px] font-normal leading-[1.7] text-[#93867b]">
          页面展示与合作方式会根据资料完整度、内容边界和双方沟通结果人工确认。
        </p>
      </div>
    </main>
  );
}
