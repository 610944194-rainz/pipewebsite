"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const menuGroups = [
  {
    title: "浏览库存",
    items: [
      {
        href: "/",
        label: "首页",
        desc: "回到 PipeSearch 平台首页",
      },
      {
        href: "/products",
        label: "商品库",
        desc: "查看当前收录的公开库存",
      },
      {
        href: "/brands",
        label: "品牌库",
        desc: "按品牌浏览库存与资料",
      },
      {
        href: "/request",
        label: "找斗需求",
        desc: "提交想找的品牌、斗型或预算",
      },
    ],
  },
  {
    title: "合作与入驻",
    items: [
      {
        href: "/cooperate",
        label: "合作入驻",
        desc: "面向斗商、斗师与工作室",
      },
      {
        label: "国内斗师 / 工作室",
        desc: "作品展示与作者主页筹备中",
        status: "筹备中",
      },
      {
        label: "二手 / 回流斗",
        desc: "稳定渠道与寄售展示筹备中",
        status: "筹备中",
      },
    ],
  },
  {
    title: "内容资料",
    items: [
      {
        href: "/service",
        label: "服务说明",
        desc: "了解咨询、确认与代购边界",
      },
      {
        href: "/brands",
        label: "烟斗品牌资料",
        desc: "查看品牌模板与关联库存",
      },
      {
        label: "斗草笔记",
        desc: "器具、保养与展会内容筹备中",
        status: "筹备中",
      },
    ],
  },
];

export default function SiteMenu() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-11 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-5 text-[14px] font-semibold text-[#2B211C] shadow-[0_2px_8px_rgba(43,33,28,0.04)] transition hover:border-[#A9682B]"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        菜单
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#2B211C]/28 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-6"
          role="dialog"
          aria-modal="true"
          aria-label="全站导航"
        >
          <div className="ml-auto flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-[28px] border border-[#E5D7C5] bg-[#FAF7F0] shadow-[0_18px_55px_rgba(43,33,28,0.18)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#E5D7C5] bg-[#FFFDF8] p-5">
              <div>
                <p className="text-[22px] font-black leading-none tracking-tight text-[#2B211C]">
                  PipeSearch
                </p>
                <p className="mt-1 text-[12px] font-semibold tracking-[0.18em] text-[#9A6530]">
                  烟斗器具信息平台
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white text-[20px] leading-none text-[#2B211C] transition hover:border-[#A9682B]"
                aria-label="关闭菜单"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto p-4 sm:p-5">
              <div className="grid gap-4">
                {menuGroups.map((group) => (
                  <section key={group.title}>
                    <h2 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.22em] text-[#9A6530]">
                      {group.title}
                    </h2>

                    <div className="grid gap-2">
                      {group.items.map((item) =>
                        item.href ? (
                          <Link
                            key={item.label}
                            href={item.href}
                            onClick={() => setIsOpen(false)}
                            className="block rounded-[18px] border border-[#E5D7C5] bg-white p-3.5 transition hover:border-[#A9682B]"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[15px] font-bold text-[#2B211C]">
                                {item.label}
                              </p>
                              <span className="text-[16px] text-[#9A6530]">
                                →
                              </span>
                            </div>
                            <p className="mt-1 text-[12px] leading-5 text-[#75695F]">
                              {item.desc}
                            </p>
                          </Link>
                        ) : (
                          <div
                            key={item.label}
                            className="rounded-[18px] border border-[#E5D7C5] bg-[#F4EFE7] p-3.5 text-[#75695F]"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[15px] font-bold text-[#2B211C]">
                                {item.label}
                              </p>
                              <span className="rounded-full border border-[#D8C5AE] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#9A6530]">
                                {item.status}
                              </span>
                            </div>
                            <p className="mt-1 text-[12px] leading-5">
                              {item.desc}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
