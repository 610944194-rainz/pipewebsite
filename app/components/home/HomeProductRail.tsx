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
  updatedAt?: string;
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
    <div className="home-rail -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:gap-5">
      {products.map((product, index) => (
        <Link
          key={product.id}
          id={productAnchorId(product.id)}
          href={productHref(product.id)}
          onNavigate={() => saveReturnPosition(product.id)}
          className={`group min-w-0 shrink-0 snap-start overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--brass)] motion-reduce:transition-none ${
            compact ? "basis-[39%] sm:basis-auto" : "basis-[44%] sm:basis-auto"
          }`}
        >
          <article className="flex h-full flex-col">
            <ProductCardImage
              imageUrl={product.image}
              alt={product.name}
              brandName={product.brand}
              loading={index < 3 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              className={compact ? "h-[104px] sm:h-[126px]" : "h-[132px] sm:h-[154px]"}
              imageClassName={compact ? "p-2" : "p-3"}
            />

            <div className={`flex flex-1 flex-col ${compact ? "p-2.5" : "p-3"}`}>
              {compact && product.status ? (
                <div className="mb-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-medium text-[var(--coffee)]">{product.status}</span>
                  {product.updatedAt ? <time className="text-[var(--text-secondary)]">{product.updatedAt}</time> : null}
                </div>
              ) : null}
              <p className="line-clamp-1 text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--brass)]">{product.brand}</p>
              <h3 className={`mt-1 line-clamp-2 font-medium leading-[1.4] text-[var(--text-primary)] ${compact ? "min-h-[36px] text-[12px]" : "min-h-[40px] text-[14px]"}`}>
                {product.name}
              </h3>
              <p className={`mt-auto pt-3 font-medium text-[var(--text-primary)] ${compact ? "text-[12px]" : "text-[13px]"}`}>
                {product.price}
              </p>
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}
