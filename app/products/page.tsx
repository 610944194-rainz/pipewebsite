import ProductsPageClient from "@/components/products/ProductsPageClient";
import {
  buildProductsHref,
  getProductUiFilterOptions,
  queryPublicProducts,
} from "@/lib/public-products/query";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const result = queryPublicProducts(resolvedSearchParams);
  const filters = getProductUiFilterOptions();
  const returnTo = buildProductsHref(result.state, {
    page: result.currentPage,
  });

  return (
    <ProductsPageClient
      key={returnTo}
      result={result}
      filters={filters}
      returnTo={returnTo}
    />
  );
}
