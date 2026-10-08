"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { memberRequest, type MemberUser } from "@/lib/members/client";

export default function MemberEntry({ dark = false, onNavigate }: { dark?: boolean; onNavigate?: () => void }) {
  const [user, setUser] = useState<MemberUser | null>(null);
  const pathname = usePathname();
  useEffect(() => { let live = true; memberRequest<{ user: MemberUser | null }>("/api/members/session").then((data) => { if (live) setUser(data.user); }).catch(() => {}); return () => { live = false; }; }, [pathname]);
  return <Link href={user ? "/account" : `/login?returnTo=${encodeURIComponent(pathname)}`} onClick={(event) => {
    onNavigate?.();
    if (!user && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
    }
  }} className={`inline-flex min-h-10 items-center px-3 py-2 text-[13px] ${dark ? "text-[#e4c18d]" : "text-[var(--coffee)]"}`} aria-label={user ? "打开我的账号" : "登录或注册账号"}>{user ? "我的账号" : "登录 / 注册"}</Link>;
}
