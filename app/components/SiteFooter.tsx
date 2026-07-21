type SiteFooterProps = {
  variant?: "default" | "dark";
};

export default function SiteFooter({ variant = "default" }: SiteFooterProps) {
  const dark = variant === "dark";

  return (
    <footer className={dark ? "border-t border-[rgba(213,166,81,0.14)] bg-[#2a180e] text-[rgba(244,238,231,0.72)]" : "border-t border-[rgba(222,212,200,0.72)] bg-[#f2ece3] text-[var(--text-secondary)]"}>
      <div className={dark ? "mx-auto max-w-[1200px] px-4 py-7 sm:px-6 lg:px-10" : "mx-auto max-w-[1200px] px-4 pb-7 pt-6 sm:px-6 lg:px-10 lg:pb-8 lg:pt-8"}>
        <div className={dark ? undefined : "lg:grid lg:grid-cols-[0.8fr_1.2fr] lg:gap-16"}>
          <div>
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className={dark ? "h-auto w-[96px] object-contain object-left brightness-0 invert sepia" : "h-auto w-[158px] object-contain object-left mix-blend-multiply"}
            />
            <p className={dark ? "mt-[18px] max-w-[330px] text-[12px] font-normal leading-[1.55] text-[rgba(244,238,231,0.7)]" : "mt-2 max-w-[330px] text-[12px] font-normal leading-[1.7] text-[var(--text-secondary)]"}>
              精选海外烟斗库存、国内斗师作品与人工选品服务。
            </p>
          </div>

          <div className={dark ? "mt-[14px]" : "mt-5 lg:mt-0"}>
            <p className={dark ? "max-w-[680px] text-[12px] font-normal leading-[1.55] text-[rgba(244,238,231,0.7)]" : "max-w-[680px] text-[12px] font-normal leading-[1.7] text-[var(--text-secondary)]"}>
              本站仅展示烟斗器具公开库存信息，不销售烟草、电子烟及尼古丁产品。页面价格与库存仅供参考，实际购买需人工确认。
            </p>

            <div className={dark ? "mt-4 grid gap-1 text-[10.5px] font-normal leading-[1.5] text-[rgba(244,238,231,0.5)]" : "mt-4 grid gap-1.5 text-[11px] font-normal leading-[1.6] text-[#8a7d72] sm:grid-cols-2"}>
              <p>ICP备案号：备案后展示</p>
              <p>公安备案号：备案后展示</p>
            </div>
          </div>
        </div>

        <div className={dark ? "mt-[18px] border-t border-[rgba(213,166,81,0.08)] pt-4 text-[11px] font-normal leading-[1.5] text-[rgba(244,238,231,0.48)]" : "mt-5 border-t border-[rgba(222,212,200,0.72)] pt-3.5 text-[11px] font-normal leading-[1.5] text-[#94877c]"}>
          © 2026 烟斗派 YandouBuy
        </div>
      </div>
    </footer>
  );
}
