import type { Metadata } from "next";
import MemberShell from "@/app/components/members/MemberShell";
import styles from "@/app/components/members/members.module.css";
export const metadata: Metadata = { title: "账号隐私说明｜烟斗派" };
export default function PrivacyPage() { return <MemberShell wide><h2 className={styles.title}>账号隐私说明</h2><p className={styles.subtitle}>版本：2026 年 10 月 6 日</p><div className={styles.detail}>
  <p>账号功能处理邮箱、昵称、安全处理后的密码、登录会话及必要的设备信息，用于注册、登录、密码恢复、安全防护和账号管理。</p>
  <p>收藏记录默认私密；公开留言仅展示昵称与审核通过的内容，不公开邮箱。外部实名核验由站方完成，网站仅记录核验状态、渠道、时间及必要参考信息。</p>
  <p>网站使用必要的登录 Cookie 保持会话，你可退出当前设备或所有设备。安全保护使用必要的请求信息和限流记录。</p>
  <p>验证码邮件由 Resend 处理，为投递所需，收件邮箱和验证码邮件会提交给该服务。会员服务部署于香港服务器。请在注册前了解这些处理方式。</p>
  <p>网站不以明文保存密码，不在日志中记录密码或验证码，不要求通过会员页面上传身份证照片。管理员按权限访问必要资料。</p>
  <p>账号资料在提供服务所需期间保存；申请注销、修改资料或处理隐私问题，请通过网站联系入口联系站方。必要处置记录依适用要求受限保留，具体请求由站方处理。</p>
  </div></MemberShell>; }
