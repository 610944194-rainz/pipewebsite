"use client";

import Link from "next/link";
import { useState } from "react";

type IconProps = {
  className?: string;
};

type SiteHeaderProps = {
  className?: string;
};

function SiteHeader({ className = "" }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);

  const navItems = [
    { title: "海外库存", desc: "Overseas Inventory", href: "/products" },
    { title: "品牌库", desc: "Brands", href: "/brands" },
    { title: "人工找斗", desc: "Find a Pipe", href: "/request" },
    { title: "代购流程", desc: "How It Works", href: "/service" },
  ];

  return (
    <>
      <header
        className={`sticky top-0 z-40 border-b border-[#E7DDD0] bg-[#FBF7EF]/96 backdrop-blur-md ${className}`}
      >
        <div className="mx-auto grid h-[72px] max-w-6xl grid-cols-[48px_minmax(0,1fr)_48px] items-center px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            aria-label="打开菜单"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#063B32] transition hover:bg-[#F4EDE2]"
          >
            <MenuIcon className="h-[24px] w-[24px]" />
          </button>

          <Link
            href="/"
            aria-label="烟斗派 YandouBuy 首页"
            className="flex min-w-0 items-center justify-center"
          >
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className="block h-auto w-[222px] max-w-full object-contain object-center"
            />
          </Link>

          <div className="flex h-10 items-center justify-end text-[#063B32]">
            <Link
              href="/request"
              aria-label="提交找斗需求"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[#F4EDE2]"
            >
              <ChatIcon className="h-[25px] w-[25px]" />
            </Link>
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="关闭菜单"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[#061D18]/42 backdrop-blur-[2px]"
          />

          <aside className="relative h-full w-[80%] max-w-[318px] overflow-y-auto border-r border-[#E7DDD0] bg-[#FBF7EF] px-5 py-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <img
                src="/pics/yandoubuy-logo-header.png"
                alt="烟斗派 YandouBuy"
                className="h-auto w-[210px] max-w-[78%] object-contain object-left"
              />

              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#063B32] hover:bg-[#F4EDE2]"
              >
                <CloseIcon className="h-[21px] w-[21px]" />
              </button>
            </div>

            <Link
              href="/products"
              onClick={() => setOpen(false)}
              className="mt-6 flex h-11 items-center gap-3 rounded-full border border-[#D8CFC2] bg-white/75 px-4 text-[13px] text-[#746A5F]"
            >
              <SearchIcon className="h-5 w-5 text-[#8A8176]" />
              <span>搜索品牌、斗型、型号</span>
            </Link>

            <nav className="mt-6 divide-y divide-[#E7DDD0]">
              {navItems.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between py-3.5"
                >
                  <span>
                    <span className="block text-[16px] font-semibold tracking-[0.03em] text-[#1F1A16]">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-[12px] tracking-[0.08em] text-[#A97838]">
                      {item.desc}
                    </span>
                  </span>

                  <ArrowRightIcon className="h-4 w-4 text-[#746A5F]" />
                </Link>
              ))}
            </nav>

            <div className="mt-7 rounded-2xl border border-[#E7DDD0] bg-[#F7F3EA] p-4">
              <p className="text-[14px] font-semibold text-[#1F1A16]">
                烟斗派 YandouBuy
              </p>

              <p className="mt-2 text-[12px] leading-6 text-[#746A5F]">
                海外烟斗库存与人工选品咨询平台。价格、状态、运费、关税及入手成本以人工确认为准。
              </p>
            </div>

            <div className="mt-5 grid gap-3">
              <Link
                href="/products"
                onClick={() => setOpen(false)}
                className="flex h-11 items-center justify-center rounded-md bg-[#063B32] text-[14px] font-medium tracking-[0.08em] text-[#E7C48A]"
              >
                查看海外库存
              </Link>

              <Link
                href="/request"
                onClick={() => setOpen(false)}
                className="flex h-11 items-center justify-center rounded-md border border-[#B8863B] bg-white text-[14px] font-medium tracking-[0.08em] text-[#8A5D26]"
              >
                提交找斗需求
              </Link>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function CloseIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MenuIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m16.2 16.2 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.2 17.2 5 20l3.1-1.2c1.1.6 2.4.9 3.9.9 4.4 0 7.8-3 7.8-6.8S16.4 6.1 12 6.1s-7.8 3-7.8 6.8c0 1.6.7 3.1 2 4.3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 12.2h7M8.5 14.8h4.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowRightIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { SiteHeader };
export default SiteHeader;