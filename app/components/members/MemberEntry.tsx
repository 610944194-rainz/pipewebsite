"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { memberRequest, type MemberUser } from "@/lib/members/client";

export default function MemberEntry({ dark = false, compact = false, onNavigate }: { dark?: boolean; compact?: boolean; onNavigate?: () => void }) {
  const [user, setUser] = useState<MemberUser | null>(null);
  const pathname = usePathname();
  useEffect(() => { let live = true; memberRequest<{ user: MemberUser | null }>("/api/members/session").then((data) => { if (live) setUser(data.user); }).catch(() => {}); return () => { live = false; }; }, [pathname]);
  return <Link href={user ? "/account" : `/login?returnTo=${encodeURIComponent(pathname)}`} onClick={(event) => {
    onNavigate?.();
    if (!user && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
    }
  }} className={compact ? "inline-flex h-11 items-center justify-center gap-1.5 px-3 text-[12px] text-white transition-colors hover:text-[#e4c18d] motion-reduce:transition-none" : `inline-flex min-h-10 items-center px-3 py-2 text-[13px] ${dark ? "text-[#e4c18d]" : "text-[var(--coffee)]"}`} aria-label={user ? "打开我的账号" : "登录或注册账号"}>{compact ? <><svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><span>{user ? "我的账号" : "登录"}</span></> : user ? "我的账号" : "登录 / 注册"}</Link>;
}
