import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";

const platformOffers = [
  {
    title: "商品展示",
    desc: "整理图片、价格参考、库存状态、参数信息，帮助玩家先看清楚再咨询。",
  },
  {
    title: "品牌页",
    desc: "按品牌聚合库存与资料，为斗商、斗师或工作室建立稳定展示入口。",
  },
  {
    title: "咨询导流",
    desc: "用户通过页面发起人工咨询，再确认库存、价格、运费和服务费用。",
  },
  {
    title: "内容共创",
    desc: "逐步整理品牌故事、斗师介绍、展会专题和器具资料内容。",
  },
];

const partnerTypes = [
  "海外烟斗商",
  "国内斗师",
  "工作室 / 线下店",
  "二手 / 回流斗渠道",
];

const displayFormats = [
  "商品页展示",
  "品牌 / 工作室主页",
  "首页精选位",
  "专题内容页",
  "展会合作展示",
];

const boundaries = [
  "PipeSearch 只展示烟斗器具相关公开库存与合作资料。",
  "不展示烟草制品、电子烟、烟油或尼古丁产品。",
  "不接入在线支付，不自动成交。",
  "购买前需人工确认库存、最终价格、国际运费、预计税费和服务费用。",
];

const processSteps = [
  {
    step: "01",
    title: "提交资料",
    desc: "提供品牌、作品、库存或合作展示基础信息。",
  },
  {
    step: "02",
    title: "整理审核",
    desc: "确认资料边界，统一图片、参数、说明与展示口径。",
  },
  {
    step: "03",
    title: "上架展示",
    desc: "进入商品页、品牌页、专题页或首页精选区域。",
  },
  {
    step: "04",
    title: "人工对接",
    desc: "用户发起咨询后，再由人工确认和沟通下一步。",
  },
];

const checklist = [
  "品牌 / 工作室名称",
  "产品图片",
  "产品名称与参数",
  "库存状态",
  "价格或咨询方式",
  "品牌介绍 / 斗师介绍",
  "联系方式",
];

function SectionHeader({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
        {eyebrow}
      </p>
      <h2 className="text-[22px] font-bold leading-tight text-[#2B211C] sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-[14px] leading-7 text-[#75695F]">
        {desc}
      </p>
    </div>
  );
}

function InfoCard({ title, desc }: { title: string; desc: string }) {
  return (
    <article className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)] sm:p-5">
      <h3 className="text-[17px] font-bold text-[#2B211C]">{title}</h3>
      <p className="mt-2 text-[13px] leading-6 text-[#75695F]">{desc}</p>
    </article>
  );
}

