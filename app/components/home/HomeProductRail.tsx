"use client";

import Link from "next/link";
import ProductCardImage from "@/components/products/ProductCardImage";
import {
  productAnchorId,
  productReturnNavigationKey,
  productReturnScrollKey,
} from "@/lib/public-products/scroll";

export type HomeRailProduct = {
  id: string;
  image: string;
  brand: string;
  name: string;
  price: string;
  status?: string;
};

type HomeProductRailProps = {
  products: HomeRailProduct[];
  variant: "weekly" | "today";
};

function productHref(productId: string) {
  const returnTo = "/";
  const params = new URLSearchParams({
    returnTo,
    anchor: productAnchorId(productId),
  });
  return `/products/${encodeURIComponent(productId)}?${params.toString()}`;
}

function saveReturnPosition(productId: string) {
  try {
    const returnTo = "/";
    const anchor = productAnchorId(productId);
    window.sessionStorage.setItem(
      productReturnScrollKey(returnTo),
      JSON.stringify({ productId, scrollY: window.scrollY })
    );
    window.sessionStorage.setItem(
      productReturnNavigationKey(productId),
      JSON.stringify({ returnTo, anchor, savedAt: Date.now() })
    );
  } catch {
    // Return-position persistence is an enhancement; navigation still works.
  }
}

export default function HomeProductRail({ products, variant }: HomeProductRailProps) {
  const compact = variant === "today";

  return (
    <div
      className={`home-rail -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:gap-4 ${
        compact ? "flex-nowrap" : "sm:grid sm:grid-cols-4 sm:overflow-visible"
      }`}
    >
      {products.map((product, index) => (
        <Link
          key={product.id}
          id={productAnchorId(product.id)}
          href={productHref(product.id)}
          onNavigate={() => saveReturnPosition(product.id)}
          className={`group min-w-0 shrink-0 snap-start overflow-hidden rounded-[4px] border border-[#e9e1d7] bg-white transition-colors hover:border-[var(--brass)] motion-reduce:transition-none ${
            compact ? "w-[120px] sm:w-auto sm:basis-[22%] lg:basis-[19%]" : "w-[130px] sm:w-auto sm:basis-auto"
          }`}
        >
          <article className="flex h-full flex-col">
            <ProductCardImage
              imageUrl={product.image}
              alt={product.name}
              brandName={product.brand}
              loading={index < 3 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              className={compact ? "h-[110px] sm:h-[118px]" : "h-[125px] sm:h-[146px]"}
              imageClassName={compact ? "p-2" : "p-2.5"}
            />

            <div className="flex flex-1 flex-col p-2.5">
              <p className={`line-clamp-1 font-normal uppercase text-[var(--brass)] ${compact ? "text-[11px] tracking-[0.06em]" : "text-[9px] tracking-[0.1em]"}`}>{product.brand}</p>
              <h3 className={`mt-1 line-clamp-2 font-normal leading-[1.45] text-[var(--text-primary)] ${compact ? "min-h-[32px] text-[11.5px]" : "min-h-[35px] text-[12px]"}`}>
                {product.name}
              </h3>
              <p className={`mt-auto pt-2 font-medium leading-[1.4] text-[var(--text-primary)] ${compact ? "text-[11.5px]" : "text-[12px]"}`}>
                {product.price}
              </p>
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}
