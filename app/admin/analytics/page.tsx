import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/analytics/auth";
import { readStats } from "@/lib/analytics/store";

export const metadata: Metadata = { title: "流量统计｜烟斗派", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

export default async function Analytics() {
  if (!(await isAdmin())) redirect("/admin/analytics/login");
  let stats: Awaited<ReturnType<typeof readStats>>;
  try {
    stats = await readStats();
  } catch (error) {
    console.error("Analytics read failed", error);
    return <main className="mx-auto max-w-5xl px-5 py-16"><h1 className="text-2xl">流量统计暂不可用</h1><p className="mt-3">请检查统计存储配置或稍后刷新。</p></main>;
  }
  const maxViews = Math.max(1, ...stats.daily.map((day) => day.views));
  const cards = [
    { label: "累计浏览次数", value: stats.totalViews },
    { label: "累计访客数", value: stats.totalVisitors },
    { label: "近7天浏览次数", value: stats.last7Views },
    { label: "近7天访客数", value: stats.last7Visitors },
    { label: "近30天浏览次数", value: stats.last30Views },
    { label: "近30天访客数", value: stats.last30Visitors },
  ];
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 text-[#23372f] sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs tracking-[0.24em] text-[#8b7760]">YANDOUBUY · ANALYTICS</p><h1 className="mt-3 text-3xl font-semibold">网站流量统计</h1><p className="mt-2 text-sm text-[#67776c]">按北京时间统计 · 刷新页面更新数据</p></div>
        <form action="/api/analytics/logout" method="post"><button className="rounded-lg border border-[#cbd2ca] px-4 py-2 text-sm hover:bg-[#eef2ed]">退出登录</button></form>
      </div>
      <section aria-label="统计概览" className="mt-9 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((card) => <div key={card.label} className="rounded-xl border border-[#e1e8df] bg-white p-5"><p className="text-sm text-[#65766b]">{card.label}</p><p className="mt-3 text-3xl font-semibold tabular-nums">{number(card.value)}</p></div>)}
      </section>
      <section className="mt-8 rounded-xl border border-[#e1e8df] bg-white p-5 sm:p-7">
        <h2 className="text-lg font-semibold">近30天趋势</h2><p className="mt-1 text-sm text-[#65766b]">每天的浏览次数；访客数见下方明细</p>
        <div role="img" aria-label="近30天每日浏览次数柱状图" className="mt-7 flex h-36 items-end gap-1 sm:gap-2">
          {stats.daily.map((day) => <div key={day.date} title={`${day.date}：${day.views} 次浏览，${day.visitors} 位访客`} className="min-w-0 flex-1 rounded-t bg-[#488068]" style={{ height: `${Math.max(day.views ? 4 : 1, day.views / maxViews * 100)}%` }} />)}
        </div>
        <div className="mt-2 flex justify-between text-xs text-[#65766b]"><span>{stats.daily[0]?.date}</span><span>{stats.daily.at(-1)?.date}</span></div>
        <details className="mt-6 border-t border-[#edf0eb] pt-4"><summary className="cursor-pointer text-sm font-medium">查看每日明细</summary>
          <div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">日期（北京时间）</th><th className="py-2 text-right">访客</th><th className="py-2 text-right">浏览</th></tr></thead><tbody>{[...stats.daily].reverse().map((day) => <tr key={day.date} className="border-t border-[#edf0eb]"><td className="py-2">{day.date}</td><td className="py-2 text-right">{number(day.visitors)}</td><td className="py-2 text-right">{number(day.views)}</td></tr>)}</tbody></table></div>
        </details>
      </section>
      <section className="mt-8 rounded-xl border border-[#e1e8df] bg-white p-5 sm:p-7"><h2 className="text-lg font-semibold">热门页面 · 累计浏览</h2>
        {stats.topPages.length ? <ol className="mt-5 space-y-3">{stats.topPages.map((page, index) => <li key={page.path} className="flex items-center gap-3 text-sm"><span className="w-5 text-[#8b7760]">{index + 1}</span><span className="min-w-0 flex-1 truncate" title={page.path}>{page.path}</span><span className="tabular-nums">{number(page.views)}</span></li>)}</ol> : <p className="mt-4 text-sm text-[#65766b]">开始记录访问后，这里会显示热门页面。</p>}
      </section>
      <p className="mt-7 text-xs leading-6 text-[#65766b]">访客按浏览器识别，一人使用多个设备会分别计算；禁用脚本或拦截统计请求的访问不会计入。管理员访问不计入。</p>
    </main>
  );
}
