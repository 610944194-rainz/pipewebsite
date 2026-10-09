"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { memberRequest } from "@/lib/members/client";
import styles from "./members.module.css";

type Row = { id: string; name?: string; email?: string; role?: string; muted?: number; status?: string; identityStatus?: string; identityChannel?: string; createdAt: string; content?: string; author?: string; blendTitle?: string; reason?: string; href?: string; kind?: string; resolution?: string; action?: string; actor?: string; targetId?: string; details?: string; commentId?: string };
type Section = "members" | "comments" | "reports" | "audit";
const statuses: Record<string, string> = { member: "普通会员", moderator: "留言管理员", site_admin: "网站管理员", owner: "站长", active: "正常", banned: "已封禁", pending: "待审核", published: "已公开", rejected: "未通过", hidden: "已隐藏", unrecorded: "未记录核验", verified: "站方已核验", open: "待处理", resolved: "已处理" };

export default function AdminDashboard({ role, name }: { role: string; name: string }) {
  const [section, setSection] = useState<Section>(role === "moderator" ? "comments" : "members"), [rows, setRows] = useState<Row[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0), [query, setQuery] = useState(""), [search, setSearch] = useState(""), [status, setStatus] = useState(""), [revision, setRevision] = useState(0), [password, setPassword] = useState(""), [grantUntil, setGrantUntil] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState<boolean | null>(null), [factorEnabled, setFactorEnabled] = useState<boolean | null>(null), [code, setCode] = useState(""), [useRecovery, setUseRecovery] = useState(false), [setupKey, setSetupKey] = useState(""), [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  useEffect(() => { let live = true; memberRequest<{ grantUntil: number; enabled: boolean; mfaRequired: boolean }>("/api/member-admin/me").then((data) => { if (live) { setMfaRequired(data.mfaRequired); setFactorEnabled(data.enabled); setGrantUntil(data.grantUntil > Date.now() ? data.grantUntil : 0); } }).catch((cause) => { if (live) setError(cause.message); }); return () => { live = false; }; }, []);
  useEffect(() => { if (!grantUntil) return; const timer = setInterval(() => { if (Date.now() >= grantUntil) setGrantUntil(0); }, 1000); return () => clearInterval(timer); }, [grantUntil]);
  useEffect(() => {
    if (!grantUntil) return;
    let live = true;
    const params = new URLSearchParams({ page: String(page), q: search, status });
    memberRequest<{ rows: Row[]; total: number }>(`/api/member-admin/${section}?${params}`).then((data) => { if (live) { setRows(data.rows); setTotal(data.total); setLoading(false); } }).catch((cause) => { if (live) { setError(cause.message); setLoading(false); } });
    return () => { live = false; };
  }, [section, page, search, status, revision, grantUntil]);
  async function perform(path: string, body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try { await memberRequest(`/api/member-admin/${path}`, body); setNotice("操作已保存，并记录在管理日志中。"); setRevision((n) => n + 1); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "操作失败。"; setError(message); if (message.includes("验证管理员密码")) { setGrantUntil(0); setRows([]); } throw cause; }
    finally { setBusy(false); }
  }
  const tabs: [Section, string][] = role === "moderator" ? [["comments", "留言管理"], ["reports", "举报 / 申诉"]] : [["members", "会员管理"], ["comments", "留言管理"], ["reports", "举报 / 申诉"], ["audit", "管理日志"]];
  return <>
    <h2 className={styles.title}>会员与留言管理</h2><p className={styles.subtitle}>{name} · {statuses[role]}　<Link className={styles.link} href="/account">返回账号</Link></p>
    <form className={styles.form} onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        if (mfaRequired && !factorEnabled && !setupKey) {
          const data = await memberRequest<{ setupKey: string }>("/api/member-admin/factor/setup", { password }); setSetupKey(data.setupKey); setNotice("请在验证器中手动添加账号，再输入当前验证码完成设置。");
        } else {
          const data = await memberRequest<{ grantUntil: number; recoveryCodes?: string[] }>(mfaRequired && setupKey ? "/api/member-admin/factor/confirm" : "/api/member-admin/reauth", mfaRequired ? { password, code: useRecovery ? undefined : code, recoveryCode: useRecovery ? code : undefined } : { password });
          setGrantUntil(data.grantUntil); setFactorEnabled(Boolean(mfaRequired)); setSetupKey(""); setCode(""); setRecoveryCodes(data.recoveryCodes || []); setNotice("管理访问已解锁，有效期 5 分钟。");
        }
        setPassword("");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "验证失败。"); } finally { setBusy(false); }
    }}><label className={styles.label}>验证管理员密码<input className={styles.input} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {setupKey ? <p className={styles.small}>验证器账号：烟斗派；密钥：<code style={{ overflowWrap: "anywhere" }}>{setupKey}</code>。选择基于时间、6 位数字、30 秒。设置 10 分钟内有效，请再次输入密码及验证码。</p> : null}
    {factorEnabled || setupKey ? <label className={styles.label}>{useRecovery ? "一次性恢复码" : "验证器验证码"}<input className={styles.input} autoComplete="one-time-code" inputMode={useRecovery ? "text" : "numeric"} required value={code} maxLength={useRecovery ? 20 : 6} pattern={useRecovery ? "[a-f0-9]{20}" : "[0-9]{6}"} onChange={(event) => setCode(event.target.value.trim())} /></label> : null}
    {factorEnabled ? <label className={styles.small}><input type="checkbox" checked={useRecovery} onChange={(event) => { setUseRecovery(event.target.checked); setCode(""); }} /> 使用恢复码</label> : null}
    <button className={styles.secondary} disabled={busy || mfaRequired === null}>{!mfaRequired ? "验证密码并进入后台" : setupKey ? "确认启用验证器" : factorEnabled ? "解锁管理访问" : "设置管理员验证器"}</button></form>
    {recoveryCodes.length ? <div className={styles.adminCard}><p>请将以下恢复码保存到密码管理器，每个仅能使用一次，关闭后不再显示。不要发送到聊天或截图。</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{recoveryCodes.join("\n")}</pre><button className={styles.secondary} onClick={() => setRecoveryCodes([])}>已私密保存，关闭</button></div> : null}
    {mfaRequired && grantUntil ? <button className={styles.secondary} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const data = await memberRequest<{ recoveryCodes: string[] }>("/api/member-admin/factor/recovery", { password }); setRecoveryCodes(data.recoveryCodes); setPassword(""); setNotice("旧恢复码已失效，请保存新恢复码。"); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); } finally { setBusy(false); } }}>重新输入上方密码后更换恢复码</button> : null}
    <p className={`${styles.small} ${styles.adminNotice}`}>{grantUntil ? "管理访问已解锁。" : mfaRequired ? "会员资料、留言和管理操作均需先验证密码和验证器。" : "请输入当前账号密码，进入会员与留言管理。"}</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {grantUntil ? <><nav className={styles.tabs}>{tabs.map(([key, label]) => <button key={key} className={section === key ? styles.link : ""} aria-pressed={section === key} onClick={() => { setSection(key); setPage(1); setStatus(""); setSearch(""); setQuery(""); setError(""); setLoading(true); }}>{label}</button>)}</nav>
    {section !== "audit" ? <form className={styles.row} onSubmit={(event) => { event.preventDefault(); setSearch(query); setPage(1); setLoading(true); setRevision((n) => n + 1); }}>
      {section !== "reports" ? <input className={styles.input} style={{ maxWidth: 280 }} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={section === "members" ? "搜索昵称或邮箱" : "搜索留言或昵称"} placeholder={section === "members" ? "搜索昵称或邮箱" : "搜索留言或昵称"} /> : null}
      <select className={styles.input} style={{ maxWidth: 160 }} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setLoading(true); }} aria-label="筛选状态"><option value="">全部状态</option>{(section === "members" ? ["active", "banned"] : section === "comments" ? ["pending", "published", "rejected", "hidden"] : ["open", "resolved"]).map((value) => <option value={value} key={value}>{statuses[value]}</option>)}</select><button className={styles.secondary}>查询</button>
    </form> : null}
    {loading ? <p>正在读取…</p> : <div className={styles.adminGrid}>{!rows.length ? <p className={styles.subtitle}>当前没有记录。</p> : rows.map((row) => <article className={styles.adminCard} key={`${section}:${row.id}`}>
      {section === "members" ? <><h3>{row.name}</h3><p className={styles.small}>{row.email}</p><p className={styles.small}>{statuses[row.role || ""]} · {statuses[row.status || ""]} · {row.muted ? "已禁言" : "可留言"} · {statuses[row.identityStatus || ""]}</p>{row.identityChannel ? <p className={styles.small}>核验渠道：{row.identityChannel}</p> : null}<MemberAction row={row} role={role} disabled={busy || !grantUntil || row.role === "owner"} perform={perform} /></> : null}
      {section === "comments" ? <><h3>{row.blendTitle}</h3><p className={styles.small}>{row.author} · {statuses[row.status || ""]} · {statuses[row.identityStatus || ""]}</p><p className={styles.commentText}>{row.content}</p>{row.reason ? <p className={styles.small}>说明：{row.reason}</p> : null}{row.href ? <Link className={styles.link} href={row.href}>查看斗草详情</Link> : <p className={styles.small}>条目已归档，历史留言仍可管理。</p>}<CommentAction row={row} disabled={busy || !grantUntil} perform={perform} /></> : null}
      {section === "reports" ? <><h3>{row.kind === "appeal" ? "留言申诉" : "留言举报"} · {statuses[row.status || ""]}</h3><p className={styles.small}>提交者：{row.author} · 留言编号：{row.commentId}</p><p className={styles.commentText}>{row.reason}</p><p className={styles.commentText}>原留言：{row.content || "已删除"}</p>{row.resolution ? <p className={styles.small}>处理结果：{row.resolution}</p> : null}<ResolutionAction row={row} disabled={busy || !grantUntil || row.status === "resolved"} perform={perform} /></> : null}
      {section === "audit" ? <><h3>{row.action}</h3><p className={styles.small}>{row.actor} · {new Date(row.createdAt).toLocaleString("zh-CN")}</p><p className={styles.small}>对象编号：{row.targetId}</p><p className={styles.commentText}>{row.reason}</p><p className={styles.small}>{row.details === "{}" ? "" : row.details}</p></> : null}
    </article>)}</div>}
    <div className={styles.pagination}><button className={styles.secondary} disabled={page <= 1} onClick={() => { setPage((n) => n - 1); setLoading(true); }}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 20))} 页 · {total} 条</span><button className={styles.secondary} disabled={page * 20 >= total} onClick={() => { setPage((n) => n + 1); setLoading(true); }}>下一页</button></div></> : null}
  </>;
}

