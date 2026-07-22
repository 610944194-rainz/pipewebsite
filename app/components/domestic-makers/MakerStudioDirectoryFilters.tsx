"use client";

import { FormEvent, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type DirectoryFiltersProps = {
  initialQuery: string;
  activeRegion: string;
  activeKind: string;
  regions: readonly string[];
  demo: boolean;
};

export default function MakerStudioDirectoryFilters({
  initialQuery,
  activeRegion,
  activeKind,
  regions,
  demo,
}: DirectoryFiltersProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(activeRegion || activeKind));
  const [region, setRegion] = useState(activeRegion);
  const [kind, setKind] = useState(activeKind);

  function buildParams(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(overrides).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });

    if (demo) params.set("demo", "1");
    else params.delete("demo");
    params.delete("page");
    return params;
  }

  function navigate(overrides: Record<string, string | undefined>) {
    const params = buildParams(overrides);
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ q: query.trim() || undefined });
  }

  function applyFilters() {
    navigate({ region: region || undefined, kind: kind || undefined });
  }

  function clearFilters() {
    setRegion("");
    setKind("");
    navigate({ region: undefined, kind: undefined });
  }

  return (
    <section aria-label="目录搜索与筛选" className="mt-4">
      <div className="flex gap-2">
        <form onSubmit={handleSearch} className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索斗师、工作室或城市"
            className="h-11 w-full rounded-[5px] border border-[rgba(91,62,43,0.12)] bg-white py-2 pl-10 pr-3 text-[13px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus-visible:border-[var(--brass)] focus-visible:ring-1 focus-visible:ring-[var(--brass)]"
          />
        </form>
        <button
          type="button"
          onClick={() => setFiltersOpen((current) => !current)}
          aria-expanded={filtersOpen}
          className="inline-flex h-11 w-[86px] shrink-0 items-center justify-center gap-1.5 rounded-[5px] border border-[rgba(91,62,43,0.12)] bg-white text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--brass)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brass)]"
        >
          筛选
          <ChevronIcon className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {filtersOpen ? (
        <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-[5px] border border-[rgba(91,62,43,0.12)] bg-white">
          <label className="min-w-0 border-r border-[rgba(91,62,43,0.08)] px-3 py-2.5">
            <span className="mb-1 block text-[10px] font-normal tracking-[0.08em] text-[var(--text-secondary)]">地区</span>
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="w-full appearance-none bg-transparent text-[12.5px] font-normal text-[var(--text-primary)] outline-none"
            >
              <option value="">全部地区</option>
              {regions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 px-3 py-2.5">
            <span className="mb-1 block text-[10px] font-normal tracking-[0.08em] text-[var(--text-secondary)]">类型</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="w-full appearance-none bg-transparent text-[12.5px] font-normal text-[var(--text-primary)] outline-none"
            >
              <option value="">全部类型</option>
              <option value="maker">斗师</option>
              <option value="studio">工作室</option>
            </select>
          </label>
          <div className="col-span-2 flex items-center justify-end gap-4 border-t border-[rgba(91,62,43,0.08)] px-3 py-2">
            {(activeRegion || activeKind) ? (
              <button type="button" onClick={clearFilters} className="text-[12px] font-normal text-[var(--text-secondary)] transition-colors hover:text-[var(--coffee)]">
                清除
              </button>
            ) : null}
            <button type="button" onClick={applyFilters} className="text-[12px] font-medium text-[var(--coffee)] transition-colors hover:text-[var(--brass)]">
              确认筛选
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" strokeWidth="1.6" />
      <path d="m16 16 4.1 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
