import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSmokingpipesCollectOnlyV2 } from "./smokingpipes-collect-only-v2.mjs";
import { buildInventoryDiff } from "./smokingpipes-diff-inventory-v1.mjs";
import { cyclePaths, readJson, writeJsonAtomic } from "./smokingpipes-cycle-store-v2.mjs";

function listItem(sourceProductId) {
  return { source: "smokingpipes", sourceProductId: String(sourceProductId), sourceUrl: `https://example.test/pipes/${sourceProductId}`, title: `Pipe ${sourceProductId}`, rawTitle: `Pipe ${sourceProductId}`, brand: "Fixture", price: "$100.00", rawListStatus: "", listPage: 1, listPosition: Number(sourceProductId) };
}
function trustedSnapshot(ids) {
  return { source: "smokingpipes", products: ids.map(listItem), pages: [{ page: 1 }], summary: { pagesRequested: 1, pagesScanned: 1, effectiveScannedPages: 1, expectedPages: 1, failedPages: [], fullExpectedRangeScanned: true, normalEndOfListConfirmed: true, normalEndOfListPage: 2, captchaDetected: false, verificationDetected: false, soldByAbsenceAllowed: true, disappearedApplyAllowed: true, duplicateStats: { totalDuplicateIds: 0, safeDuplicateCount: 0, suspiciousDuplicateCount: 0 } } };
}
function productionProducts(ids) {
  return ids.map((id) => ({ id: `smokingpipes-${id}`, source: "smokingpipes", sourceProductId: String(id), sourceUrl: `https://example.test/pipes/${id}`, title: `Pipe ${id}`, inventoryStatus: "available" }));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-list-baseline-"));
try {
  const stateRoot = path.join(temporaryRoot, "state");
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const productsPath = path.join(runtimeRoot, "data", "products", "smokingpipes-products.json");
  const listInputPath = path.join(temporaryRoot, "list-a.json");
  const baselinePath = path.join(stateRoot, "smokingpipes-accepted-list-snapshot-v1.json");
  const production = productionProducts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const listA = trustedSnapshot([1]);
  await writeJsonAtomic(productsPath, production);
  await writeJsonAtomic(listInputPath, listA);

  const first = await runSmokingpipesCollectOnlyV2({ stateRoot, runtimeRoot, cycleId: "2030-02-01", listInputPath, processDetail: async () => { throw new Error("blocked List Diff must not process details"); } });
  const firstPaths = cyclePaths(stateRoot, "2030-02-01");
  assert.equal(first.status, "collection-retryable");
  assert.equal(first.cycle.failure.stage, "list-diff");
  assert.match(first.cycle.failure.message, /10\.00% of historical available inventory; minimum is 50%/);
  assert.equal(fs.existsSync(baselinePath), false);

  await writeJsonAtomic(baselinePath, listA);
  let fetches = 0;
  let launches = 0;
  const resumed = await runSmokingpipesCollectOnlyV2({ stateRoot, runtimeRoot, cycleId: "2030-02-01", live: true, launchBrowserSession: async () => { launches += 1; throw new Error("retained List Diff must not launch Chrome"); }, fetchCurrentList: async () => { fetches += 1; throw new Error("retained List Diff must not fetch Smokingpipes"); }, processDetail: async () => { throw new Error("accepted baseline fixture has no detail candidates"); } });
  const rebuilt = await readJson(firstPaths.inventoryDiff);
  assert.equal(resumed.status, "ready-to-bundle");
  assert.equal(resumed.networkAccessed, false);
  assert.equal(fetches, 0);
  assert.equal(launches, 0);
  assert.equal(rebuilt.allowApply, true);
  assert.deepEqual(rebuilt.fatalWarnings, []);
  assert.equal(rebuilt.coverage.historicalBaseline.type, "accepted-trusted-list-snapshot");
  assert.equal(rebuilt.counts.historicalBaseline, 1);
  assert.equal(rebuilt.counts.disappeared, 0);
  assert.deepEqual(await readJson(productsPath), production);

  const listB = trustedSnapshot([1, 2]);
  const listBPath = path.join(temporaryRoot, "list-b.json");
  await writeJsonAtomic(listBPath, listB);
  const nextCycle = await runSmokingpipesCollectOnlyV2({ stateRoot, runtimeRoot, cycleId: "2030-02-02", listInputPath: listBPath, processDetail: async () => { throw new Error("accepted List fixture has no detail candidates"); } });
  assert.equal(nextCycle.status, "ready-to-bundle");
  assert.deepEqual((await readJson(baselinePath)).products.map((item) => item.sourceProductId), ["1", "2"]);

  const strictBaseline = trustedSnapshot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const strictDiff = buildInventoryDiff(trustedSnapshot([1, 2, 3, 4, 5, 6]), production, { acceptedListBaseline: strictBaseline, allowLegacyDuplicateSnapshotOverride: false });
  assert.equal(strictDiff.allowApply, false);
  assert.equal(strictDiff.counts.disappeared, 4);
  assert.match(strictDiff.fatalWarnings[0], /40\.00% of accepted trusted List snapshot; maximum is 35%/);
  console.log("Smokingpipes accepted List baseline focused test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}