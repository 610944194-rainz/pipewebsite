import type { AnalyticsStats } from "@/lib/analytics/types";
import styles from "@/app/components/members/members.module.css";

const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

export default function AnalyticsOverview({ stats, updatedAt }: { stats: AnalyticsStats; updatedAt: string }) {
  const maxViews = Math.max(1, ...stats.daily.map((day) => day.views));
  const cards = [
    { label: "累计浏览次数", value: stats.totalViews },
    { label: "累计访客数", value: stats.totalVisitors },
    { label: "近7天浏览次数", value: stats.last7Views },
    { label: "近7天访客数", value: stats.last7Visitors },
    { label: "近30天浏览次数", value: stats.last30Views },
    { label: "近30天访客数", value: stats.last30Visitors },
  ];
  return <section aria-label="站点浏览统计">
    <h3 className={styles.analyticsTitle}>网站浏览统计</h3>
    <p className={styles.small}>按北京时间统计 · 更新于 {new Date(updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
    <div className={styles.analyticsGrid} aria-label="统计概览">{cards.map((card) => <article key={card.label} className={styles.analyticsCard}><p className={styles.small}>{card.label}</p><p className={styles.analyticsValue}>{number(card.value)}</p></article>)}</div>
    <section className={styles.section}>
      <h3>近30天趋势</h3><p className={styles.small}>每天的浏览次数；访客数见每日明细。</p>
      <div role="img" aria-label="近30天每日浏览次数柱状图" className={styles.analyticsChart}>{stats.daily.map((day) => <div key={day.date} title={`${day.date}：${day.views} 次浏览，${day.visitors} 位访客`} className={styles.analyticsBar} style={{ height: `${Math.max(day.views ? 4 : 1, day.views / maxViews * 100)}%` }} />)}</div>
      <div className={`${styles.between} ${styles.small}`}><span>{stats.daily[0]?.date}</span><span>{stats.daily.at(-1)?.date}</span></div>
      <details className={styles.analyticsDetails}><summary>查看每日明细</summary><div className={styles.analyticsTableWrap}><table className={styles.analyticsTable}><thead><tr><th>日期（北京时间）</th><th>访客</th><th>浏览</th></tr></thead><tbody>{[...stats.daily].reverse().map((day) => <tr key={day.date}><td>{day.date}</td><td>{number(day.visitors)}</td><td>{number(day.views)}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className={styles.section}><h3>热门页面 · 累计浏览</h3>{stats.topPages.length ? <ol className={styles.analyticsPages}>{stats.topPages.map((page, index) => <li key={page.path}><span className={styles.small}>{index + 1}</span><span title={page.path}>{page.path}</span><strong>{number(page.views)}</strong></li>)}</ol> : <p className={styles.small}>开始记录访问后，这里会显示热门页面。</p>}</section>
    <p className={`${styles.small} ${styles.adminNotice}`}>访客按浏览器识别，一人使用多个设备会分别计算；禁用脚本或拦截统计请求的访问不会计入。登录管理员的访问不计入。</p>
  </section>;
}
