"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type IconProps = { className?: string };
type SiteHeaderProps = { className?: string };

const navigation = [
  { title: "首页", label: "Home", href: "/" },
  { title: "海外库存", label: "Overseas Inventory", href: "/products" },
  { title: "国内斗师", label: "Domestic Makers", href: "/domestic-makers" },
  { title: "品牌档案", label: "Brands", href: "/brands" },
  { title: "选品服务", label: "Service", href: "/service" },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/domestic-makers") {
    return pathname.startsWith("/domestic-makers") || pathname.startsWith("/domestic-products");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteHeader({ className = "" }: SiteHeaderProps) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openPath === pathname;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPath(null);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const closeMenu = () => {
    setOpenPath(null);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <>
      <header className={`sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/96 backdrop-blur-sm ${className}`}>
        <div className="mx-auto grid h-[62px] max-w-[1200px] grid-cols-[44px_minmax(0,1fr)_44px] items-center px-4 sm:px-6 lg:flex lg:h-[70px] lg:px-10">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="打开菜单"
            aria-controls="site-mobile-menu"
            aria-expanded={open}
            onClick={() => setOpenPath(pathname)}
            className="inline-flex h-10 w-10 items-center justify-center text-[var(--text-primary)] transition-colors hover:text-[var(--coffee)] lg:hidden motion-reduce:transition-none"
          >
            <MenuIcon className="h-[22px] w-[22px]" />
          </button>

          <Link href="/" aria-label="烟斗派 YandouBuy 首页" className="flex min-w-0 items-center justify-center lg:justify-start">
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className="block h-auto w-[172px] max-w-full object-contain mix-blend-multiply lg:w-[190px]"
            />
          </Link>

          <span aria-hidden="true" className="block lg:hidden" />

          <nav aria-label="主导航" className="ml-auto hidden items-center gap-1 lg:flex">
            {navigation.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors motion-reduce:transition-none ${
                    active ? "text-[var(--coffee-dark)]" : "text-[var(--text-secondary)] hover:text-[var(--coffee)]"
                  }`}
                >
                  {item.title}
                  <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-px bg-[var(--brass)] transition-transform motion-reduce:transition-none ${active ? "scale-x-100" : "scale-x-0"}`} />
                </Link>
              );
            })}
            <Link href="/request" className="ml-3 border border-[var(--coffee-dark)] px-4 py-2 text-[12px] font-medium text-[var(--coffee-dark)] transition-colors hover:bg-[var(--coffee-dark)] hover:text-white motion-reduce:transition-none">
              提交找斗需求
            </Link>
          </nav>
        </div>
      </header>

      {open ? (
        <div id="site-mobile-menu" className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="关闭菜单" onClick={closeMenu} className="absolute inset-0 bg-[rgba(36,22,15,0.42)] backdrop-blur-[1px]" />
          <aside role="dialog" aria-modal="true" aria-label="网站导航" className="relative flex h-full w-[min(86vw,352px)] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] px-5 pb-6 pt-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <img src="/pics/yandoubuy-logo-header.png" alt="烟斗派 YandouBuy" className="h-auto w-[190px] max-w-[76%] object-contain object-left mix-blend-multiply" />
              <button ref={closeButtonRef} type="button" aria-label="关闭菜单" onClick={closeMenu} className="inline-flex h-10 w-10 items-center justify-center text-[var(--text-primary)] transition-colors hover:text-[var(--coffee)] motion-reduce:transition-none">
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <nav aria-label="移动端主导航" className="mt-4 border-y border-[var(--border)]">
              {navigation.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpenPath(null)}
                    aria-current={active ? "page" : undefined}
                    className="flex min-h-[62px] items-center justify-between border-b border-[var(--border)] py-3 last:border-b-0"
                  >
                    <span>
                      <span className="block text-[15px] font-medium text-[var(--text-primary)]">{item.title}</span>
                      <span className="mt-1 block text-[10px] tracking-[0.12em] text-[var(--text-secondary)]">{item.label}</span>
                    </span>
                    <span aria-hidden="true" className={`h-5 w-px ${active ? "bg-[var(--brass)]" : "bg-transparent"}`} />
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-[var(--border)] pt-5">
              <Link href="/request" onClick={() => setOpenPath(null)} className="flex h-11 items-center justify-center rounded-[8px] bg-[var(--coffee-dark)] text-[13px] font-medium text-white transition-colors hover:bg-[var(--coffee)] motion-reduce:transition-none">
                提交找斗需求
              </Link>
              <Link href="/cooperate" onClick={() => setOpenPath(null)} className="mt-3 flex h-10 items-center justify-center rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--brass)] motion-reduce:transition-none">
                合作入驻
              </Link>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function MenuIcon({ className = "" }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function CloseIcon({ className = "" }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export { SiteHeader };
