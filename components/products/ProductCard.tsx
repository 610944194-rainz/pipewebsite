"use client";

import Link from "next/link";
import type { PublicCatalogProduct } from "@/lib/public-products/types";
import {
  conditionDisplayLabel,
  countryLabel,
  displayProductEnglishName,
  displayProductName,
  formatSitePrice,
  inventoryLabel,
  sourceLabel,
  shapeDisplayLabel,
} from "@/lib/public-products/presentation";
import {
  productAnchorId,
  productReturnNavigationKey,
  productReturnScrollKey,
} from "@/lib/public-products/scroll";
import ProductCardImage from "./ProductCardImage";

type ProductCardProps = {
  product: PublicCatalogProduct;
  returnTo?: string;
  variant?: "catalog" | "compact" | "inventory" | "dossier";
  imagePriority?: boolean;
  imageLoading?: "eager" | "lazy";
  imageFetchPriority?: "high" | "auto" | "low";
};

type IconProps = {
  className?: string;
};

function InventoryProductImageOverlays({ product }: { product: PublicCatalogProduct }) {
  return (
    <>
      {product.inventoryStatus === "sold" ? (
        <span className="absolute left-2 top-2 text-[9px] font-normal leading-none text-[#81746A]">
          {inventoryLabel(product.inventoryStatus)}
        </span>
      ) : null}
      {product.galleryCount >= 3 ? (
        <span className="absolute bottom-2 right-2 rounded-[3px] border border-[rgba(225,215,203,0.8)] bg-white/86 px-1.5 py-0.5 text-[9px] font-normal leading-[1.3] text-[#74665c]">
          {product.galleryCount} 图
        </span>
      ) : null}
    </>
  );
}

