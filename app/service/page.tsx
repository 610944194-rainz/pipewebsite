import Link from "next/link";
import SiteFooter from "../components/SiteFooter";

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
    <div className="rounded-[1.5rem] border border-[#4a2f20] bg-[#21150f] p-5">
      <p className="mb-3 text-sm font-black text-[#d1934a]">{index}</p>
      <h3 className="mb-2 text-lg font-black text-[#fff8ec]">{title}</h3>
      <p className="text-sm leading-7 text-[#d8b58a]">{desc}</p>
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
    <div className="flex items-start justify-between gap-4 border-b border-[#342116] py-4 last:border-b-0">
      <span className="shrink-0 text-sm text-[#b99b7d]">{label}</span>
      <span className="text-right text-sm font-bold leading-6 text-[#fff8ec]">
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
    <div className="rounded-[1.4rem] bg-[#160d09] p-5">
      <h3 className="mb-2 text-base font-black text-[#fff8ec]">{question}</h3>
      <p className="text-sm leading-7 text-[#d8b58a]">{answer}</p>
    </div>
  );
}

export default function ServicePage() {
  return (
    <main className="min-h-screen bg-[#100a07] pb-24 text-[#fff8ec] sm:pb-0">
      <section className="px-4 pt-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-6 flex items-center justify-between">
            <Link href="/" className="group">
              <div className="text-lg font-black tracking-tight text-[#fff8ec]">
                Pipe Stock
              </div>
              <div className="text-xs tracking-[0.28em] text-[#c9904c]">
                SERVICE NOTE
              </div>
            </Link>

            <Link
              href="/products"
              className="rounded-full border border-[#6b422b] px-4 py-2 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
            >
              商品库
            </Link>
          </header>

          <section className="rounded-[2rem] border border-[#4a2f20] bg-[#1a100b] p-5 sm:p-8 lg:p-10">
            <p className="mb-4 text-xs uppercase tracking-[0.45em] text-[#c9904c]">
              HOW IT WORKS
            </p>

            <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-6xl">
              海外烟斗代购，
              <br />
              先确认，再决定。
            </h1>

            <p className="mt-5 max-w-3xl text-base leading-8 text-[#d8b58a] sm:text-lg">
              本站整理海外烟斗网站的公开库存信息，帮助你快速查看商品、图片、价格和参数。页面展示并不代表实时库存，实际购买前需要人工重新确认。
            </p>

            <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
              <Link
                href="/products"
                className="flex min-h-13 items-center justify-center rounded-full bg-[#d1934a] px-7 text-base font-black text-[#120b08] transition hover:bg-[#e3a85c]"
              >
                查看海外库存
              </Link>

              <a
                href="#contact"
                className="flex min-h-13 items-center justify-center rounded-full border border-[#6b422b] px-7 text-base font-black text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
              >
                咨询找斗
              </a>
            </div>
          </section>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5">
            <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
              PROCESS
            </p>

            <h2 className="text-2xl font-black sm:text-3xl">
              代购流程
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
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

      <section className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-5 sm:p-7">
            <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
              COST
            </p>

            <h2 className="mb-5 text-2xl font-black">费用构成</h2>

            <div>
              <InfoRow label="海外原价" value="以原站下单前实时页面为准" />
              <InfoRow label="国际运费" value="根据商家、目的地和包裹重量确认" />
              <InfoRow label="预计税费" value="根据实际申报、物流和目的地规则预估" />
              <InfoRow label="服务费" value="按商品情况、沟通成本和代购难度确认" />
              <InfoRow label="最终价格" value="下单前单独确认，不以页面采集价为最终价" />
            </div>
          </section>

          <section className="rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-5 sm:p-7">
            <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
              BOUNDARY
            </p>

            <h2 className="mb-5 text-2xl font-black">服务边界</h2>

            <div className="grid gap-3">
              <div className="rounded-2xl bg-[#160d09] p-4">
                <h3 className="mb-2 font-black text-[#fff8ec]">
                  页面信息不是实时承诺
                </h3>
                <p className="text-sm leading-7 text-[#d8b58a]">
                  商品库展示的是采集时信息，海外网站库存和价格可能随时变化。
                </p>
              </div>

              <div className="rounded-2xl bg-[#160d09] p-4">
                <h3 className="mb-2 font-black text-[#fff8ec]">
                  已售商品仍有参考价值
                </h3>
                <p className="text-sm leading-7 text-[#d8b58a]">
                  已售商品可用于判断品牌、斗型、价格区间，也可以作为寻找类似款式的方向。
                </p>
              </div>

              <div className="rounded-2xl bg-[#160d09] p-4">
                <h3 className="mb-2 font-black text-[#fff8ec]">
                  购买前一定人工确认
                </h3>
                <p className="text-sm leading-7 text-[#d8b58a]">
                  是否有货、是否可寄送、最终价格、运费和税费都需要在购买前重新确认。
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-[#4a2f20] bg-[#1a100b] p-5 sm:p-8">
          <p className="mb-2 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
            FAQ
          </p>

          <h2 className="mb-5 text-2xl font-black sm:text-3xl">
            常见问题
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
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

      <section id="contact" className="px-4 pb-10 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-6 text-center sm:p-10">
          <p className="mb-3 text-xs uppercase tracking-[0.4em] text-[#c9904c]">
            CONTACT
          </p>

          <h2 className="text-2xl font-black leading-tight sm:text-4xl">
            看到感兴趣的斗，
            <br className="sm:hidden" />
            先发来确认。
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#d8b58a] sm:text-base">
            你可以发送商品名称、详情页链接或截图。建议同时说明预算、是否接受已售同款参考、是否接受类似品牌替代。
          </p>

          <div className="mt-7 grid gap-3 sm:flex sm:justify-center">
            <Link
              href="/products"
              className="flex min-h-12 items-center justify-center rounded-full bg-[#d1934a] px-7 text-sm font-black text-[#120b08] transition hover:bg-[#e3a85c]"
            >
              去商品库挑选
            </Link>

            <Link
              href="/"
              className="flex min-h-12 items-center justify-center rounded-full border border-[#6b422b] px-7 text-sm font-black text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
            >
              回到首页
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#4a2f20] bg-[#100a07]/95 px-4 py-3 backdrop-blur sm:hidden">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/products"
            className="flex min-h-11 items-center justify-center rounded-full bg-[#d1934a] text-sm font-black text-[#120b08]"
          >
            查看库存
          </Link>

          <a
            href="#contact"
            className="flex min-h-11 items-center justify-center rounded-full border border-[#6b422b] text-sm font-black text-[#fff8ec]"
          >
            咨询说明
          </a>
        </div>
      </div>
    </main>
  );
}
