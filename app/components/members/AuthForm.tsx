"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { memberRequest } from "@/lib/members/client";
import styles from "./members.module.css";

type Mode = "login" | "register" | "forgot";
export default function AuthForm({ mode, returnTo, reset = false }: { mode: Mode; returnTo: string; reset?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [terms, setTerms] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(reset ? "密码已重置，请使用新密码登录。" : "");
  const [availability, setAvailability] = useState<{ ready: boolean; mailReady: boolean } | null>(null);

  useEffect(() => { let live = true; memberRequest<{ ready: boolean; mailReady: boolean }>("/api/members/status").then((data) => { if (live) setAvailability(data); }).catch(() => { if (live) setAvailability({ ready: false, mailReady: false }); }); return () => { live = false; }; }, []);
  useEffect(() => { if (cooldown <= 0) return; const timer = setTimeout(() => setCooldown((n) => n - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  const title = mode === "login" ? "欢迎回来" : mode === "register" ? "创建斗友账号" : "找回密码";
  const subtitle = mode === "login" ? "用邮箱和密码，回到你的斗友空间。" : mode === "register" ? "验证邮箱，开启你的收藏与交流。" : "通过注册邮箱验证，设置新的密码。";
  const disabled = busy || !availability?.ready || (mode !== "login" && !availability.mailReady);

  async function sendCode() {
    setError(""); setNotice(""); setBusy(true);
    try {
      const result = await memberRequest<{ message?: string }>(mode === "register" ? "/api/members/registration/code" : "/api/auth/email-otp/request-password-reset", { email });
      setNotice(result.message || "若该邮箱已有账号，验证码将发送至你的邮箱，请检查收件箱和垃圾箱。");
      setCooldown(60);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败，请稍后再试。"); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "login") await memberRequest("/api/auth/sign-in/email", { email, password, rememberMe: remember });
      if (mode === "register") await memberRequest("/api/members/registration", { email, name, password, otp, termsAccepted: terms });
      if (mode === "forgot") { await memberRequest("/api/auth/email-otp/reset-password", { email, otp, password }); window.location.assign("/login?reset=1"); return; }
      window.location.assign(returnTo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法完成，请稍后再试。"); }
    finally { setBusy(false); }
  }

  return <>
    <h2 className={styles.title}>{title}</h2><p className={styles.subtitle}>{subtitle}</p>
    <form onSubmit={submit} className={styles.form}>
      {availability && (!availability.ready || (mode !== "login" && !availability.mailReady)) ? <p className={styles.notice} role="status">{!availability.ready ? "账号服务暂未开通，请稍后再试。" : "验证邮件服务暂未开通，请稍后再试。"}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <label className={styles.label}>邮箱<input className={styles.input} type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="你的常用邮箱" /></label>
      {mode !== "login" ? <label className={styles.label}>邮箱验证码<div className={styles.codeRow}>
        <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="6 位验证码" />
        <button className={styles.secondary} type="button" disabled={disabled || cooldown > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={sendCode}>{cooldown > 0 ? `${cooldown} 秒后重发` : "获取验证码"}</button>
      </div></label> : null}
      {mode === "register" ? <label className={styles.label}>昵称<input className={styles.input} required minLength={2} maxLength={24} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="斗友们如何称呼你" /></label> : null}
      <label className={styles.label}>{mode === "forgot" ? "新密码" : "密码"}<input className={styles.input} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 6} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "login" ? "输入密码" : "至少 6 个字符"} /></label>
      {mode === "login" ? <div className={styles.between}><label className={styles.check}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />记住登录</label><Link className={`${styles.small} ${styles.link}`} href="/forgot-password">忘记密码？</Link></div> : null}
      {mode === "register" ? <label className={styles.check}><input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>我已阅读并同意 <Link className={styles.link} href="/membership-terms" target="_blank">服务协议</Link> 和 <Link className={styles.link} href="/membership-privacy" target="_blank">隐私说明</Link></span></label> : null}
      <button className={styles.primary} type="submit" disabled={disabled}>{busy ? "请稍候…" : mode === "login" ? "登录" : mode === "register" ? "验证并创建账号" : "重置密码"}</button>
    </form>
    <div className={styles.footer}>{mode === "login" ? <>还没有账号？ <Link className={styles.link} href={`/register?returnTo=${encodeURIComponent(returnTo)}`}>免费注册</Link></> : <Link className={styles.link} href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>已有账号，返回登录</Link>}</div>
  </>;
}
