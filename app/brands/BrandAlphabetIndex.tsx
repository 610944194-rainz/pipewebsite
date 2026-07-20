"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type BrandAlphabetIndexProps = {
  activeLetter: string;
  query: string;
  letters: string[];
};

function buildHref(query: string, letter?: string) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (letter) params.set("letter", letter);
  const value = params.toString();
  return value ? `/brands?${value}` : "/brands";
}

export default function BrandAlphabetIndex({ activeLetter, query, letters }: BrandAlphabetIndexProps) {
  const activeItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeItemRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeLetter, query]);

  return (
    <nav className="brands-letter-index -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10" aria-label="品牌首字母索引">
      <div className="flex min-w-max items-center whitespace-nowrap">
        <Link
          href="/brands"
          ref={!activeLetter && !query ? activeItemRef : undefined}
          aria-current={!activeLetter && !query ? "page" : undefined}
          className={`relative flex h-[42px] w-12 shrink-0 items-center justify-start text-[12px] transition-colors ${!activeLetter && !query ? "font-medium text-[var(--coffee-dark)] after:absolute after:bottom-0 after:left-0 after:h-px after:w-6 after:bg-[var(--brass)]" : "text-[var(--text-secondary)] hover:text-[var(--coffee)]"}`}
        >
          全部
        </Link>
        {letters.map((letter) => {
          const active = activeLetter === letter;
          return (
            <Link
              key={letter}
              href={buildHref(query, letter)}
              ref={active ? activeItemRef : undefined}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-[42px] w-[38px] shrink-0 items-center justify-center text-[12px] transition-colors ${active ? "font-medium text-[var(--coffee-dark)] after:absolute after:bottom-0 after:h-px after:w-4 after:bg-[var(--brass)]" : "text-[var(--text-secondary)] hover:text-[var(--coffee)]"}`}
            >
              {letter}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
