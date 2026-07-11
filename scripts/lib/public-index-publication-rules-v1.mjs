function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isSoldReference(product) {
  return (
    text(product?.inventoryStatus) === "sold" &&
    product?.publiclySellable === false
  );
}

export function catalogStagingReferenceErrors({ product, stagingRow }) {
  if (product?.publiclySellable !== true) return [];
  if (!stagingRow) {
    return [`Catalog product not found in staging: ${product.id}`];
  }
  if (stagingRow.entityType !== "offer") {
    return [`Catalog product is not offer in staging: ${product.id}`];
  }
  if (stagingRow.inventory?.listingEligible !== true) {
    return [`Catalog product is not listing eligible in staging: ${product.id}`];
  }
  return [];
}

export function hiddenCatalogViolation({ stagingRow, catalogProduct }) {
  if (!catalogProduct || !stagingRow) return false;
  return !(
    isSoldReference(catalogProduct) &&
    stagingRow.entityType === "offer" &&
    stagingRow.hidden !== true
  );
}

export function shouldExcludeHiddenStagingRow({ row, soldReferenceIds }) {
  const id = String(row?.id ?? "").trim();
  return !(
    soldReferenceIds?.has(id) &&
    row?.entityType === "offer" &&
    row?.hidden !== true
  );
}
