import assert from "node:assert/strict";
import {
  BRAND_FIELDS,
  buildSmokingpipesBrandBackfill,
  countUnexpectedNonBrandChanges,
} from "./backfill-smokingpipes-brands-v1.mjs";

function product(sourceProductId, sourceUrl, overrides = {}) {
  return {
    id: `smokingpipes-${sourceProductId}`,
    source: "smokingpipes",
    sourceProductId,
    sourceUrl,
    rawTitle: `Fixture ${sourceProductId}`,
    displayNameEn: `Fixture ${sourceProductId}`,
    price: { amount: 10, rawText: "$10.00" },
    inventoryStatus: "available",
    imageUrl: `https://example.invalid/${sourceProductId}.jpg`,
    canonicalBrand: "",
    brand: "",
    ...overrides,
  };
}

const production = [
  product("1", "https://www.smokingpipes.com/pipes/new/Chacom/moreinfo.cfm?product_id=1"),
  product("2", "https://www.smokingpipes.com/pipes/new/Chacom/moreinfo.cfm?product_id=2"),
  product("3", "https://www.smokingpipes.com/pipes/new/Chacom/moreinfo.cfm?product_id=3"),
  product("4", "https://www.smokingpipes.com/pipes/new/Andrey-Grigoriev/moreinfo.cfm?product_id=4"),
  product("5", "https://www.smokingpipes.com/pipes/new/Peterson/moreinfo.cfm?product_id=5", {
    brand: "Peterson",
    canonicalBrand: "Peterson",
  }),
  product("6", "https://www.smokingpipes.com/pipes/new/Falcon/moreinfo.cfm?product_id=6"),
];
const list = [
  { sourceProductId: "1", sourceUrl: production[0].sourceUrl, brand: "Chacom" },
  { sourceProductId: "2", sourceUrl: production[1].sourceUrl, brand: "Chacom" },
];
const details = [
  { sourceProductId: "1", sourceUrl: production[0].sourceUrl, brand: "Savinelli", title: "Fixture 1", fullTitle: "Fixture 1" },
];
const result = buildSmokingpipesBrandBackfill({
  productionProducts: production,
  publicProducts: [{ source: "smokingpipes", brandName: "Unknown" }],
  listProducts: list,
  details,
  minimumExpectedRecovered: 0,
});
const byId = new Map(result.nextProducts.map((item) => [item.sourceProductId, item]));

assert.equal(byId.get("1").canonicalBrand, "Savinelli"); // A: detail wins
assert.equal(byId.get("2").canonicalBrand, "Chacom"); // B: list wins
assert.equal(byId.get("3").canonicalBrand, "Chacom"); // C: URL taxonomy
assert.equal(byId.get("4").canonicalBrand, ""); // D/F: unresolved URL stays Unknown
assert.equal(byId.get("5").canonicalBrand, "Peterson"); // E: known stays unchanged
assert.equal(byId.get("6").canonicalBrand, "Falcon"); // G: Falcon remains excluded
assert.equal(byId.get("6").publicIndexEligible, false);
assert.equal(result.report.recoveredFromDetail, 1);
assert.equal(result.report.recoveredFromList, 1);
assert.equal(result.report.recoveredFromUrl, 2);
assert.equal(result.report.falconExcludedCount, 1);
assert.equal(result.report.knownBrandChangedCount, 0);
assert.equal(result.report.nonBrandFieldChangedCount, 0);
assert.equal(result.report.publicUnknownBefore, 1);
assert.equal(result.report.canWrite, false); // required live Skipper fixture is absent

const priceMutated = { ...byId.get("2"), price: { amount: 99, rawText: "$99.00" } };
assert.equal(countUnexpectedNonBrandChanges(byId.get("2"), priceMutated), 1); // H
assert.ok(BRAND_FIELDS.includes("canonicalBrand"));
console.log("Smokingpipes brand backfill tests passed.");
