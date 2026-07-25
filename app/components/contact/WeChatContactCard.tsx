export const WECHAT_ID = "zr610944194";

type WeChatContactCardProps = {
  className?: string;
};

export default function WeChatContactCard({
  className = "",
}: WeChatContactCardProps) {
  return (
    <section
      data-wechat-contact-card="true"
      className={[
        "border-t border-[var(--border)] pt-5",
        className,
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-medium leading-[1.4] text-[var(--coffee-dark)]">
          联系我们
        </h2>
        <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-[var(--brass)]">
          WECHAT
        </span>
      </div>

      <div className="mt-3 rounded-[5px] border border-[rgba(126,105,87,0.18)] bg-white px-4 py-4">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <img
            src="/pics/wechat-zr610944194.png"
            alt="品玉聊斗微信二维码"
            className="h-[176px] w-[176px] shrink-0 rounded-[4px] object-contain"
          />

          <div className="w-full min-w-0 text-center sm:pt-1 sm:text-left">
            <p className="text-[13px] font-medium leading-[1.45] text-[var(--coffee-dark)]">
              品玉聊斗
            </p>

            <p className="mt-2 text-[10.5px] leading-[1.55] text-[var(--text-secondary)]">
              微信号
            </p>

            <p className="mt-0.5 select-all break-all text-[14px] font-medium tracking-[0.02em] text-[var(--text-primary)]">
              {WECHAT_ID}
            </p>

            <p className="mt-3 text-[10.5px] leading-[1.65] text-[#93867b]">
              扫码添加后，发送合作方向与基础资料即可。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
