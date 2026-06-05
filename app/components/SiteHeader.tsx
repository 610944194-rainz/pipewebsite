import Link from "next/link";
import SiteMenu from "./SiteMenu";

export default function SiteHeader() {
  return (
    <header className="border-b border-[#E7DACB] bg-[#FAF7F0] px-4 py-3 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link href="/" className="block">
          <div className="text-[24px] font-black leading-none tracking-tight text-[#2B211C]">
            PipeSearch
          </div>
          <div className="mt-1 text-[13px] font-semibold tracking-[0.18em] text-[#9A6530]">
            烟斗器具信息平台
          </div>
        </Link>

        <SiteMenu />
      </div>
    </header>
  );
}
