import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/members/admin";
import MemberShell from "@/app/components/members/MemberShell";
import AdminDashboard from "@/app/components/members/AdminDashboard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "网站管理后台｜烟斗派", robots: { index: false, follow: false } };
export default async function MemberAdminPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  let admin;
  try { admin = await requireAdmin(await headers()); }
  catch (cause) { if ((cause as { status?: number }).status === 403) notFound(); redirect("/login?returnTo=" + encodeURIComponent("/admin/members" + ((await searchParams).section === "analytics" ? "?section=analytics" : ""))); }
  return <MemberShell wide><AdminDashboard role={admin.role} name={admin.member.user.name} initialSection={(await searchParams).section} /></MemberShell>;
}
