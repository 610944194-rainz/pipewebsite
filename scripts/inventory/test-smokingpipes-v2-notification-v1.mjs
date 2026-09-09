import assert from "node:assert/strict";

import {
  buildSmokingpipesV2Notification,
  smokingpipesV2ExitCode,
} from "./smokingpipes-auto-publish-v2.mjs";

const bundleReady = buildSmokingpipesV2Notification({
  status: "bundle-ready",
  cycleId: "2026-09-09",
  bundleId: "smokingpipes-2026-09-09-fixture",
  readyChangeCount: 256,
  bundleAppliedCount: 0,
  publishedCount: 0,
  cycle: {
    collection: {
      completedDetailIds: ["a", "b"],
    },
    bundle: {
      bundleId: "smokingpipes-2026-09-09-fixture",
      actualAppliedCount: 256,
    },
  },
});

assert.equal(smokingpipesV2ExitCode("bundle-ready"), 0);
assert.equal(bundleReady.title, "Smokingpipes V2｜Bundle 已就绪");
assert.match(bundleReady.body, /cycleId: 2026-09-09/);
assert.match(bundleReady.body, /bundleId: smokingpipes-2026-09-09-fixture/);
assert.match(bundleReady.body, /待发布变更数: 256/);
assert.match(bundleReady.body, /采集完成: 是/);
assert.match(bundleReady.body, /Bundle: 已生成/);
assert.match(bundleReady.body, /Production: 尚未发布/);
assert.match(bundleReady.body, /等待正式发布/);
assert.doesNotMatch(bundleReady.body, /失败阶段|错误尾部|发布待重试/);

const retryable = buildSmokingpipesV2Notification({
  status: "release-retryable",
  cycleId: "2026-09-09",
  failureStage: "publisher",
  error: "fixture publisher failure",
});
assert.equal(smokingpipesV2ExitCode("release-retryable"), 1);
assert.equal(retryable.title, "Smokingpipes V2｜Bundle/发布待重试");
assert.match(retryable.body, /失败阶段: publisher/);
assert.match(retryable.body, /fixture publisher failure/);

console.log("Smokingpipes V2 bundle-ready notification tests passed.");
