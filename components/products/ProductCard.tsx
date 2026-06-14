"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PublicCatalogProduct } from "@/lib/public-products/types";
import {
  conditionDisplayLabel,
  countryLabel,
  displayProductEnglishName,
  displayProductName,
  formatSitePrice,
  inventoryLabel,
  sourceImageCandidates,
  sourceLabel,
  shapeDisplayLabel,
} from "@/lib/public-products/presentation";
import { productReturnScrollKey } from "@/lib/public-products/scroll";

type ProductCardProps = {
  product: PublicCatalogProduct;
  returnTo?: string;
  variant?: "catalog" | "compact";
  eagerImage?: boolean;
};

type IconProps = {
  className?: string;
};

function inventoryClass(status: PublicCatalogProduct["inventoryStatus"]) {
  return status === "sold"
    ? "bg-[#C47712] text-white"
    : "bg-[#063B32] text-white";
}

function productHref(product: PublicCatalogProduct, returnTo?: string) {
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  const query = params.toString();
  return query ? `/products/${product.id}?${query}` : `/products/${product.id}`;
}

function metaTags(product: PublicCatalogProduct) {
  return [
    countryLabel(product.brandCountry),
    conditionDisplayLabel(product.conditionType, product.conditionLabel),
    shapeDisplayLabel(product.shape, product.shapeZh),
    product.finishZh || product.finish,
    product.stemMaterialZh || product.stemMaterial,
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value && value.toLowerCase() !== "unknown")
    .slice(0, 3);
}

function saveReturnPosition(returnTo?: string) {
  if (!returnTo || typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      productReturnScrollKey(returnTo),
      String(window.scrollY)
    );
  } catch {
    // Storage is an enhancement only; navigation must still work.
  }
}

function ProductImage({
  product,
  name,
  compact,
  eagerImage,
}: {
  product: PublicCatalogProduct;
  name: string;
  compact: boolean;
  eagerImage: boolean;
}) {
  const candidates = useMemo(
    () => sourceImageCandidates(product.mainImage),
    [product.mainImage]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [failed, setFailed] = useState(candidates.length === 0);

  const currentImage = candidates[candidateIndex] || "";

  function handleImageError() {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((index) => index + 1);
      return;
    }

    setFailed(true);
  }

  return (
    <div
      className={[
        "relative bg-white",
        compact ? "h-[116px] sm:h-[138px]" : "h-[122px] sm:h-[150px]",
      ].join(" ")}
    >
      {!failed && currentImage ? (
        <img
          src={currentImage}
          alt={name}
          className="h-full w-full object-contain p-2.5"
          draggable={false}
          loading={eagerImage ? "eager" : "lazy"}
          fetchPriority={eagerImage ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-white px-3 text-center">
          <span className="text-[11px] font-semibold tracking-[0.2em] text-[#A97838]">
            PIPE
          </span>
          <span className="mt-1 text-[10px] text-[#9A8F84]">
            图片加载失败
          </span>
        </div>
      )}

      <span
        className={[
          "absolute left-2 top-2 rounded-md px-1.5 py-1 text-[10px] font-medium leading-none shadow-sm",
          inventoryClass(product.inventoryStatus),
        ].join(" ")}
      >
        {inventoryLabel(product.inventoryStatus)}
      </span>

      {!compact ? (
        <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/94 text-[#063B32] shadow-[0_4px_12px_rgba(31,26,22,0.1)]">
          <BookmarkIcon className="h-4 w-4" />
        </span>
      ) : null}

      {product.galleryCount > 1 ? (
        <span className="absolute bottom-2 right-2 rounded-full bg-white/94 px-2 py-0.5 text-[10px] font-medium text-[#746A5F] shadow-sm">
          {product.galleryCount} 图
        </span>
      ) : null}
    </div>
  );
}

export default function ProductCard({
  product,
  returnTo,
  variant = "catalog",
  eagerImage = false,
}: ProductCardProps) {
  const name = displayProductName(product);
  const subtitle = displayProductEnglishName(product);
  const tags = metaTags(product);
  const compact = variant === "compact";

  return (
    <Link
      href={productHref(product, returnTo)}
      onClick={() => saveReturnPosition(returnTo)}
      className="group block h-full overflow-hidden rounded-[18px] border border-[#E7DDD0] bg-white shadow-[0_6px_18px_rgba(31,26,22,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(31,26,22,0.1)]"
    >
      <article className="flex h-full flex-col">
        <ProductImage
          product={product}
          name={name}
          compact={compact}
          eagerImage={eagerImage}
        />

        <div className="flex flex-1 flex-col p-2.5">
          <p className="line-clamp-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#9A6530]">
            {product.brandName || sourceLabel(product.source)}
          </p>

          <h3 className="mt-1 line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-[1.35] text-[#1F1A16]">
            {name}
          </h3>

          {!compact ? (
            subtitle ? (
              <p className="mt-1 line-clamp-1 min-h-5 text-[11px] leading-5 text-[#8A8176]">
                {subtitle}
              </p>
            ) : (
              <span className="mt-1 block min-h-5" aria-hidden="true" />
            )
          ) : null}

          <div className="mt-2 border-t border-[#F0E6D8] pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#746A5F]">参考价格</span>
              <span className="text-[11px] font-semibold text-[#1F1A16]">
                {formatSitePrice(product)}
              </span>
            </div>

            {compact ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#746A5F]">库存状态</span>
                <span className="text-[11px] font-semibold text-[#063B32]">
                  {inventoryLabel(product.inventoryStatus)}
                </span>
              </div>
            ) : null}
          </div>

          {!compact ? (
            tags.length > 0 ? (
              <div className="mt-2 flex min-h-[42px] flex-wrap content-start gap-1 overflow-hidden">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#F7F3EA] px-1.5 py-0.5 text-[10px] text-[#746A5F]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <span className="mt-2 block min-h-[42px]" aria-hidden="true" />
            )
          ) : null}

          <span
            className={[
              "mt-auto flex h-8 items-center justify-center rounded-full bg-[#063B32] text-[12px] font-semibold tracking-[0.04em] text-[#E7C48A] transition group-hover:bg-[#0A4A3E]",
              compact ? "mt-3" : "",
            ].join(" ")}
          >
            查看详情
          </span>
        </div>
      </article>
    </Link>
  );
}

function BookmarkIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4.8A1.8 1.8 0 0 1 8.8 3h6.4A1.8 1.8 0 0 1 17 4.8V21l-5-3.2L7 21V4.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
