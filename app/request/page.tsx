"use client";

import Link from "next/link";
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

  return (
    <main className="min-h-screen bg-[#15100c] text-[#f5efe6]">
      <section className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-[#3a2a1f] pb-5">
          <div>
            <div className="text-xs tracking-[0.35em] text-[#b88a5a] sm:text-sm">
              PIPE REQUEST
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-wide sm:text-2xl">
              找斗需求
            </h1>
          </div>

          <Link
            href="/"
            className="rounded-full border border-[#5c4030] px-4 py-2 text-xs text-[#f5efe6] hover:border-[#c58a4a]"
          >
            返回首页
          </Link>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[0.95fr_1.05fr] lg:py-14">
          <div>
            <div className="mb-5 inline-flex rounded-full border border-[#5c4030] px-4 py-2 text-xs text-[#d2a06f] sm:text-sm">
              不确定买哪只斗？先把需求说清楚
            </div>

            <h2 className="text-4xl font-semibold leading-tight sm:text-5xl">
              告诉我你的预算和偏好，
              <br />
              我帮你找几只合适的斗。
            </h2>

            <p className="mt-6 text-sm leading-7 text-[#d8c6b5] sm:text-base">
              这个页面不会直接提交订单，也不会在线付款。你填写需求后，
              可以一键复制咨询内容，再通过微信发给我们。后续由人工确认合适烟斗、
              海外库存、预计落地价和代购服务费。
            </p>

            <div className="mt-6 rounded-[1.5rem] border border-[#3a2a1f] bg-[#201710] p-5">
              <p className="text-sm text-[#9f8d7c]">微信联系</p>
              <p className="mt-2 text-2xl font-semibold text-[#f0c08a]">
                {siteConfig.wechatId}
              </p>
              <p className="mt-3 text-sm leading-7 text-[#b8a899]">
                添加时可备注：找斗需求 / 海外烟斗咨询。
              </p>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-[#3a2a1f] bg-[#201710] p-5 sm:p-6">
            <h3 className="text-2xl font-semibold">填写找斗需求</h3>

            <div className="mt-6 grid gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  预算范围
                </label>
                <input
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  placeholder="例如：2000–3000 元 / 5000 元以内"
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none placeholder:text-[#7f7165] focus:border-[#c58a4a]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  偏好品牌
                </label>
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  placeholder="例如：Peterson / Savinelli / Castello / Dunhill"
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none placeholder:text-[#7f7165] focus:border-[#c58a4a]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  新斗 / 二手斗
                </label>
                <select
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none focus:border-[#c58a4a]"
                >
                  <option>新斗 / 二手斗都可以</option>
                  <option>只看新斗</option>
                  <option>可以接受 Estate 二手斗</option>
                  <option>主要想看二手回流斗</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  偏好斗型
                </label>
                <input
                  value={pipeShape}
                  onChange={(event) => setPipeShape(event.target.value)}
                  placeholder="例如：直斗 / 弯斗 / billiard / apple / bulldog"
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none placeholder:text-[#7f7165] focus:border-[#c58a4a]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  重量偏好
                </label>
                <input
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  placeholder="例如：希望轻一点 / 20–40g / 不介意重"
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none placeholder:text-[#7f7165] focus:border-[#c58a4a]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  常抽草型
                </label>
                <input
                  value={tobaccoType}
                  onChange={(event) => setTobaccoType(event.target.value)}
                  placeholder="例如：英草 / V草 / 调味草 / 暂时不确定"
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none placeholder:text-[#7f7165] focus:border-[#c58a4a]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  烟斗经验
                </label>
                <select
                  value={experience}
                  onChange={(event) => setExperience(event.target.value)}
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none focus:border-[#c58a4a]"
                >
                  <option>新手</option>
                  <option>有几只斗，想升级</option>
                  <option>进阶玩家</option>
                  <option>老斗客 / 收藏向</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#9f8d7c]">
                  补充说明
                </label>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：不想太重、想要好清理、想要适合英草、希望有品牌辨识度……"
                  rows={4}
                  className="w-full rounded-2xl border border-[#3a2a1f] bg-[#15100c] px-5 py-4 text-sm text-[#f5efe6] outline-none placeholder:text-[#7f7165] focus:border-[#c58a4a]"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-[#3a2a1f] bg-[#201710] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm tracking-[0.25em] text-[#b88a5a]">
                MESSAGE PREVIEW
              </p>
              <h3 className="mt-3 text-2xl font-semibold">生成的咨询内容</h3>
              <p className="mt-3 text-sm leading-7 text-[#b8a899]">
                点击复制后，把这段内容发到微信即可。
              </p>
            </div>

            <button
              onClick={copyMessage}
              className="rounded-full bg-[#c58a4a] px-6 py-3 text-sm font-medium text-[#15100c] hover:bg-[#d99a56]"
            >
              {copied ? "已复制" : "复制咨询内容"}
            </button>
          </div>

          <pre className="mt-5 whitespace-pre-wrap rounded-2xl border border-[#3a2a1f] bg-[#15100c] p-5 text-sm leading-7 text-[#d8c6b5]">
            {message}
          </pre>
        </section>

        <footer className="py-8 text-sm leading-7 text-[#8f8173]">
          本站仅提供海外烟斗、烟斗配件及烟具类商品的信息整理与人工代购咨询服务。
          本站不销售、不代购、不展示烟丝、香烟、雪茄、电子烟、烟油及其他烟草专卖品。
          页面库存、价格、运费及税费信息仅供参考，最终以人工确认为准。
        </footer>
      </section>
    </main>
  );
}