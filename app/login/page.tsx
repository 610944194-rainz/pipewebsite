import type { Metadata } from "next";
import AuthForm from "@/app/components/members/AuthForm";
import MemberShell from "@/app/components/members/MemberShell";
import { safeReturnTo } from "@/lib/members/policy.mjs";
export const metadata: Metadata = { title: "登录｜烟斗派", robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <MemberShell><AuthForm mode="login" returnTo={safeReturnTo(params.returnTo)} reset={params.reset === "1"} /></MemberShell>;
}
