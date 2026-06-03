import Link from "next/link";
import type { PipeProduct } from "../data/pipes";

type ProductCardProps = {
  pipe: PipeProduct;
};

export default function ProductCard({ pipe }: ProductCardProps) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-[#3a2a1f] bg-[#201710]">
      <div className="h-52 overflow-hidden bg-[#f6f1e8] p-3">
        {pipe.imageUrl ? (
          <img
            src={pipe.imageUrl}
            alt={`${pipe.brand} ${pipe.name}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl bg-gradient-to-br from-[#2f2117] to-[#0f0a07]">
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-28 rounded-full border border-[#8c684a] bg-[#1b120c]" />
              <p className="text-xs tracking-[0.25em] text-[#9f7651]">
                PIPE IMAGE
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[#c58a4a]">{pipe.brand}</p>
            <h3 className="mt-1 text-lg font-semibold leading-snug">
              {pipe.name}
            </h3>
          </div>

          <span className="shrink-0 rounded-full bg-[#2b2119] px-3 py-1 text-xs text-[#d2a06f]">
            {pipe.condition}
          </span>
        </div>

        <p className="min-h-20 text-sm leading-6 text-[#c8b8a8]">
          {pipe.comment}
        </p>

        <div className="mt-4 space-y-2 border-t border-[#3a2a1f] pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-[#9f8d7c]">海外原价</span>
            <span className="font-medium text-[#f0c08a]">
              {pipe.originalPrice}
            </span>
          </div>

          <div className="flex justify-between gap-4">
            <span className="text-[#9f8d7c]">人民币参考</span>
            <span className="font-medium">{pipe.estimatedCny}</span>
          </div>

          <div className="flex justify-between gap-4">
            <span className="text-[#9f8d7c]">来源</span>
            <span className="text-right">{pipe.source}</span>
          </div>

          <div className="flex justify-between gap-4">
            <span className="text-[#9f8d7c]">库存</span>
            <span>{pipe.status}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pipe.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[#17100b] px-3 py-1 text-xs text-[#b8a899]"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-auto pt-5">
          <Link
            href={`/products/${pipe.id}`}
            className="block w-full rounded-full bg-[#c58a4a] px-5 py-3 text-center text-sm font-medium text-[#15100c] hover:bg-[#d99a56]"
          >
            查看详情 / 咨询
          </Link>
        </div>
      </div>
    </article>
  );
}