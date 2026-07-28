import assert from "node:assert/strict";
import {
  buildSmokingpipesActionableApplyPlan,
  markSmokingpipesActionEventsApplied,
  SMOKINGPIPES_CATCHUP_BATCH_LIMIT,
} from "./smokingpipes-actionable-events-v1.mjs";

const now = "2026-07-29T00:00:00.000Z";

function product(id, { price = 100, status = "available" } = {}) {
  return {
    sourceProductId: String(id),
    name: `Pipe ${id}`,
    inventoryStatus: status,
    price: { current: { amount: price, currency: "USD" } },
  };
}

function candidate(id, changeTypes, extra = {}) {
  return {
    sourceProductId: String(id),
    changeTypes,
    detailStatus: "complete",
    publicStatus: "ready",
    listPrice: "$120.00",
    lastSeenRunId: "scan-1",
    firstSeenRunId: "scan-1",
    ...extra,
  };
}

function inputs({ products, candidates, listProducts = [], diff = {} }) {
  return {
    productionProducts: products,
    state: {
      candidates,
      actionEvents: {},
      globalReconcile: { disappearanceTracking: { items: {} } },
    },
    currentPayload: {
      generatedAt: now,
      completedAt: now,
      products: listProducts,
      summary: { pagesScanned: 1, expectedPages: 1 },
    },
    diffPayload: { newIds: [], reappearedIds: [], ...diff },
    now,
  };
}

function priceListItem(id, price = "$120.00") {
  return { sourceProductId: String(id), price, rawListStatus: "" };
}

// Current trusted price change is planned once.
const currentPrice = inputs({
  products: [product("p1")],
  candidates: [candidate("p1", ["price-change"])],
  listProducts: [priceListItem("p1")],
});
const currentPlan = buildSmokingpipesActionableApplyPlan(currentPrice);
assert.equal(currentPlan.items.length, 1);
assert.equal(currentPlan.items[0].event.changeType, "price-change");

// A prior price event whose desired value is already live is superseded.
const eventId = currentPlan.items[0].event.eventId;
const alreadyAppliedState = {
  ...currentPrice.state,
  actionEvents: {
    [eventId]: currentPlan.items[0].event,
  },
};
const alreadyApplied = buildSmokingpipesActionableApplyPlan({
  ...currentPrice,
  productionProducts: [currentPlan.items[0].desired],
  state: alreadyAppliedState,
});
assert.equal(alreadyApplied.items.length, 0);
assert.equal(alreadyApplied.eventsById[eventId].status, "superseded");

// A pending event must never silently apply across a Production baseline change.
const baselineChanged = buildSmokingpipesActionableApplyPlan({
  ...currentPrice,
  productionProducts: [product("p1", { price: 110 })],
  state: alreadyAppliedState,
});
assert.equal(baselineChanged.items.length, 0);
assert.equal(baselineChanged.eventsById[eventId].status, "isolated");

// Explicit OOS already represented by Production is also superseded, not replayed.
const oos = inputs({
  products: [product("p2", { status: "available" })],
  candidates: [candidate("p2", ["explicit-out-of-stock"])],
  listProducts: [{ sourceProductId: "p2", price: "$100.00", rawListStatus: "OUT OF STOCK" }],
});
const oosPlan = buildSmokingpipesActionableApplyPlan(oos);
const oosApplied = buildSmokingpipesActionableApplyPlan({
  ...oos,
  productionProducts: [oosPlan.items[0].desired],
  state: { ...oos.state, actionEvents: { [oosPlan.items[0].event.eventId]: oosPlan.items[0].event } },
});
assert.equal(oosApplied.items.length, 0);
assert.equal(oosApplied.eventsById[oosPlan.items[0].event.eventId].status, "superseded");

// A completed new detail enters once and is not replayed after its event is applied.
const newProduct = product("p3", { price: 150 });
newProduct.mainImageUrl = "https://example.test/p3.jpg";
const newInputs = inputs({
  products: [],
  candidates: [candidate("p3", ["new-product"], { convertedProduct: newProduct })],
  listProducts: [priceListItem("p3", "$150.00")],
  diff: { newIds: ["p3"] },
});
const newPlan = buildSmokingpipesActionableApplyPlan(newInputs);
assert.equal(newPlan.items.length, 1);
const appliedNewState = markSmokingpipesActionEventsApplied({
  state: { ...newInputs.state, actionEvents: newPlan.eventsById },
  eventIds: [newPlan.items[0].event.eventId],
  appliedRunId: "apply-1",
  appliedAt: now,
});
const noNewReplay = buildSmokingpipesActionableApplyPlan({
  ...newInputs,
  productionProducts: [newProduct],
  state: appliedNewState,
});
assert.equal(noNewReplay.items.length, 0);

// Stale candidate history without a matching trusted source cannot enter a plan.
const stale = inputs({
  products: [product("p4")],
  candidates: [candidate("p4", ["price-change"])],
  listProducts: [],
});
assert.equal(buildSmokingpipesActionableApplyPlan(stale).items.length, 0);

// A genuine backlog is deterministically split, never auto-looped.
const backlogCount = 2414;
const backlogProducts = Array.from({ length: backlogCount }, (_, index) =>
  product(`b${index}`, { status: "available" })
);
const backlogCandidates = backlogProducts.map((item) =>
  candidate(item.sourceProductId, ["explicit-out-of-stock"])
);
const backlogList = backlogProducts.map((item) => ({
  sourceProductId: item.sourceProductId,
  price: "$100.00",
  rawListStatus: "OUT OF STOCK",
}));
const backlogPlan = buildSmokingpipesActionableApplyPlan(inputs({
  products: backlogProducts,
  candidates: backlogCandidates,
  listProducts: backlogList,
}));
assert.equal(backlogPlan.items.length, backlogCount);
assert.deepEqual(
  backlogPlan.catchupBatches.map((batch) => batch.sourceProductIds.length),
  [SMOKINGPIPES_CATCHUP_BATCH_LIMIT, backlogCount - SMOKINGPIPES_CATCHUP_BATCH_LIMIT]
);
assert.ok(backlogPlan.catchupBatches.every((batch) => batch.requiresManualApproval));

console.log("Smokingpipes actionable event lifecycle tests passed.");
