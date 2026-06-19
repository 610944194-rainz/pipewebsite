"use client";

import { useEffect } from "react";
import type { PublicCatalogProduct } from "@/lib/public-products/types";
import {
  parseProductReturnPosition,
  productAnchorId,
  productReturnScrollKey,
} from "@/lib/public-products/scroll";
import ProductCard from "./ProductCard";

type ProductGridProps = {
  products: PublicCatalogProduct[];
  returnTo?: string;
  variant?: "catalog" | "compact";
};

export default function ProductGrid({
  products,
  returnTo,
  variant = "catalog",
}: ProductGridProps) {
  useEffect(() => {
    if (!returnTo) return;

    try {
      const key = productReturnScrollKey(returnTo);
      const stored = window.sessionStorage.getItem(key);
      const position = parseProductReturnPosition(stored);
      const hashAnchor = window.location.hash.replace(/^#/, "");
      const storedAnchor = position?.productId
        ? productAnchorId(position.productId)
        : "";
      const anchorId = /^product-[a-z0-9][a-z0-9-]*$/i.test(hashAnchor)
        ? hashAnchor
        : storedAnchor;

      if (!position && !anchorId) return;
      window.sessionStorage.removeItem(key);

      let innerFrame = 0;
      const frame = window.requestAnimationFrame(() => {
        innerFrame = window.requestAnimationFrame(() => {
          const anchor = anchorId ? document.getElementById(anchorId) : null;

          if (anchor) {
            anchor.scrollIntoView({ behavior: "auto", block: "center" });
            return;
          }

          if (position) {
            window.scrollTo({ top: position.scrollY, behavior: "auto" });
          }
        });
      });

      return () => {
        window.cancelAnimationFrame(frame);
        if (innerFrame) window.cancelAnimationFrame(innerFrame);
      };
    } catch {
      return;
    }
  }, [returnTo]);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          returnTo={returnTo}
          variant={variant}
          eagerImage={index < 2}
        />
      ))}
    </div>
  );
}
