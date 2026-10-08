"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { memberRequest } from "@/lib/members/client";
import styles from "./members.module.css";

type Item = { productKey: string; productId: string; kind: string; title: string; brand: string; image: string | null; href: string; availability: string; id: string; content: string; status: string; reason: string | null; createdAt: string };
const statusNames: Record<string, string> = { available: "在库", sold: "已售", unavailable: "已下架 · 保留收藏记录", sample: "作品展示样例", pending: "等待审核", published: "已公开", rejected: "未通过审核", hidden: "已隐藏" };
export default function MemberCollections({ mode }: { mode: "favorites" | "my-comments" }) {
  const [items, setItems] = useState<Item[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    memberRequest<{ favorites?: Item[]; comments?: Item[]; total: number }>(`/api/community/${mode}?page=${page}`).then((data) => { if (live) { setItems(data.favorites || data.comments || []); setTotal(data.total); setLoading(false); } }).catch((cause) => { if (live) { setError(cause.message); setLoading(false); } });
    return () => { live = false; };
  }, [mode, page]);
  async function remove(item: Item) {
    setError("");
    try {
      await memberRequest(mode === "favorites" ? "/api/community/favorites" : "/api/community/comments/delete", mode === "favorites" ? { productId: item.productId, kind: item.kind, save: false } : { id: item.id });
      setItems((rows) => rows.filter((row) => mode === "favorites" ? row.productKey !== item.productKey : row.id !== item.id)); setTotal((n) => n - 1); setNotice(mode === "favorites" ? "已取消收藏。" : "留言已撤回。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作未完成。"); }
  }
  return <>
    <h2 className={styles.title}>{mode === "favorites" ? "我的收藏" : "我的留言"}</h2>
    <nav className={styles.tabs}><Link href="/account">账号资料</Link><Link href="/account/favorites">我的收藏</Link><Link href="/account/comments">我的留言</Link><Link href="/tobacco-encyclopedia/index.html">斗草百科</Link></nav>
    <p className={styles.subtitle}>{mode === "favorites" ? "收藏保留在账号中，已售或下架后仍能找到记录。" : "邮箱验证后可以提交留言，公开展示须经站方核验和审核。"}</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {loading ? <p>正在读取…</p> : !items.length ? <p className={styles.subtitle}>{mode === "favorites" ? "还没有收藏，打开烟斗详情即可收藏。" : "还没有留言，到斗草详情分享你的体验吧。"}</p> : <div className={styles.collection}>{items.map((item) => <article className={styles.collectionItem} key={item.productKey || item.id}>
      {mode === "favorites" && item.image ? <img src={item.image} alt={item.title} loading="lazy" className={styles.collectionImage} /> : null}
      <div style={{ minWidth: 0 }}><p className={styles.small}>{item.brand}</p><h3>{item.href ? <Link className={styles.link} href={item.href}>{item.title}</Link> : item.title}</h3><p className={styles.badge}>{statusNames[item.availability || item.status]}</p>
        {mode === "my-comments" ? <><p className={styles.commentText}>{item.content}</p>{item.reason ? <p className={styles.small}>处理说明：{item.reason}</p> : null}</> : null}
        <div className={styles.row}><button className={styles.secondary} onClick={() => remove(item)}>{mode === "favorites" ? "取消收藏" : "撤回留言"}</button>
          {mode === "my-comments" && ["rejected", "hidden"].includes(item.status) ? <button className={styles.secondary} onClick={async () => {
            const reason = window.prompt("请填写申诉说明（3～300 个字符）"); if (!reason) return;
            try { await memberRequest("/api/community/appeals", { id: item.id, reason }); setNotice("申诉已提交，等待站方处理。"); } catch (cause) { setError(cause instanceof Error ? cause.message : "申诉未完成。"); }
          }}>提交申诉</button> : null}</div>
      </div>
    </article>)}</div>}
    <div className={styles.pagination}><button className={styles.secondary} disabled={page <= 1} onClick={() => { setLoading(true); setPage((n) => n - 1); }}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 20))} 页 · {total} 条</span><button className={styles.secondary} disabled={page * 20 >= total} onClick={() => { setLoading(true); setPage((n) => n + 1); }}>下一页</button></div>
  </>;
}
