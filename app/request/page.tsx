import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import { siteConfig } from "../../data/site";
import WeChatContactCard from "../components/contact/WeChatContactCard";
import RequestFormController from "./RequestFormController";

const inputClass =
  "mt-2 h-[44px] w-full rounded-[4px] border border-[rgba(126,105,87,0.22)] bg-white px-3.5 text-[12.5px] font-normal text-[var(--text-primary)] outline-none transition-colors placeholder:text-[#a3978c] focus:border-[var(--brass)] focus:ring-1 focus:ring-[var(--brass)]";

const labelClass =
  "block text-[11px] font-medium leading-[1.4] text-[var(--coffee-dark)]";

export default function RequestPage() {
  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto w-full max-w-[760px] px-5 pb-10 sm:px-7">
        <div className="flex h-[46px] items-center">
          <Link
            href="/service"
            aria-label="返回服务说明"
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
            PIPE REQUEST
          </p>
          <h1 className="mt-2 text-[26px] font-medium leading-[1.1] tracking-[-0.035em] text-[var(--coffee-dark)]">
            帮我找一把斗
          </h1>
          <p className="mt-3 max-w-[520px] text-[12.5px] font-normal leading-[1.6] text-[var(--text-secondary)]">
            填写预算和使用偏好，我们会从公开库存中人工筛选，再通过微信确认具体选择。
          </p>
        </header>

        <section
          aria-label="找斗流程"
          className="grid grid-cols-3 border-b border-[var(--border)] py-4"
        >
          {[
            ["01", "填写偏好"],
            ["02", "人工筛选"],
            ["03", "微信确认"],
          ].map(([index, label]) => (
            <div
              key={index}
              className="border-r border-[rgba(222,212,200,0.72)] px-2 text-center last:border-r-0"
            >
              <span className="block text-[9px] font-medium tracking-[0.12em] text-[var(--brass)]">
                {index}
              </span>
              <span className="mt-1 block text-[10.5px] font-normal leading-[1.4] text-[var(--text-secondary)]">
                {label}
              </span>
            </div>
          ))}
        </section>

        <form
          id="pipe-request-form"
          className="pt-6"
          data-wechat-id={siteConfig.wechatId}
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[17px] font-medium leading-[1.35] text-[var(--coffee-dark)]">
              找斗需求
            </h2>
            <p className="text-[10px] font-normal text-[var(--text-secondary)]">
              <span className="text-[var(--brass)]">*</span> 为必填
            </p>
          </div>

          <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <label className={labelClass}>
              预算范围 <span className="text-[var(--brass)]">*</span>
              <input
                id="request-budget"
                name="budget"
                required
                type="text"
                autoComplete="off"
                placeholder="例如：¥2,000–3,000"
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              新斗 / 回流斗
              <select
                id="request-condition"
                name="condition"
                defaultValue="新斗、回流斗都可以"
                className={inputClass}
              >
                <option>新斗、回流斗都可以</option>
                <option>只看新斗</option>
                <option>可以接受回流斗</option>
                <option>主要考虑回流斗</option>
              </select>
            </label>

            <label className={labelClass}>
              品牌偏好
              <input
                id="request-brand"
                name="brand"
                type="text"
                autoComplete="off"
                placeholder="没有可留空"
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              斗型偏好
              <input
                id="request-shape"
                name="shape"
                type="text"
                autoComplete="off"
                placeholder="例如：直式撞球、苹果、弯斗"
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              重量偏好
              <select
                id="request-weight"
                name="weight"
                defaultValue="没有明确限制"
                className={inputClass}
              >
                <option>没有明确限制</option>
                <option>尽量轻便，40g 以内</option>
                <option>40–55g 都可以</option>
                <option>不介意偏重</option>
              </select>
            </label>

            <label className={labelClass}>
              滤芯偏好
              <select
                id="request-filter"
                name="filter"
                defaultValue="没有明确限制"
                className={inputClass}
              >
                <option>没有明确限制</option>
                <option>偏好 9mm 滤芯</option>
                <option>偏好 6mm 滤芯</option>
                <option>偏好无滤芯</option>
              </select>
            </label>

            <label className={labelClass}>
              使用经验
              <select
                id="request-experience"
                name="experience"
                defaultValue="刚开始接触烟斗"
                className={inputClass}
              >
                <option>刚开始接触烟斗</option>
                <option>已有几把斗，想继续升级</option>
                <option>有一定经验，偏重使用表现</option>
                <option>收藏与作品取向</option>
              </select>
            </label>

            <label className={labelClass}>
              使用侧重
              <select
                id="request-priority"
                name="priority"
                defaultValue="日常使用与易维护"
                className={inputClass}
              >
                <option>日常使用与易维护</option>
                <option>轻便舒适</option>
                <option>品牌辨识度</option>
                <option>木纹与工艺表现</option>
                <option>收藏价值</option>
              </select>
            </label>
          </div>

          <label className={`${labelClass} mt-5`}>
            补充说明
            <textarea
              id="request-note"
              name="note"
              rows={4}
              placeholder="例如：不想太重、希望好清理、喜欢克制的经典造型……"
              className="mt-2 w-full resize-y rounded-[4px] border border-[rgba(126,105,87,0.22)] bg-white px-3.5 py-3 text-[12.5px] font-normal leading-[1.65] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[#a3978c] focus:border-[var(--brass)] focus:ring-1 focus:ring-[var(--brass)]"
            />
          </label>

          <div className="mt-6 border-y border-[var(--border)] py-5">
            <button
              id="copy-pipe-request"
              type="submit"
              className="flex h-[44px] w-full items-center justify-center rounded-[4px] bg-[var(--coffee-dark)] px-5 text-[13px] font-medium tracking-[0.02em] text-[#f7f1e8] transition-colors hover:bg-[var(--coffee)] active:bg-[#160d09]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="mr-2 h-[16px] w-[16px]"
              >
                <rect
                  x="8"
                  y="8"
                  width="10"
                  height="11"
                  rx="1.8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M15 8V6.8A1.8 1.8 0 0 0 13.2 5H6.8A1.8 1.8 0 0 0 5 6.8v8.4A1.8 1.8 0 0 0 6.8 17H8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <span id="copy-pipe-request-label">生成并复制找斗需求</span>
            </button>

            <p className="mt-2 text-center text-[10.5px] font-normal leading-[1.4] text-[#95877b]">
              复制后发送到微信，也可以直接截图需求摘要。
            </p>
          </div>
        </form>

        <section
          id="pipe-request-result"
          aria-live="polite"
          className="hidden pt-6"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[15px] font-medium leading-[1.35] text-[var(--coffee-dark)]">
              已生成的需求
            </h2>
            <span className="text-[10px] font-normal text-[var(--brass)]">
              可直接发送
            </span>
          </div>
          <pre
            id="pipe-request-preview"
            className="mt-3 whitespace-pre-wrap border-y border-[var(--border)] py-4 text-[11.5px] font-normal leading-[1.7] text-[var(--text-secondary)] [font-family:inherit]"
          />
        </section>

        <aside className="mt-7 text-[10.5px] font-normal leading-[1.7] text-[#93867b]">
          页面不会直接生成订单或收取费用。库存、最终价格、国际运费及预计税费均由人工确认。
        </aside>
      </div>


        <WeChatContactCard className="mx-auto mt-6 w-full max-w-[760px] px-5 sm:px-7" />

      <footer className="border-t border-[rgba(222,212,200,0.78)] bg-[#f2ece3]">
        <div className="mx-auto max-w-[760px] px-5 py-5 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className="h-auto w-[118px] object-contain object-left mix-blend-multiply"
            />
            <p className="text-right text-[9.5px] font-normal leading-[1.45] text-[#8d8075]">
              人工选品 · 信息整理 · 微信确认
            </p>
          </div>
          <div className="mt-3 border-t border-[rgba(222,212,200,0.78)] pt-3 text-[9.5px] font-normal leading-[1.45] text-[#95887d]">
            © 2026 烟斗派 YandouBuy
          </div>
        </div>
      </footer>

      <RequestFormController />
    </main>
  );
}
