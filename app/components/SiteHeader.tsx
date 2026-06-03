import Link from "next/link";

const navItems = [
  { href: "/products", label: "海外库存" },
  { href: "/brands", label: "品牌库" },
  { href: "/request", label: "找斗需求" },
  { href: "/service", label: "服务说明" },
];

export default function SiteHeader() {
  return (
    <header className="border-b border-[#E7DACB] bg-[#FAF7F0] px-4 py-4">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="block">
          <div className="text-[24px] font-black leading-none tracking-tight text-[#2B211C]">
            PipeSearch
          </div>
          <div className="mt-1 text-[13px] font-semibold tracking-[0.18em] text-[#9A6530]">
            烟斗器具库存信息
          </div>
        </Link>

        <nav className="mt-4 grid grid-cols-4 gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex h-10 items-center justify-center rounded-full border border-[#E0CDB7] bg-white px-1 text-center text-[13px] font-bold leading-none text-[#2B211C] shadow-[0_1px_2px_rgba(43,33,28,0.04)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}