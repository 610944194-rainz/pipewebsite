import assert from "node:assert/strict";
import {
  inventoryQueryParam,
  parseInventoryQuery,
} from "../lib/public-products/inventory-query.mjs";

assert.equal(parseInventoryQuery(undefined), "available");
assert.equal(parseInventoryQuery(""), "available");
assert.equal(parseInventoryQuery("available"), "available");
assert.equal(parseInventoryQuery("all"), "all");
assert.equal(parseInventoryQuery("sold"), "sold");
assert.equal(parseInventoryQuery("unexpected"), "available");

assert.equal(inventoryQueryParam("available"), null);
assert.equal(inventoryQueryParam("all"), "all");
assert.equal(inventoryQueryParam("sold"), "sold");

console.log("Public products inventory default tests passed.");
