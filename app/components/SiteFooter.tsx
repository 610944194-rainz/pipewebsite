export default function SiteFooter() {
  return (
    <footer className="border-t border-[rgba(222,212,200,0.72)] bg-[#f2ece3] text-[var(--text-secondary)]">
      <div className="mx-auto max-w-[1200px] px-4 pb-[30px] pt-[26px] sm:px-6 lg:px-10 lg:pb-8 lg:pt-9">
        <div className="lg:grid lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className="h-auto w-[158px] object-contain object-left mix-blend-multiply"
            />
            <p className="mt-3 max-w-[330px] text-[12px] font-normal leading-[1.7] text-[var(--text-secondary)]">
              精选烟斗器具库存、国内斗师作品与人工选品服务。
            </p>
          </div>

          <div className="mt-6 lg:mt-0">
            <p className="max-w-[680px] text-[12px] font-normal leading-[1.7] text-[var(--text-secondary)]">
              本站仅展示烟斗器具公开库存信息，不销售烟草制品、电子烟、烟油或尼古丁产品。页面价格与库存为采集时的参考信息，实际购买需人工确认。
            </p>

            <div className="mt-4 grid gap-1.5 text-[11px] font-normal leading-[1.6] text-[#8a7d72] sm:grid-cols-2">
              <p>ICP备案号：备案后展示</p>
              <p>公安备案号：备案后展示</p>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-[rgba(222,212,200,0.72)] pt-4 text-[11px] font-normal leading-[1.5] text-[#94877c]">
          © 2026 烟斗派 YandouBuy
        </div>
      </div>
    </footer>
  );
}
