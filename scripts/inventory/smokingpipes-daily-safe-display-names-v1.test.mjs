import assert from "node:assert/strict";
import test from "node:test";

import { buildSmokingpipesDailySafeDisplayNameEntries } from "../generate-product-displayname-zh-safe-candidates.mjs";
import { validatePublicProductsNextCandidate } from "./smokingpipes-apply-dry-run-v1.mjs";

const product = {
  id: "smokingpipes-new-1",
  source: "smokingpipes",
  canonicalBrand: "Peterson",
  canonicalBrandZh: "彼得森",
  displayNameEn: "Classic Billiard Tobacco Pipe",
  canonicalShapeZh: "撞球斗",
  canonicalFinishZh: "光面",
};

test("Daily Smokingpipes new products receive a safe Chinese display name", () => {
  const result = buildSmokingpipesDailySafeDisplayNameEntries({
    products: [product],
    existingItems: [],
    brandFinal: {},
    shapeFinal: {},
  });

  assert.equal(result.review.length, 0);
  assert.equal(result.created.length, 1);
  assert.match(result.created[0].safeDisplayNameZh, /彼得森/);
  assert.match(result.created[0].safeDisplayNameZh, /撞球斗/);
});

test("existing reviewed safe names are never overwritten", () => {
  const existing = {
    id: product.id,
    source: "smokingpipes",
    safeDisplayNameZh: "既有正确中文名",
    displayTitle: "既有正确中文名",
  };
  const result = buildSmokingpipesDailySafeDisplayNameEntries({
    products: [product],
    existingItems: [existing],
    brandFinal: {},
    shapeFinal: {},
  });

  assert.deepEqual(result.created, []);
  assert.deepEqual(result.review, []);
  assert.equal(existing.safeDisplayNameZh, "既有正确中文名");
});

test("unsafe Daily titles are routed to review instead of public-ready new", () => {
  const result = buildSmokingpipesDailySafeDisplayNameEntries({
    products: [
      {
        id: "smokingpipes-unsafe-1",
        source: "smokingpipes",
        displayNameEn: "Unknown Pipe",
      },
    ],
    existingItems: [],
    brandFinal: {},
    shapeFinal: {},
  });

  assert.deepEqual(result.created, []);
  assert.deepEqual(result.review, [
    { id: "smokingpipes-unsafe-1", reason: "safeChineseDisplayNameMissing" },
  ]);
});

test("validator rejects missing Daily safe names and duplicate canonical ids", () => {
  const publicProduct = {
    id: product.id,
    source: "smokingpipes",
    sourceProductId: "new-1",
    inventoryStatus: "available",
    brandName: "Peterson",
    brandSlug: "peterson",
  };
  const result = validatePublicProductsNextCandidate({
    catalog: { products: [publicProduct] },
    filters: { options: {} },
    brands: { brands: [] },
    recentNew: { products: [publicProduct, publicProduct] },
    safeDisplayNameItems: [],
  });

  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /duplicate canonical ids/);
  assert.match(result.errors.join("\n"), /safe Chinese display names/);
});

test("Danish records are not altered by the Smokingpipes Daily name builder", () => {
  const danish = {
    id: "danish-1",
    source: "danish",
    nameZh: "测试中文名",
  };
  const result = buildSmokingpipesDailySafeDisplayNameEntries({
    products: [danish],
    existingItems: [],
    brandFinal: {},
    shapeFinal: {},
  });

  assert.deepEqual(result, { created: [], review: [] });
  assert.equal(danish.nameZh, "测试中文名");
});
