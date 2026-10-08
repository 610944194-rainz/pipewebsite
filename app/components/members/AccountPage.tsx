import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberSession } from "@/lib/members/auth";
import MemberShell from "./MemberShell";
import AccountClient from "./AccountClient";

export default async function AccountPage({ security = false }: { security?: boolean }) {
  let member;
  try { member = await getMemberSession(await headers()); } catch { member = null; }
  if (!member) redirect(`/login?returnTo=${encodeURIComponent(security ? "/account/security" : "/account")}`);
  return <MemberShell wide><AccountClient security={security} user={{ id: member.user.id, name: member.user.name, email: member.user.email, emailVerified: member.user.emailVerified, createdAt: member.user.createdAt.toISOString(), identityStatus: String(member.profile.identity_status), role: String(member.profile.role) }} /></MemberShell>;
}