function InventoryProductCard({
  product,
  returnTo,
  imagePriority,
  imageLoading,
  imageFetchPriority,
}: Omit<ProductCardProps, "variant">) {
  const name = displayProductName(product);
  const subtitle = displayProductEnglishName(product);
  const tags = metaTags(product);

  return (
    <article
      id={productAnchorId(product.id)}
      className="scroll-mt-4"
    >
      <Link
        href={productHref(product, returnTo)}
        onNavigate={() => saveReturnPosition(product.id, returnTo)}
        aria-label={`查看 ${name} 详情`}
        className="group block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]"
      >
        <div>
          <ProductCardImage
            imageUrl={product.mainImage}
            alt={name}
            brandName={product.brandName}
            loading={imageLoading || (imagePriority ? "eager" : "lazy")}
            fetchPriority={imageFetchPriority || (imagePriority ? "high" : "auto")}
            className="h-[148px] rounded-[4px] border border-[#eee7df] bg-white sm:h-[158px]"
            imageClassName="p-3 sm:p-4"
          >
            <InventoryProductImageOverlays product={product} />
          </ProductCardImage>

          <div className="px-0.5 pt-2.5">
            <p className="line-clamp-1 text-[9.5px] font-normal uppercase leading-[1.3] tracking-[0.11em] text-[var(--brass)]">
              {product.brandName || sourceLabel(product.source)}
            </p>
            <h3 className="mt-[5px] line-clamp-2 text-[11.5px] font-normal leading-[1.45] text-[var(--text-primary)] sm:text-[12.5px]">
              {name}
            </h3>
            {subtitle ? (
              <p className="mt-1 hidden line-clamp-1 text-[10px] font-normal leading-[1.4] text-[var(--text-secondary)] sm:block sm:text-[10.5px]">
                {subtitle}
              </p>
            ) : null}
            <p className="mt-2 text-[12px] font-medium leading-[1.4] text-[var(--text-primary)] sm:text-[12.5px]">
              {formatSitePrice(product)}
            </p>
            {tags.length > 0 ? (
              <p className="mt-2 line-clamp-1 text-[9.5px] font-normal leading-[1.4] text-[#81746A] sm:text-[10px]">
                {tags.join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}

function DossierProductCard({
  product,
  returnTo,
  imagePriority,
  imageLoading,
  imageFetchPriority,
}: Omit<ProductCardProps, "variant">) {
  const name = displayProductName(product);
  const tags = metaTags(product);

  return (
    <article id={productAnchorId(product.id)} className="h-full scroll-mt-4">
      <Link
        href={productHref(product, returnTo)}
        onNavigate={() => saveReturnPosition(product.id, returnTo)}
        aria-label={`查看 ${name} 详情`}
        className="group flex h-full flex-col overflow-hidden rounded-[5px] border border-[rgba(210,169,105,0.2)] bg-[#3a2518] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d7a758]"
      >
        <ProductCardImage
          imageUrl={product.mainImage}
          alt={name}
          brandName={product.brandName}
          loading={imageLoading || (imagePriority ? "eager" : "lazy")}
          fetchPriority={imageFetchPriority || (imagePriority ? "high" : "auto")}
          className="h-[148px] bg-white sm:h-[158px]"
          imageClassName="p-3 sm:p-4"
        >
          <InventoryProductImageOverlays product={product} />
        </ProductCardImage>

        <div className="flex h-[142px] flex-col px-2.5 pb-3 pt-2.5 sm:h-[146px]">
          <p className="line-clamp-1 text-[9.5px] font-normal uppercase leading-[1.3] tracking-[0.11em] text-[#d7a758]">
            {product.brandName || sourceLabel(product.source)}
          </p>
          <h3 className="mt-[5px] h-[2.9em] line-clamp-2 text-[13px] font-normal leading-[1.43] text-[#f4eee7]">
            {name}
          </h3>
          <p className="mt-2 shrink-0 text-[12.5px] font-medium leading-[1.4] text-[#f4eee7]">
            {formatSitePrice(product)}
          </p>
          <p className="mt-2 h-[1.45em] shrink-0 line-clamp-1 text-[10.5px] font-normal leading-[1.45] text-[rgba(244,238,231,0.62)]">
            {tags.join(" · ")}
          </p>
        </div>
      </Link>
    </article>
  );
}

function productHref(product: PublicCatalogProduct, returnTo?: string) {
  const params = new URLSearchParams();
  if (returnTo) {
    params.set("returnTo", returnTo);
    params.set("anchor", productAnchorId(product.id));
  }
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

function inventoryClass(status: PublicCatalogProduct["inventoryStatus"]) {
  return status === "sold"
    ? "bg-[#C47712] text-white"
    : "bg-[#063B32] text-white";
}

function saveReturnPosition(
  productId: string,
  returnTo?: string
) {
  if (!returnTo || typeof window === "undefined") return;

  try {
    const anchor = productAnchorId(productId);
    window.sessionStorage.setItem(
      productReturnScrollKey(returnTo),
      JSON.stringify({
        productId,
        scrollY: window.scrollY,
      })
    );
    window.sessionStorage.setItem(
      productReturnNavigationKey(productId),
      JSON.stringify({
        returnTo,
        anchor,
        savedAt: Date.now(),
      })
    );
  } catch {
    // Storage is an enhancement only; navigation must still work.
  }
}

function ProductImageOverlays({
  product,
  compact,
}: {
  product: PublicCatalogProduct;
  compact: boolean;
}) {
  return (
    <>
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
    </>
  );
}

export default function ProductCard({
  product,
  returnTo,
  variant = "catalog",
  imagePriority = false,
  imageLoading,
  imageFetchPriority,
}: ProductCardProps) {
  const name = displayProductName(product);
  const subtitle = displayProductEnglishName(product);
  const tags = metaTags(product);
  const compact = variant === "compact";

  if (variant === "inventory") {
    return (
      <InventoryProductCard
        product={product}
        returnTo={returnTo}
        imagePriority={imagePriority}
        imageLoading={imageLoading}
        imageFetchPriority={imageFetchPriority}
      />
    );
  }

  if (variant === "dossier") {
    return (
      <DossierProductCard
        product={product}
        returnTo={returnTo}
        imagePriority={imagePriority}
        imageLoading={imageLoading}
        imageFetchPriority={imageFetchPriority}
      />
    );
  }

  return (
    <Link
      id={productAnchorId(product.id)}
      href={productHref(product, returnTo)}
      onNavigate={() => saveReturnPosition(product.id, returnTo)}
      className="group block h-full scroll-mt-4 overflow-hidden rounded-[18px] border border-[#E7DDD0] bg-white shadow-[0_6px_18px_rgba(31,26,22,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(31,26,22,0.1)]"
    >
      <article className="flex h-full flex-col">
        <ProductCardImage
          imageUrl={product.mainImage}
          alt={name}
          brandName={product.brandName}
          loading={imageLoading || (imagePriority ? "eager" : "lazy")}
          fetchPriority={
            imageFetchPriority || (imagePriority ? "high" : "auto")
          }
          className={
            compact ? "h-[116px] sm:h-[138px]" : "h-[122px] sm:h-[150px]"
          }
        >
          <ProductImageOverlays product={product} compact={compact} />
        </ProductCardImage>

        <div className="flex flex-1 flex-col p-2.5">
          <p className="line-clamp-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#9A6530]">
            {product.brandName || sourceLabel(product.source)}
          </p>

          <h3 className="mt-1 line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-[1.35] text-[#1F1A16]">
            {name}
          </h3>

          {!compact ? (
            subtitle ? (
              <p className="mt-1 line-clamp-2 min-h-[34px] text-[11px] leading-[17px] text-[#8A8176]">
                {subtitle}
              </p>
            ) : (
              <span className="mt-1 block min-h-[34px]" aria-hidden="true" />
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
