export default function SiteFooter() {
  return (
    <footer className="border-t border-[#E5D7C5] bg-[#FAF7F0] px-4 pb-24 pt-6 text-[#75695F] sm:px-6 sm:pb-8 lg:px-10">
      <div className="mx-auto max-w-7xl rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-6 lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:gap-8 lg:p-7">
        <div>
          <p className="text-[22px] font-black leading-none tracking-tight text-[#2B211C]">
            PipeSearch
          </p>
          <p className="mt-1 text-[13px] font-semibold tracking-[0.18em] text-[#9A6530]">
            烟斗器具库存信息
          </p>
        </div>

        <div className="mt-5 space-y-4 text-[13px] leading-6 text-[#75695F] lg:mt-0">
          <p>
            本站仅展示烟斗器具公开库存信息，不销售烟草制品、电子烟、烟油或尼古丁产品。页面价格与库存为采集时参考信息，实际购买需人工确认。
          </p>

          <div className="grid gap-2 border-t border-[#E5D7C5] pt-4 text-[12px] text-[#8A7B6E] sm:grid-cols-2">
            <p>ICP备案号：备案后展示</p>
            <p>公安备案号：备案后展示</p>
          </div>
        </div>
      </div>
    </footer>
  );
}