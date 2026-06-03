import Link from "next/link";

const navItems = [
  { label: "海外库存", href: "/products" },
  { label: "品牌库", href: "/brands" },
  { label: "找斗需求", href: "/request" },
  { label: "服务说明", href: "/service" },
];

export default function SiteHeader() {
  return (
    <header className="px-4 pt-6 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 border-b border-[#3a2419] pb-5 lg:flex-row lg:items-center lg:justify-between">
        <Link href="/" className="group inline-flex w-fit flex-col">
          <span className="text-lg font-black tracking-tight text-[#fff8ec] transition group-hover:text-[#f6c177]">
            PipeSearch
          </span>
          <span className="text-xs font-bold tracking-[0.24em] text-[#c9904c]">
            烟斗器具库存信息
          </span>
        </Link>

        <nav aria-label="主导航" className="-mx-1 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2 px-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-10 items-center justify-center rounded-full border border-[#4a2f20] bg-[#160d09] px-4 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
