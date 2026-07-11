import assert from "node:assert/strict";

import {
  catalogStagingReferenceErrors,
  isSoldReference,
  hiddenCatalogViolation,
  shouldExcludeHiddenStagingRow,
} from "./lib/public-index-publication-rules-v1.mjs";

const soldReference = {
  id: "smokingpipes-sold-reference",
  inventoryStatus: "sold",
  publiclySellable: false,
};

assert.equal(isSoldReference(soldReference), true);
assert.deepEqual(
  catalogStagingReferenceErrors({ product: soldReference, stagingRow: null }),
  [],
  "a sold reference may be catalogued without a staging offer"
);
assert.equal(
  hiddenCatalogViolation({
    stagingRow: { id: soldReference.id, entityType: "offer", hidden: false },
    catalogProduct: soldReference,
  }),
  false,
  "generic hidden-index validation must not reject a sold reference"
);
assert.equal(
  shouldExcludeHiddenStagingRow({
    row: { id: soldReference.id, entityType: "offer", hidden: false, inventory: { listingEligible: false } },
    soldReferenceIds: new Set([soldReference.id]),
  }),
  false,
  "a sold reference must not count as an excluded hidden staging row"
);

const availableProduct = {
  id: "smokingpipes-available",
  inventoryStatus: "available",
  publiclySellable: true,
};
assert.equal(isSoldReference(availableProduct), false);
assert.deepEqual(
  catalogStagingReferenceErrors({ product: availableProduct, stagingRow: null }),
  ["Catalog product not found in staging: smokingpipes-available"],
  "a publicly sellable product must have a staging offer"
);
assert.deepEqual(
  catalogStagingReferenceErrors({
    product: availableProduct,
    stagingRow: { id: availableProduct.id, entityType: "offer", inventory: { listingEligible: false } },
  }),
  ["Catalog product is not listing eligible in staging: smokingpipes-available"],
  "a publicly sellable product must remain listing eligible"
);
assert.equal(
  hiddenCatalogViolation({
    stagingRow: { id: availableProduct.id, entityType: "offer", hidden: true },
    catalogProduct: availableProduct,
  }),
  true,
  "explicit hidden=true remains blocking"
);
assert.equal(
  hiddenCatalogViolation({
    stagingRow: { id: availableProduct.id, entityType: "metadata", hidden: false },
    catalogProduct: availableProduct,
  }),
  true,
  "non-offer records remain blocking"
);

console.log("public product validator sold-reference tests: PASS");
