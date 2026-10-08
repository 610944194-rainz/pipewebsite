"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { memberRequest, type MemberUser } from "@/lib/members/client";
import styles from "./members.module.css";

type Device = { id: string; current: boolean; userAgent: string | null; createdAt: number; expiresAt: number };
export default function AccountClient({ user, security = false }: { user: MemberUser; security?: boolean }) {
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [oldOtp, setOldOtp] = useState("");
  const [newOtp, setNewOtp] = useState("");
  const [emailStep, setEmailStep] = useState(0);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!security) return; let live = true; memberRequest<{ sessions: Device[] }>("/api/members/sessions").then((data) => { if (live) setDevices(data.sessions); }).catch(() => { if (live) setError("暂时无法读取登录设备，请刷新后重试。"); }); return () => { live = false; }; }, [security]);

  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作未完成，请稍后再试。"); }
    finally { setBusy(false); }
  }
  return <>
    <div className={styles.between}><h2 className={styles.title}>{security ? "账号安全" : `你好，${user.name}`}</h2><button className={styles.secondary} disabled={busy} onClick={() => action(async () => { await memberRequest("/api/auth/sign-out", {}); window.location.assign("/login"); })}>退出登录</button></div>
    <nav className={styles.tabs}><Link aria-current={!security ? "page" : undefined} className={!security ? styles.link : ""} href="/account">账号资料</Link><Link aria-current={security ? "page" : undefined} className={security ? styles.link : ""} href="/account/security">账号安全</Link></nav>
    <p className={styles.subtitle}>你的邮箱 <strong className={styles.email}>{user.email}</strong> 已验证。</p>
    <div className={styles.row}><Link className={styles.link} href="/account/favorites">我的收藏</Link><Link className={styles.link} href="/account/comments">我的留言</Link><Link className={styles.link} href="/tobacco-encyclopedia/index.html">斗草百科</Link>{["owner", "site_admin", "moderator"].includes(user.role || "") ? <Link className={styles.link} href="/admin/members">会员与留言管理</Link> : null}</div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {!security ? <>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); action(async () => { await memberRequest("/api/auth/update-user", { name }); setNotice("昵称已更新。"); }); }}>
        <label className={styles.label}>昵称<input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={24} autoComplete="nickname" /></label><button className={styles.primary} disabled={busy}>保存昵称</button>
      </form>
      <div className={`${styles.section} ${styles.detail}`}><p><span>注册时间：</span>{new Date(user.createdAt).toLocaleDateString("zh-CN")}</p><p><span>实名核验：</span>{user.identityStatus === "verified" ? "站方已核验" : user.identityStatus === "rejected" ? "请联系站方了解核验结果" : "由站方通过其他渠道核验"}</p><p className={styles.small}>邮箱用于登录和账号恢复，不会在公开留言中展示。</p></div>
    </> : <>
      <section className={styles.section}><h3>修改密码</h3><form className={styles.form} onSubmit={(e) => { e.preventDefault(); action(async () => { await memberRequest("/api/auth/change-password", { currentPassword, newPassword }); setCurrentPassword(""); setNewPassword(""); setNotice("密码已更新，其他登录设备已退出。"); const data = await memberRequest<{ sessions: Device[] }>("/api/members/sessions"); setDevices(data.sessions); }); }}>
        <label className={styles.label}>当前密码<input className={styles.input} type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label>
        <label className={styles.label}>新密码<input className={styles.input} type="password" required minLength={6} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="至少 6 个字符" /></label>
        <button className={styles.primary} disabled={busy}>更新密码</button></form></section>
      <section className={styles.section}><h3>更换邮箱</h3><p className={styles.subtitle}>依次验证当前邮箱和新邮箱，完成后其他设备会退出。</p><form className={styles.form} onSubmit={(e) => { e.preventDefault(); action(async () => {
        if (emailStep < 2) { await memberRequest("/api/auth/email-otp/request-email-change", { newEmail, otp: oldOtp }); setEmailStep(2); setNotice("若新邮箱可绑定，新验证码将发送至该邮箱。"); }
        else { await memberRequest("/api/auth/email-otp/change-email", { newEmail, otp: newOtp }); window.location.assign("/account/security"); }
      }); }}>
        <label className={styles.label}>新邮箱<input className={styles.input} type="email" required disabled={emailStep === 2} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" maxLength={254} /></label>
        {emailStep < 2 ? <label className={styles.label}>当前邮箱验证码<div className={styles.codeRow}><input className={styles.input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={oldOtp} onChange={(e) => setOldOtp(e.target.value.replace(/\D/g, ""))} /><button className={styles.secondary} type="button" disabled={busy} onClick={() => action(async () => { await memberRequest("/api/auth/email-otp/send-verification-otp", { email: user.email, type: "email-verification" }); setEmailStep(1); setNotice("验证码已发送至当前邮箱。"); })}>验证当前邮箱</button></div></label> : <label className={styles.label}>新邮箱验证码<input className={styles.input} required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" value={newOtp} onChange={(e) => setNewOtp(e.target.value.replace(/\D/g, ""))} /></label>}
        <button className={styles.primary} disabled={busy}>{emailStep < 2 ? "验证当前邮箱并发送新验证码" : "确认更换邮箱"}</button>
        {emailStep === 2 ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => { setEmailStep(0); setOldOtp(""); setNewOtp(""); setNotice("请重新验证当前邮箱，再获取新邮箱验证码。"); }}>验证码过期？重新开始</button> : null}
      </form></section>
      <section className={styles.section}><h3>登录设备</h3><div className={styles.devices}>{devices.map((device) => <div className={styles.device} key={device.id}><strong>{device.current ? "当前设备" : "其他设备"}</strong><p>{device.userAgent || "浏览器设备"}</p><button className={styles.secondary} disabled={busy} onClick={() => action(async () => { await memberRequest("/api/members/sessions/revoke", { id: device.id }); if (device.current) window.location.assign("/login"); else setDevices((rows) => rows.filter((row) => row.id !== device.id)); })}>退出此设备</button></div>)}</div><button className={styles.secondary} disabled={busy} style={{ marginTop: 16 }} onClick={() => action(async () => { await memberRequest("/api/members/sessions/revoke-all", {}); window.location.assign("/login"); })}>退出所有设备</button></section>
    </>}
  </>;
}