export default function CooperatePage() {
  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <section className="rounded-[28px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-8 lg:grid lg:grid-cols-[1.08fr_0.92fr] lg:gap-8 lg:p-10">
            <div>
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
                COOPERATION
              </p>

              <h1 className="text-[32px] font-bold leading-[1.12] tracking-tight text-[#2B211C] sm:text-5xl">
                让优质烟斗作品，
                <br />
                被真正需要的人看见
              </h1>

              <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#75695F] sm:text-[16px]">
                PipeSearch 正在整理海外公开库存、品牌资料与国内斗师 / 工作室作品展示，帮助玩家更高效地浏览、比较与发起咨询。
              </p>

              <div className="mt-6 grid gap-2.5 sm:flex sm:flex-wrap">
                <Link
                  href="/products"
                  className="flex h-11 items-center justify-center rounded-full bg-[#A9682B] px-7 text-[14px] font-semibold text-white transition hover:bg-[#8F5522]"
                >
                  查看当前商品库
                </Link>

                <a
                  href="#contact"
                  className="flex h-11 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[14px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                >
                  提交合作意向
                </a>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border border-[#E5D7C5] bg-[#FAF7F0] p-4 lg:mt-0">
              <div className="grid gap-3">
                {[
                  ["合作对象", "斗商、斗师、工作室、稳定回流渠道"],
                  ["展示形式", "库存、品牌页、专题、展会合作"],
                  ["合规边界", "只展示烟斗器具，不展示烟草或尼古丁产品"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-[18px] border border-[#E5D7C5] bg-white p-4"
                  >
                    <p className="text-[12px] font-semibold text-[#9A6530]">
                      {label}
                    </p>
                    <p className="mt-1 text-[15px] font-bold leading-6 text-[#2B211C]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6">
            <SectionHeader
              eyebrow="WHAT WE OFFER"
              title="平台能提供什么"
              desc="PipeSearch 更像一个可持续更新的信息展台，先把作品、库存和资料展示清楚，再承接人工咨询。"
            />
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {platformOffers.map((item) => (
                <InfoCard key={item.title} title={item.title} desc={item.desc} />
              ))}
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <SectionHeader
                eyebrow="WHO"
                title="适合谁合作"
                desc="适合希望把作品、库存或渠道能力稳定展示给国内玩家的合作方。"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {partnerTypes.map((type) => (
                  <div
                    key={type}
                    className="rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 text-[16px] font-bold text-[#2B211C]"
                  >
                    {type}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionHeader
                eyebrow="DISPLAY"
                title="入驻展示形式"
                desc="第一阶段以轻量展示和人工咨询为主，后续再逐步扩展专题、作者页和展会页面。"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {displayFormats.map((format) => (
                  <div
                    key={format}
                    className="rounded-[20px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 text-[15px] font-bold text-[#2B211C]"
                  >
                    {format}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-8 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-7">
            <SectionHeader
              eyebrow="BOUNDARY"
              title="合作边界"
              desc="边界清楚，合作才稳定。PipeSearch 当前只做信息展示、资料整理和人工咨询入口。"
            />
            <div className="grid gap-3 md:grid-cols-2">
              {boundaries.map((item) => (
                <div
                  key={item}
                  className="rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4 text-[13px] leading-6 text-[#75695F]"
                >
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <SectionHeader
              eyebrow="PROCESS"
              title="合作流程"
              desc="流程保持轻量，但每一步都需要人工确认，避免信息误导或自动成交。"
            />
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {processSteps.map((item) => (
                <article
                  key={item.step}
                  className="rounded-[22px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_4px_14px_rgba(43,33,28,0.03)]"
                >
                  <p className="text-[12px] font-semibold text-[#9A6530]">
                    {item.step}
                  </p>
                  <h3 className="mt-2 text-[17px] font-bold text-[#2B211C]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                    {item.desc}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-7">
              <SectionHeader
                eyebrow="CHECKLIST"
                title="资料准备清单"
                desc="准备得越清楚，页面展示和人工确认就越顺畅。"
              />
              <div className="grid gap-2">
                {checklist.map((item) => (
                  <div
                    key={item}
                    className="rounded-full border border-[#E5D7C5] bg-[#FAF7F0] px-4 py-2 text-[13px] font-semibold text-[#2B211C]"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div
              id="contact"
              className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-7"
            >
              <SectionHeader
                eyebrow="CONTACT"
                title="欢迎在展会或线上联系"
                desc="如果你是斗商、斗师、工作室或有稳定回流渠道，欢迎与 PipeSearch 沟通入驻展示方式。"
              />
              <div className="grid gap-3">
                <div className="rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4">
                  <p className="text-[12px] font-semibold text-[#75695F]">
                    微信 / 小红书 / 抖音
                  </p>
                  <p className="mt-1 text-[20px] font-bold text-[#2B211C]">
                    品玉聊斗
                  </p>
                </div>
                <div className="rounded-[18px] border border-[#E5D7C5] bg-[#FAF7F0] p-4">
                  <p className="text-[12px] font-semibold text-[#75695F]">
                    邮箱
                  </p>
                  <p className="mt-1 text-[16px] font-bold text-[#2B211C]">
                    可后续补充
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
