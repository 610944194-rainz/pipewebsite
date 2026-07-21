import Link from "next/link";

export type PaginationItem = number | "ellipsis";

export function getPaginationItems(
  currentPage: number,
  totalPages: number
): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ];
}

type ProductPaginationProps = {
  currentPage: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
  label: string;
  variant?: "default" | "dossier";
};

export default function ProductPagination({
  currentPage,
  totalPages,
  hrefForPage,
  label,
  variant = "default",
}: ProductPaginationProps) {
  if (totalPages <= 1) return null;

  if (variant === "dossier") {
    return (
      <nav className="mt-4 grid grid-cols-3 items-center border-y border-[rgba(213,166,81,0.1)] py-3 text-[13px] font-normal" aria-label={label}>
        {currentPage === 1 ? (
          <span className="text-[rgba(244,238,231,0.35)]">← 上一页</span>
        ) : (
          <Link href={hrefForPage(currentPage - 1)} className="text-[#e4c18d] transition-colors hover:text-[#f4eee7]">← 上一页</Link>
        )}
        <span className="text-center text-[#f4eee7]">第 {currentPage} / {totalPages} 页</span>
        {currentPage === totalPages ? (
          <span className="text-right text-[rgba(244,238,231,0.35)]">下一页 →</span>
        ) : (
          <Link href={hrefForPage(currentPage + 1)} className="text-right text-[#e4c18d] transition-colors hover:text-[#f4eee7]">下一页 →</Link>
        )}
      </nav>
    );
  }

  const items = getPaginationItems(currentPage, totalPages);

  return (
    <nav
      className="mt-7 rounded-3xl border border-[#E7DDD0] bg-[#FFFDF8] p-4 shadow-[0_10px_28px_rgba(31,26,22,0.045)]"
      aria-label={label}
    >
      <p className="mb-3 text-center text-[12px] text-[#746A5F]">
        第{" "}
        <span className="font-semibold text-[#A97838]">{currentPage}</span> /{" "}
        {totalPages} 页
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {currentPage === 1 ? (
          <span className="h-9 rounded-full border border-[#E7DDD0] bg-[#F7F3EA] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
            上一页
          </span>
        ) : (
          <Link
            href={hrefForPage(currentPage - 1)}
            className="h-9 rounded-full border border-[#D8CFC2] bg-white px-3 py-2 text-[12px] font-semibold text-[#1F1A16] transition hover:border-[#063B32] hover:text-[#063B32]"
          >
            上一页
          </Link>
        )}

        {items.map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="flex h-9 w-7 items-center justify-center text-[12px] font-semibold text-[#746A5F]"
            >
              ...
            </span>
          ) : (
            <Link
              key={item}
              href={hrefForPage(item)}
              className={[
                "h-9 min-w-9 rounded-full border px-3 py-2 text-center text-[12px] font-semibold transition",
                item === currentPage
                  ? "border-[#063B32] bg-[#063B32] text-[#E7C48A]"
                  : "border-[#D8CFC2] bg-white text-[#1F1A16] hover:border-[#063B32] hover:text-[#063B32]",
              ].join(" ")}
            >
              {item}
            </Link>
          )
        )}

        {currentPage === totalPages ? (
          <span className="h-9 rounded-full border border-[#E7DDD0] bg-[#F7F3EA] px-3 py-2 text-[12px] font-semibold text-[#B8AA9D]">
            下一页
          </span>
        ) : (
          <Link
            href={hrefForPage(currentPage + 1)}
            className="h-9 rounded-full border border-[#D8CFC2] bg-white px-3 py-2 text-[12px] font-semibold text-[#1F1A16] transition hover:border-[#063B32] hover:text-[#063B32]"
          >
            下一页
          </Link>
        )}
      </div>
    </nav>
  );
}
