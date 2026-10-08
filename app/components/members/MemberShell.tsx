import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import styles from "./members.module.css";

export default function MemberShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <><SiteHeader /><main className={styles.main}>
    <div className={`${styles.container} ${wide ? styles.wide : ""}`}>
      <aside className={styles.intro}>
        <Link href="/" className={styles.eyebrow}>烟斗派 · 斗友空间</Link>
        <h1>为喜欢的烟斗，<br />留一个位置。</h1>
        <p>用一个账号，收藏心仪之作，<br />记录体验，交流心得。</p>
        <div className={styles.rule} /><span className={styles.small}>慢慢挑选，好好交流。</span>
      </aside>
      <section className={styles.panel}>{children}</section>
    </div>
  </main><SiteFooter /></>;
}
