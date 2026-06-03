"use client";

import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import { useMemo, useState } from "react";
import { siteConfig } from "../../data/site";

export default function RequestPage() {
  const [budget, setBudget] = useState("");
  const [brand, setBrand] = useState("");
  const [condition, setCondition] = useState("新斗 / 二手斗都可以");
  const [pipeShape, setPipeShape] = useState("");
  const [weight, setWeight] = useState("");
  const [tobaccoType, setTobaccoType] = useState("");
  const [experience, setExperience] = useState("新手");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  const message = useMemo(() => {
    return `你好，我想咨询找斗需求：

预算范围：${budget || "未填写"}
偏好品牌：${brand || "未填写"}
新斗/二手：${condition}
偏好斗型：${pipeShape || "未填写"}
重量偏好：${weight || "未填写"}
常抽草型：${tobaccoType || "未填写"}
烟斗经验：${experience}
补充说明：${note || "无"}

希望你帮我推荐几只合适的烟斗，并确认海外库存、预计落地价格和代购服务费。`;
  }, [budget, brand, condition, pipeShape, weight, tobaccoType, experience, note]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setCopied(false);
      alert("复制失败，可以手动选中文案复制。");
    }
  }

  const inputClass =
    "h-10 w-full rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] text-[#2B211C] outline-none transition placeholder:text-[#A09387] focus:border-[#A9682B]";

  const textareaClass =
    "w-full rounded-[18px] border border-[#D8C5AE] bg-white px-4 py-3 text-[13px] leading-6 text-[#2B211C] outline-none transition placeholder:text-[#A09387] focus:border-[#A9682B]";

  const labelClass = "mb-1.5 block text-[12px] font-semibold text-[#75695F]";

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
        <header className="mb-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
                PIPE REQUEST
              </p>

              <h1 className="text-[30px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
                找斗需求
              </h1>

              <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
                不确定买哪只斗，可以先把预算、品牌、斗型、重量和使用习惯写清楚，再生成一段可复制的咨询内容。
              </p>
            </div>

            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-5 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
            >
              返回首页
            </Link>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-4">
            <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
              <div className="mb-4 inline-flex rounded-full bg-[#F6F1E8] px-3 py-1 text-[12px] font-medium text-[#9A6530]">
                先把需求说清楚，再开始找斗
              </div>

              <h2 className="text-[28px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-4xl">
                告诉我你的预算和偏好，
                <br />
                我帮你找几只合适的斗。
              </h2>

              <p className="mt-4 text-[14px] leading-7 text-[#75695F] sm:text-[15px]">
                这个页面不会直接提交订单，也不会在线付款。你填写需求后，可以一键复制咨询内容，再通过微信发送。后续由人工确认合适烟斗、海外库存、预计落地价和代购服务费。
              </p>
            </section>

            <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
              <p className="text-[12px] text-[#75695F]">微信联系</p>

              <p className="mt-1 text-[24px] font-bold leading-tight text-[#9A6530]">
                {siteConfig.wechatId}
              </p>

              <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                添加时可备注：找斗需求 / 海外烟斗咨询。
              </p>
            </section>
          </div>

          <section className="rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6">
            <h3 className="text-[22px] font-bold text-[#2B211C]">
              填写找斗需求
            </h3>

            <div className="mt-5 grid gap-3.5">
              <div>
                <label className={labelClass}>预算范围</label>
                <input
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  placeholder="例如：2000–3000 元 / 5000 元以内"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>偏好品牌</label>
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  placeholder="例如：Peterson / Savinelli / Castello / Dunhill"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>新斗 / 二手斗</label>
                <select
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                  className={inputClass}
                >
                  <option>新斗 / 二手斗都可以</option>
                  <option>只看新斗</option>
                  <option>可以接受 Estate 二手斗</option>
                  <option>主要想看二手回流斗</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>偏好斗型</label>
                <input
                  value={pipeShape}
                  onChange={(event) => setPipeShape(event.target.value)}
                  placeholder="例如：直斗 / 弯斗 / billiard / apple / bulldog"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>重量偏好</label>
                <input
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  placeholder="例如：希望轻一点 / 20–40g / 不介意重"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>常抽草型</label>
                <input
                  value={tobaccoType}
                  onChange={(event) => setTobaccoType(event.target.value)}
                  placeholder="例如：英草 / V草 / 调味草 / 暂时不确定"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>烟斗经验</label>
                <select
                  value={experience}
                  onChange={(event) => setExperience(event.target.value)}
                  className={inputClass}
                >
                  <option>新手</option>
                  <option>有几只斗，想升级</option>
                  <option>进阶玩家</option>
                  <option>老斗客 / 收藏向</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>补充说明</label>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：不想太重、想要好清理、想要适合英草、希望有品牌辨识度……"
                  rows={4}
                  className={textareaClass}
                />
              </div>
            </div>
          </section>
        </section>

        <section
          id="preview"
          className="mt-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
                MESSAGE PREVIEW
              </p>

              <h3 className="mt-2 text-[22px] font-bold text-[#2B211C]">
                生成的咨询内容
              </h3>

              <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                点击复制后，把这段内容发到微信即可。
              </p>
            </div>

            <button
              type="button"
              onClick={copyMessage}
              className="h-10 rounded-full bg-[#A9682B] px-6 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
            >
              {copied ? "已复制" : "复制咨询内容"}
            </button>
          </div>

          <pre className="mt-4 whitespace-pre-wrap rounded-[18px] border border-[#E5D7C5] bg-white p-4 text-[13px] leading-6 text-[#2B211C]">
            {message}
          </pre>
        </section>

        <footer className="py-6 text-[12px] leading-6 text-[#8A7B6E]">
          本站仅提供海外烟斗、烟斗配件及烟具类商品的信息整理与人工代购咨询服务。
          本站不销售、不代购、不展示烟丝、香烟、雪茄、电子烟、烟油及其他烟草专卖品。
          页面库存、价格、运费及税费信息仅供参考，最终以人工确认为准。
        </footer>
      </section>

      <SiteFooter />
    </main>
  );
}