type ActionProps = { row: Row; disabled: boolean; perform: (path: string, body: Record<string, unknown>) => Promise<void> };
function MemberAction({ row, role, disabled, perform }: ActionProps & { role: string }) {
  const [operation, setOperation] = useState("mute"), [value, setValue] = useState("true"), [reason, setReason] = useState(""), [channel, setChannel] = useState(""), [password, setPassword] = useState("");
  const options: Record<string, [string, string][]> = { mute: [["true", "禁言"], ["false", "解除禁言"]], status: [["banned", "封禁"], ["active", "解除封禁"]], identity: [["verified", "已通过外部核验"], ["unrecorded", "撤销核验记录"], ["rejected", "核验未通过"]], role: [["member", "普通会员"], ["moderator", "留言管理员"], ["site_admin", "网站管理员"]] };
  return <form className={styles.form} style={{ marginTop: 20 }} onSubmit={async (event) => {
    event.preventDefault(); if (operation === "delete" && !window.confirm(`删除会员「${row.name}」？账号会失效，收藏与留言会清除。`)) return;
    try { await perform("members", { id: row.id, operation, value: operation === "mute" ? value === "true" : value, reason, channel, password: operation === "password" ? password : undefined }); setPassword(""); setReason(""); } catch {}
  }}>
    <label className={styles.label}>会员操作<select className={styles.input} disabled={disabled} value={operation} onChange={(event) => { const next = event.target.value; setOperation(next); setValue(options[next]?.[0][0] || ""); }}><option value="mute">留言权限</option><option value="status">封禁 / 解封</option><option value="identity">外部实名核验</option><option value="password">重置密码</option><option value="delete">删除会员</option>{role === "owner" ? <option value="role">管理角色</option> : null}</select></label>
    {options[operation] ? <label className={styles.label}>操作结果<select className={styles.input} disabled={disabled} value={value} onChange={(event) => setValue(event.target.value)}>{options[operation].map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label> : null}
    {operation === "identity" && value === "verified" ? <label className={styles.label}>核验渠道<input className={styles.input} value={channel} onChange={(event) => setChannel(event.target.value)} required minLength={2} maxLength={60} placeholder="例如：线下核验，不填写证件号码" /></label> : null}
    {operation === "password" ? <label className={styles.label}>新密码<input className={styles.input} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} maxLength={128} placeholder="至少 6 个字符" /></label> : null}
    <label className={styles.label}>操作原因<input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={200} placeholder="填写处理原因" /></label><button className={styles.secondary} disabled={disabled}>保存会员操作</button>
  </form>;
}
function CommentAction({ row, disabled, perform }: ActionProps) {
  const [status, setStatus] = useState("published"), [reason, setReason] = useState("");
  return <form className={styles.form} style={{ marginTop: 20 }} onSubmit={async (event) => { event.preventDefault(); if (status === "deleted" && !window.confirm("删除这条留言？正文将清除。")) return; try { await perform("comments", { id: row.id, status, reason }); setReason(""); } catch {} }}><label className={styles.label}>审核操作<select className={styles.input} disabled={disabled} value={status} onChange={(event) => setStatus(event.target.value)}><option value="published" disabled={row.identityStatus !== "verified"}>通过并公开（需完成核验）</option><option value="rejected">拒绝公开</option><option value="hidden">隐藏留言</option><option value="deleted">删除留言</option></select></label><label className={styles.label}>处理说明<input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={200} /></label><button className={styles.secondary} disabled={disabled || (status === "published" && row.identityStatus !== "verified")}>保存审核结果</button></form>;
}
function ResolutionAction({ row, disabled, perform }: ActionProps) {
  const [reason, setReason] = useState("");
  return <form className={styles.form} style={{ marginTop: 20 }} onSubmit={async (event) => { event.preventDefault(); try { await perform("reports", { id: row.id, reason }); setReason(""); } catch {} }}><label className={styles.label}>处理结果<input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={200} /></label><button className={styles.secondary} disabled={disabled}>完成反馈处理</button></form>;
}
