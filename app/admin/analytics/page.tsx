import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "浏览统计｜烟斗派", robots: { index: false, follow: false } };

export default function LegacyAnalytics() {
  redirect("/admin/members?section=analytics");
}
