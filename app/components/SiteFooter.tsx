export default function SiteFooter() {
  return (
    <footer className="border-t border-[#3a2419] bg-[#100a07] px-4 pb-24 pt-8 text-[#d8b58a] sm:px-6 sm:pb-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-6 rounded-[1.5rem] border border-[#4a2f20] bg-[#1a100b] p-5 sm:p-6 lg:grid-cols-[0.9fr_1.1fr] lg:p-7">
        <div>
          <p className="text-lg font-black tracking-tight text-[#fff8ec]">
            PipeSearch
          </p>
          <p className="mt-1 text-sm font-bold text-[#d1934a]">
            烟斗器具库存信息
          </p>
        </div>

        <div className="space-y-4 text-sm leading-7">
          <p>
            本站仅展示烟斗器具公开库存信息，不销售烟草制品、电子烟、烟油或尼古丁产品。页面价格与库存为采集时参考信息，实际购买需人工确认。
          </p>

          <div className="grid gap-2 border-t border-[#342116] pt-4 text-xs text-[#b99b7d] sm:grid-cols-2">
            <p>ICP备案号：备案后展示</p>
            <p>公安备案号：备案后展示</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
