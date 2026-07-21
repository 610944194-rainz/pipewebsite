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
      <header className={`sticky top-0 z-40 border-b border-[rgba(222,212,200,0.46)] bg-[var(--surface)]/96 backdrop-blur-sm ${className}`}>
        <div className="relative mx-auto grid h-11 max-w-[1200px] grid-cols-[44px_minmax(0,1fr)_44px] items-center px-4 sm:px-6 lg:flex lg:h-11 lg:px-10">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="打开菜单"
            aria-controls="site-mobile-menu"
            aria-expanded={open}
            onClick={() => setOpenPath(pathname)}
            className="inline-flex h-11 w-11 items-center justify-center text-[var(--text-primary)] transition-colors hover:text-[var(--coffee)] lg:hidden motion-reduce:transition-none"
          >
            <MenuIcon className="h-[21px] w-[21px]" />
          </button>

          <Link href="/" aria-label="烟斗派 YandouBuy 首页" className="absolute left-[50vw] flex min-w-0 -translate-x-1/2 items-center justify-center lg:static lg:translate-x-0 lg:justify-start">
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className="block h-auto w-[150px] max-w-full object-contain mix-blend-multiply lg:w-[190px]"
            />
          </Link>

          <nav aria-label="主导航" className="ml-auto hidden items-center gap-1 lg:flex">
            {navigation.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative px-3 py-2 text-[13px] font-normal transition-colors motion-reduce:transition-none ${
                    active ? "text-[var(--coffee-dark)]" : "text-[var(--text-secondary)] hover:text-[var(--coffee)]"
                  }`}
                >
                  {item.title}
                  <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-px bg-[var(--brass)] transition-transform motion-reduce:transition-none ${active ? "scale-x-100" : "scale-x-0"}`} />
                </Link>
              );
            })}
            <Link href="/request" className="ml-3 border border-[var(--coffee-dark)] px-4 py-2 text-[13px] font-medium text-[var(--coffee-dark)] transition-colors hover:bg-[var(--coffee-dark)] hover:text-white motion-reduce:transition-none">
              提交找斗需求
            </Link>
          </nav>
        </div>
      </header>

      {open ? (
        <div id="site-mobile-menu" className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="关闭菜单" onClick={closeMenu} className="absolute inset-0 bg-[rgba(36,22,15,0.42)] backdrop-blur-[1px]" />
          <aside role="dialog" aria-modal="true" aria-label="网站导航" className="relative flex h-full w-[min(86vw,350px)] flex-col overflow-y-auto border-r border-[rgba(222,212,200,0.72)] bg-[var(--surface)] px-5 pb-6">
            <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-[rgba(222,212,200,0.58)]">
              <img src="/pics/yandoubuy-logo-header.png" alt="烟斗派 YandouBuy" className="h-auto w-[158px] max-w-[76%] object-contain object-left mix-blend-multiply" />
              <button ref={closeButtonRef} type="button" aria-label="关闭菜单" onClick={closeMenu} className="inline-flex h-10 w-10 items-center justify-center text-[var(--text-primary)] transition-colors hover:text-[var(--coffee)] motion-reduce:transition-none">
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <nav aria-label="移动端主导航" className="mt-2">
              {navigation.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpenPath(null)}
                    aria-current={active ? "page" : undefined}
                    className="flex h-16 items-center justify-between border-b border-[rgba(222,212,200,0.58)]"
                  >
                    <span>
                      <span className="block text-[17px] font-normal leading-[1.35] text-[var(--text-primary)]">{item.title}</span>
                      <span className="mt-1 block text-[10px] font-normal leading-[1.4] tracking-[0.12em] text-[var(--text-secondary)]">{item.label}</span>
                    </span>
                    <span aria-hidden="true" className={`h-6 w-px ${active ? "bg-[var(--brass)]" : "bg-transparent"}`} />
                  </Link>
                );
              })}
            </nav>

            <div className="mt-8 border-t border-[rgba(222,212,200,0.72)] pt-5">
              <Link href="/request" onClick={() => setOpenPath(null)} className="flex h-[46px] items-center justify-center rounded-[4px] bg-[var(--coffee-dark)] text-[14px] font-medium text-[#f4eee7] transition-colors hover:bg-[var(--coffee)] motion-reduce:transition-none">
                提交找斗需求
              </Link>
              <Link href="/cooperate" onClick={() => setOpenPath(null)} className="mt-2.5 flex h-[42px] items-center justify-center text-[13px] font-normal text-[var(--text-secondary)] transition-colors hover:text-[var(--coffee)] motion-reduce:transition-none">
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
