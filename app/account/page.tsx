import type { Metadata } from "next";
import AccountPage from "@/app/components/members/AccountPage";
export const metadata: Metadata = { title: "我的账号｜烟斗派", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default function MemberAccountPage() { return <AccountPage />; }
