"use client";
import { useEffect, useState } from "react";
import { memberRequest } from "@/lib/members/client";
import styles from "./members.module.css";

export default function FavoriteButton({ productId, kind }: { productId: string; kind: "overseas" | "domestic" }) {
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    memberRequest<{ user: unknown }>("/api/members/session").then(async (data) => {
      if (!data.user) return;
      const result = await memberRequest<{ saved: boolean }>(`/api/community/favorites?productId=${encodeURIComponent(productId)}&kind=${kind}`);
      if (live) setSaved(result.saved);
    }).catch(() => {});
    return () => { live = false; };
  }, [productId, kind]);
  return <div style={{ marginTop: 12 }}><button className={styles.secondary} style={{ width: "100%" }} disabled={busy} aria-pressed={saved} onClick={async () => {
    setBusy(true); setError("");
    try {
      const session = await memberRequest<{ user: unknown }>("/api/members/session");
      if (!session.user) { window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`); return; }
      const result = await memberRequest<{ saved: boolean }>("/api/community/favorites", { productId, kind, save: !saved });
      setSaved(result.saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "收藏未完成，请重试。"); }
    finally { setBusy(false); }
  }}>{busy ? "请稍候…" : saved ? "♥ 已收藏 · 点击取消" : "♡ 收藏这只斗"}</button>{error ? <p className={styles.error} role="alert">{error}</p> : null}</div>;
}
