import type { Metadata } from "next";
import MemberShell from "@/app/components/members/MemberShell";
import styles from "@/app/components/members/members.module.css";
export const metadata: Metadata = { title: "账号服务协议｜烟斗派" };
export default function TermsPage() { return <MemberShell wide><h2 className={styles.title}>账号服务协议</h2><p className={styles.subtitle}>版本：2026 年 10 月 6 日</p><div className={styles.detail}>
  <p>烟斗派账号注册和基本账号服务免费。请使用本人可控制的邮箱注册，妥善保管密码及验证码，不冒用他人或官方身份。</p>
  <p>账号可用于收藏烟斗和提交交流留言。真实身份由站方通过其他渠道核验；公开留言经站方审核后展示。禁止违法内容、骚扰、冒充、垃圾信息及交易引流。</p>
  <p>你可以修改自己的资料、撤回自己的留言，并对被拒绝或隐藏的留言提出申诉。对违规行为，站方可拒绝发布、隐藏或删除留言，并根据原因采取禁言、封禁或关闭账号等措施。</p>
  <p>对处置结果有异议，或需要注销账号，请通过网站联系入口联系站方。站方按已说明的规则处理，必要处置记录与个人资料分别管理。</p>
  <p>邮件发送受服务商免费额度和防刷限制。验证码暂时无法发送时请稍后重试；免费额度用尽不会自动向你收费。</p>
  <p>网站库存和商品资料供参考，收藏不代表预订、购买或实时库存保证。站方调整服务规则时会说明变更内容。</p>
  </div></MemberShell>; }
