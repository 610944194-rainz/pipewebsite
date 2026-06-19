"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export type BrandSeriesFilterOption = {
  series: string;
  seriesZh: string | null;
  count: number;
};

type BrandSeriesFilterDrawerProps = {
  brandSlug: string;
  options: BrandSeriesFilterOption[];
  selectedSeries: string;
};

function buildSeriesHref(brandSlug: string, series: string) {
  const params = new URLSearchParams();
  if (series) params.set("series", series);
  const query = params.toString();
  return `/brands/${brandSlug}${query ? `?${query}` : ""}#brand-stock`;
}

export default function BrandSeriesFilterDrawer({
  brandSlug,
  options,
  selectedSeries,
}: BrandSeriesFilterDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftSeries, setDraftSeries] = useState(selectedSeries);
  const [searchText, setSearchText] = useState("");

  const filteredOptions = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return options;

    return options.filter((option) =>
      [option.series, option.seriesZh]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [options, searchText]);

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function openDrawer() {
    setDraftSeries(selectedSeries);
    setSearchText("");
    setOpen(true);
  }

  function closeDrawer() {
    setOpen(false);
  }

  function navigate(series: string) {
    router.push(buildSeriesHref(brandSlug, series));
    closeDrawer();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 min-w-32 items-center justify-center gap-2 rounded-full border border-[#CFAE7B] bg-[#FFFDF8] px-4 text-[13px] font-semibold text-[#1F1A16] shadow-[0_4px_12px_rgba(31,26,22,0.04)] transition hover:border-[#A97838] hover:text-[#8A5D26]"
      >
        <span className="max-w-[220px] truncate">
          {selectedSeries ? `系列：${selectedSeries}` : "系列"}
        </span>
        <span aria-hidden="true" className="text-[12px] text-[#A97838]">
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F1A16]/28 px-3 pb-3 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="选择系列"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="关闭系列筛选"
            onClick={closeDrawer}
          />

          <div className="relative z-10 flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-[#E7DDD0] bg-[#FFFDF8] shadow-[0_22px_60px_rgba(31,26,22,0.18)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#EFE3D4] px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-[#A97838]">
                  Filter
                </p>
                <h2 className="mt-1 text-[18px] font-bold text-[#1F1A16]">
                  选择系列
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E7DDD0] bg-white text-[18px] font-semibold text-[#746A5F]"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="border-b border-[#EFE3D4] px-5 py-3">
              <label className="flex h-11 items-center gap-2 rounded-full border border-[#E7DDD0] bg-white px-4">
                <SearchIcon className="h-4 w-4 shrink-0 text-[#8A8176]" />
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索系列"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1F1A16] outline-none placeholder:text-[#8A8176]"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {filteredOptions.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {filteredOptions.map((option) => {
                    const selected = draftSeries === option.series;

                    return (
                      <button
                        key={option.series}
                        type="button"
                        onClick={() => setDraftSeries(option.series)}
                        className={[
                          "min-w-0 rounded-2xl border px-3 py-3 text-left transition",
                          selected
                            ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                            : "border-[#E7DDD0] bg-white text-[#1F1A16] hover:border-[#A97838] hover:text-[#8A5D26]",
                        ].join(" ")}
                      >
                        <span className="flex min-w-0 items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block line-clamp-2 text-[13px] font-semibold leading-5">
                              {option.seriesZh || option.series}
                            </span>
                            {option.seriesZh ? (
                              <span
                                className={[
                                  "mt-0.5 block line-clamp-1 text-[10px]",
                                  selected
                                    ? "text-[#E7C48A]/75"
                                    : "text-[#8A8176]",
                                ].join(" ")}
                              >
                                {option.series}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={[
                              "shrink-0 text-[10px] font-semibold",
                              selected
                                ? "text-[#E7C48A]/80"
                                : "text-[#A97838]",
                            ].join(" ")}
                          >
                            {option.count}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-[#746A5F]">
                  没有匹配的系列
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-[#EFE3D4] px-5 py-4">
              <button
                type="button"
                onClick={() => navigate("")}
                className="flex h-11 items-center justify-center rounded-full border border-[#CFAE7B] bg-white text-[13px] font-semibold text-[#8A5D26] transition hover:border-[#A97838]"
              >
                清除
              </button>
              <button
                type="button"
                onClick={() => navigate(draftSeries)}
                className="flex h-11 items-center justify-center rounded-full bg-[#063B32] text-[13px] font-semibold text-[#E7C48A] transition hover:bg-[#0A4A3E]"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m16.2 16.2 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
