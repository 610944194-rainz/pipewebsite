import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberSession } from "@/lib/members/auth";
import MemberShell from "@/app/components/members/MemberShell";
import MemberCollections from "@/app/components/members/MemberCollections";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "我的收藏｜烟斗派", robots: { index: false, follow: false } };
export default async function FavoritesPage() {
  const member = await getMemberSession(await headers()).catch(() => null);
  if (!member) redirect("/login?returnTo=%2Faccount%2Ffavorites");
  return <MemberShell wide><MemberCollections mode="favorites" /></MemberShell>;
}
