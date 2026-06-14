"use client";

import { useEffect } from "react";
import type { PublicCatalogProduct } from "@/lib/public-products/types";
import { productReturnScrollKey } from "@/lib/public-products/scroll";
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
      if (!stored) return;

      const scrollY = Number.parseFloat(stored);
      window.sessionStorage.removeItem(key);

      if (!Number.isFinite(scrollY)) return;

      const frame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, behavior: "auto" });
      });

      return () => window.cancelAnimationFrame(frame);
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
