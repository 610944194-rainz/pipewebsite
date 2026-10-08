import type { Metadata } from "next";
import AuthForm from "@/app/components/members/AuthForm";
import MemberShell from "@/app/components/members/MemberShell";
import { safeReturnTo } from "@/lib/members/policy.mjs";
export const metadata: Metadata = { title: "免费注册｜烟斗派", robots: { index: false, follow: false } };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <MemberShell><AuthForm mode="register" returnTo={safeReturnTo(params.returnTo)} /></MemberShell>;
}
