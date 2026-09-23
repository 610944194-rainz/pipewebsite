import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/analytics/auth";

export const metadata: Metadata = { title: "管理员登录｜烟斗派", robots: { index: false, follow: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/admin/analytics");
  const error = (await searchParams).error === "1";
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-20 text-[#23372f]">
      <p className="text-xs tracking-[0.25em] text-[#8b7760]">YANDOUBUY · PRIVATE</p>
      <h1 className="mt-5 text-3xl font-semibold">网站流量统计</h1>
      <p className="mt-3 text-sm text-[#66766c]">管理员登录后查看访问数据。</p>
      <form action="/api/analytics/login" method="post" className="mt-10 space-y-5 rounded-2xl border border-[#e5e5d8] bg-white p-6 shadow-sm">
        <label htmlFor="username" className="block text-sm font-medium">管理员账号</label>
        <input id="username" name="username" type="text" autoComplete="username" required className="w-full rounded-lg border border-[#cbd2ca] px-4 py-3 outline-none focus:border-[#315847]" />
        <label htmlFor="password" className="block text-sm font-medium">管理员密码</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="w-full rounded-lg border border-[#cbd2ca] px-4 py-3 outline-none focus:border-[#315847]" />
        {error && <p role="alert" className="text-sm text-[#a23b33]">账号或密码不正确，请重试。</p>}
        <button className="w-full rounded-lg bg-[#244938] px-4 py-3 text-sm font-medium text-white hover:bg-[#17382a]">登录查看</button>
      </form>
    </main>
  );
}
