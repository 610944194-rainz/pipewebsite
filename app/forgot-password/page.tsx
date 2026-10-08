import type { Metadata } from "next";
import AuthForm from "@/app/components/members/AuthForm";
import MemberShell from "@/app/components/members/MemberShell";
export const metadata: Metadata = { title: "找回密码｜烟斗派", robots: { index: false, follow: false } };
export default function ForgotPasswordPage() { return <MemberShell><AuthForm mode="forgot" returnTo="/account" /></MemberShell>; }
