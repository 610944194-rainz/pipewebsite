import type { Metadata } from "next";
import AccountPage from "@/app/components/members/AccountPage";
export const metadata: Metadata = { title: "账号安全｜烟斗派", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default function SecurityPage() { return <AccountPage security />; }
