import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireRunLock,
  buildDetailsQueue,
  evaluateRunnerReadiness,
  parseRunnerOptions,
  releaseRunLock,
} from "./inventory-runner-core-v1.mjs";

const defaults = parseRunnerOptions([]);
assert.equal(defaults.source, "smokingpipes");
assert.equal(defaults.mode, "dry-run");
assert.equal(defaults.commit, false);
assert.equal(defaults.deploy, false);
assert.equal(defaults.maxPages, 107);
assert.equal(defaults.maxNewDetailsPerRun, 100);

assert.throws(
  () => parseRunnerOptions(["--mode=apply"]),
  /not implemented/i,
  "V1 must reject production apply"
);

const firstQueue = buildDetailsQueue({
  existingQueue: null,
  diff: { generatedAt: "2026-06-20T00:00:00.000Z", newIds: ["101", "102"] },
  currentProducts: [
    { sourceProductId: "101", sourceUrl: "https://example/101", title: "One" },
    { sourceProductId: "102", sourceUrl: "https://example/102", title: "Two" },
  ],
  now: "2026-06-20T00:01:00.000Z",
});
assert.equal(firstQueue.items.length, 2);
assert.equal(firstQueue.items[0].status, "pending");

firstQueue.items[0] = {
  ...firstQueue.items[0],
  status: "completed",
  retryCount: 1,
  detail: { sourceProductId: "101", title: "One detail" },
};

const resumedQueue = buildDetailsQueue({
  existingQueue: firstQueue,
  diff: { generatedAt: "2026-06-21T00:00:00.000Z", newIds: ["101", "103"] },
  currentProducts: [
    { sourceProductId: "101", sourceUrl: "https://example/101", title: "One" },
    { sourceProductId: "103", sourceUrl: "https://example/103", title: "Three" },
  ],
  now: "2026-06-21T00:01:00.000Z",
});
assert.equal(
  resumedQueue.items.find((item) => item.sourceProductId === "101")?.status,
  "completed",
  "completed details must not be fetched twice"
);
assert.equal(
  resumedQueue.items.find((item) => item.sourceProductId === "102")?.status,
  "superseded"
);

const pendingReadiness = evaluateRunnerReadiness({
  inventoryValidation: { status: "passed", allowApply: true },
  diff: { allowApply: true, coverage: { fullExpectedRangeScanned: true } },
  queue: resumedQueue,
});
assert.equal(pendingReadiness.status, "details-pending");
assert.equal(pendingReadiness.allowApply, false);

for (const item of resumedQueue.items) {
  if (item.active) item.status = "completed";
}
const ready = evaluateRunnerReadiness({
  inventoryValidation: { status: "passed", allowApply: true },
  diff: { allowApply: true, coverage: { fullExpectedRangeScanned: true } },
  queue: resumedQueue,
});
assert.equal(ready.status, "apply-ready");
assert.equal(ready.allowApply, true);

const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-lock-test-"));
const lockPath = path.join(lockRoot, "smokingpipes.lock");
const lock = acquireRunLock(lockPath, {
  runId: "test-run",
  source: "smokingpipes",
});
assert.throws(() => acquireRunLock(lockPath, { runId: "second" }), /already running/i);
releaseRunLock(lock);
assert.equal(fs.existsSync(lockPath), false);

console.log("Inventory runner core tests passed.");
