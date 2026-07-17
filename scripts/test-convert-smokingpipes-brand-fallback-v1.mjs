import assert from "node:assert/strict";

import { convertSmokingpipesCandidateDetails } from "./convert-smokingpipes-products-v2.mjs";

function detail({ id, brand = "", sourceUrl }) {
  return {
    sourceProductId: id,
    sourceUrl,
    productCode: `test-${id}`,
    conditionType: "new",
    brand,
    title: `Fallback fixture ${id}`,
    fullTitle: `Fallback fixture ${id} Tobacco Pipe`,
    price: "$100.00",
    status: "available",
    mainImageUrl: `https://images.example.test/${id}.jpg`,
    galleryImages: [`https://images.example.test/${id}.jpg`],
    galleryCount: 1,
    specsText: ["Shape: Billiard"],
    shape: "Billiard",
    finish: "Smooth",
    material: "Briar",
  };
}

function listItem({ id, brand = "", sourceUrl }) {
  return { sourceProductId: id, brand, sourceUrl, status: "available" };
}

function convert({ id, detailBrand, listBrand, urlCategory }) {
  const sourceUrl = `https://www.smokingpipes.com/pipes/new/${urlCategory}/moreinfo.cfm?product_id=${id}`;
  const result = convertSmokingpipesCandidateDetails(
    [detail({ id, brand: detailBrand, sourceUrl })],
    [listItem({ id, brand: listBrand, sourceUrl })]
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.products.length, 1);
  return result.products[0];
}

// 1. Detail remains authoritative even when List and URL disagree.
assert.equal(
  convert({ id: "900001", detailBrand: "Savinelli", listBrand: "Peterson", urlCategory: "peterson" }).brand,
  "Savinelli"
);

// 2. A populated List brand repairs a blank Detail brand.
assert.equal(
  convert({ id: "900002", detailBrand: "", listBrand: "Peterson", urlCategory: "savinelli" }).brand,
  "Peterson"
);

// 3. A known Smokingpipes URL category maps through the existing brand taxonomy.
assert.equal(
  convert({ id: "900003", detailBrand: "", listBrand: "", urlCategory: "savinelli" }).brand,
  "Savinelli"
);

// 4. No Detail/List/known URL brand leaves the existing Unknown representation intact.
const unknown = convert({ id: "900004", detailBrand: "", listBrand: "", urlCategory: "not-a-brand" });
assert.equal(unknown.brand, "");
assert.equal(unknown.canonicalBrand, "");
assert.equal(unknown.brandReviewStatus, "needs-review");
assert.equal(unknown.brandIndexEligible, false);

console.log("Smokingpipes brand fallback regression tests passed");
