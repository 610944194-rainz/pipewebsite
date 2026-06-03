import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";

function StepCard({
  index,
  title,
  desc,
}: {
  index: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)]">
      <p className="mb-2 text-[12px] font-semibold text-[#9A6530]">{index}</p>
      <h3 className="mb-1.5 text-[17px] font-bold text-[#2B211C]">{title}</h3>
      <p className="text-[13px] leading-6 text-[#75695F]">{desc}</p>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#F0E6D8] py-3 last:border-b-0">
      <span className="shrink-0 text-[13px] text-[#75695F]">{label}</span>
      <span className="text-right text-[13px] font-semibold leading-6 text-[#2B211C]">
        {value}
      </span>
    </div>
  );
}

function FaqCard({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <div className="rounded-[20px] border border-[#E5D7C5] bg-white p-4 shadow-[0_4px_14px_rgba(43,33,28,0.025)]">
      <h3 className="mb-1.5 text-[16px] font-bold text-[#2B211C]">
        {question}
      </h3>
      <p className="text-[13px] leading-6 text-[#75695F]">{answer}</p>
    </div>
  );
}

function BoundaryCard({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-[18px] border border-[#E5D7C5] bg-white p-4">
      <h3 className="mb-1.5 text-[16px] font-bold text-[#2B211C]">
        {title}
      </h3>
      <p className="text-[13px] leading-6 text-[#75695F]">{desc}</p>
    </div>
  );
}

export default function ServicePage() {
  return (
    <main className="min-h-screen bg-[#FAF7F0] pb-24 text-[#2B211C] sm:pb-0">
      <SiteHeader />

      <section className="px-4 pt-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-8 lg:p-10">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
              HOW IT WORKS
            </p>

            <h1 className="text-[30px] font-bold leading-[1.15] tracking-tight text-[#2B211C] sm:text-5xl">
              海外烟斗代购，
              <br />
              先确认，再决定。
            </h1>

            <p className="mt-4 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
              本站整理海外烟斗网站的公开库存信息，帮助你快速查看商品、图片、价格和参数。页面展示并不代表实时库存，实际购买前需要人工重新确认。
            </p>

            <div className="mt-5 grid gap-2.5 sm:flex sm:flex-wrap">
              <Link
                href="/products"
                className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-7 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
              >
                查看海外库存
              </Link>

              <a
                href="#contact"
                className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
              >
                咨询找斗
              </a>
            </div>
          </section>
        </div>
      </section>

      <section className="px-4 py-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
              PROCESS
            </p>

            <h2 className="text-[22px] font-bold text-[#2B211C] sm:text-3xl">
              代购流程
            </h2>
          </div>

          <div className="grid gap-3.5 md:grid-cols-4">
            <StepCard
              index="01"
              title="浏览库存"
              desc="先在商品库里查看海外公开库存，按品牌、价格、图片完整度和库存状态初步筛选。"
            />

            <StepCard
              index="02"
              title="提交意向"
              desc="选中感兴趣的烟斗后，可以发送商品链接、截图或名称，用于人工确认。"
            />

            <StepCard
              index="03"
              title="确认成本"
              desc="下单前重新确认库存、原站价格、国际运费、预计税费和服务费用。"
            />

            <StepCard
              index="04"
              title="决定购买"
              desc="确认无误后再决定是否购买。已售商品也可以作为找类似款式的参考。"
            />
          </div>
        </div>
      </section>

      <section className="px-4 pb-6 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
              COST
            </p>

            <h2 className="mb-4 text-[22px] font-bold text-[#2B211C]">
              费用构成
            </h2>

            <div>
              <InfoRow label="海外原价" value="以原站下单前实时页面为准" />
              <InfoRow label="国际运费" value="根据商家、目的地和包裹重量确认" />
              <InfoRow label="预计税费" value="根据实际申报、物流和目的地规则预估" />
              <InfoRow label="服务费" value="按商品情况、沟通成本和代购难度确认" />
              <InfoRow label="最终价格" value="下单前单独确认，不以页面采集价为最终价" />
            </div>
          </section>

          <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
              BOUNDARY
            </p>

            <h2 className="mb-4 text-[22px] font-bold text-[#2B211C]">
              服务边界
            </h2>

            <div className="grid gap-3">
              <BoundaryCard
                title="页面信息不是实时承诺"
                desc="商品库展示的是采集时信息，海外网站库存和价格可能随时变化。"
              />

              <BoundaryCard
                title="已售商品仍有参考价值"
                desc="已售商品可用于判断品牌、斗型、价格区间，也可以作为寻找类似款式的方向。"
              />

              <BoundaryCard
                title="购买前一定人工确认"
                desc="是否有货、是否可寄送、最终价格、运费和税费都需要在购买前重新确认。"
              />
            </div>
          </section>
        </div>
      </section>

      <section className="px-4 pb-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
            FAQ
          </p>

          <h2 className="mb-4 text-[22px] font-bold text-[#2B211C] sm:text-3xl">
            常见问题
          </h2>

          <div className="grid gap-3.5 md:grid-cols-2">
            <FaqCard
              question="为什么页面显示有货，还要人工确认？"
              answer="因为海外网站库存可能变化较快，页面采集信息只能作为参考。下单前需要重新确认商品是否仍然可购买。"
            />

            <FaqCard
              question="已售商品为什么还展示？"
              answer="已售商品可以作为斗型、品牌和价格区间参考。如果你喜欢类似风格，可以提交找斗需求。"
            />

            <FaqCard
              question="人民币参考价是最终价格吗？"
              answer="不是。人民币参考价只是按采集到的海外价格进行粗略换算，最终还需要结合运费、税费和服务费确认。"
            />

            <FaqCard
              question="可以只帮我找某个品牌吗？"
              answer="可以。你可以提供品牌、斗型、预算、是否接受二手、是否偏好特定产地或工艺，再协助筛选。"
            />
          </div>
        </div>
      </section>

      <section id="contact" className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[24px] border border-[#E5D7C5] bg-white p-5 text-center shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-10">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
            CONTACT
          </p>

          <h2 className="text-[22px] font-bold leading-tight text-[#2B211C] sm:text-4xl">
            看到感兴趣的斗，
            <br className="sm:hidden" />
            先发来确认。
          </h2>

          <p className="mx-auto mt-3 max-w-2xl text-[13px] leading-6 text-[#75695F] sm:text-base">
            你可以发送商品名称、详情页链接或截图。建议同时说明预算、是否接受已售同款参考、是否接受类似品牌替代。
          </p>

          <div className="mt-5 grid gap-2.5 sm:flex sm:justify-center">
            <Link
              href="/products"
              className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-7 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
            >
              去商品库挑选
            </Link>

            <Link
              href="/"
              className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              回到首页
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5D7C5] bg-[#FAF7F0]/95 px-4 py-2.5 backdrop-blur sm:hidden">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/products"
            className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] text-[13px] font-semibold text-white"
          >
            查看库存
          </Link>

          <a
            href="#contact"
            className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white text-[13px] font-semibold text-[#2B211C]"
          >
            咨询说明
          </a>
        </div>
      </div>
    </main>
  );
}