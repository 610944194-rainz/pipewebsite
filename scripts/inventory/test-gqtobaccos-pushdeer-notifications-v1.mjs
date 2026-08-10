import assert from "node:assert/strict";

import {
  buildGqDailyFailurePushDeerMessage,
  buildGqDailySuccessPushDeerMessage,
  buildGqPushDeerTestMessage,
  sendGqDailyPushDeerNotification,
} from "./gqtobaccos-pushdeer-notification-v1.mjs";

function dailyResult(overrides = {}) {
  const base = {
    list: {
      pagesDiscovered: 16,
      pagesCompleted: 16,
      productsExtracted: 311,
      rateLimitRetryCount: 0,
    },
    diff: {
      coverage: {},
      counts: { new: 0, disappeared: 0, reappeared: 0, currentAvailable: 311 },
    },
    queue: { queued: 0, failures: 0 },
    validation: { counts: { publicEligible: 263 } },
    allowPublish: true,
  };
  return {
    ...base,
    ...overrides,
    list: { ...base.list, ...(overrides.list || {}) },
    diff: {
      ...base.diff,
      ...(overrides.diff || {}),
      counts: { ...base.diff.counts, ...(overrides.diff?.counts || {}) },
      coverage: { ...base.diff.coverage, ...(overrides.diff?.coverage || {}) },
    },
    queue: { ...base.queue, ...(overrides.queue || {}) },
    validation: {
      ...base.validation,
      ...(overrides.validation || {}),
      counts: { ...base.validation.counts, ...(overrides.validation?.counts || {}) },
    },
  };
}

const successful = buildGqDailySuccessPushDeerMessage(dailyResult({
  diff: { counts: { new: 2 } },
  queue: { queued: 2 },
}));
assert.equal(successful.title, "烟斗派库存日报｜GQ Tobaccos ✅");
assert.match(successful.body, /状态：更新成功/);
assert.match(successful.body, /新增：2/);
assert.match(successful.body, /Production：已更新/);

const noChange = buildGqDailySuccessPushDeerMessage(dailyResult());
assert.match(noChange.body, /新增：0/);
assert.match(noChange.body, /下架：0/);
assert.match(noChange.body, /重新出现：0/);
assert.match(noChange.body, /详情补抓：0/);
assert.match(noChange.body, /Production：无变化/);

const newProducts = buildGqDailySuccessPushDeerMessage(dailyResult({ diff: { counts: { new: 3 } } }));
assert.match(newProducts.body, /新增：3/);

const disappearedProducts = buildGqDailySuccessPushDeerMessage(dailyResult({ diff: { counts: { disappeared: 4 } } }));
assert.match(disappearedProducts.body, /下架：4/);

const recoveredRateLimit = buildGqDailySuccessPushDeerMessage(dailyResult({ list: { rateLimitRetryCount: 1 } }));
assert.match(recoveredRateLimit.body, /429 重试：1/);

const terminalRateLimitError = new Error("HTTP 429 for https://www.gqtobaccos.com/pipes/?page=14");
terminalRateLimitError.status = 429;
terminalRateLimitError.rateLimitRetries = 3;
terminalRateLimitError.listProgress = { pagesDiscovered: 14, pagesCompleted: 13, pagesFailed: 1, lastSuccessfulPage: 13 };
const terminalRateLimit = buildGqDailyFailurePushDeerMessage({ error: terminalRateLimitError });
assert.equal(terminalRateLimit.title, "烟斗派库存日报｜GQ Tobaccos ❌");
assert.match(terminalRateLimit.body, /失败阶段：List/);
assert.match(terminalRateLimit.body, /扫描：13\/14 页/);
assert.match(terminalRateLimit.body, /失败页：14/);
assert.match(terminalRateLimit.body, /HTTP：429/);
assert.match(terminalRateLimit.body, /429 重试：3/);
assert.match(terminalRateLimit.body, /allowPublish：false/);
assert.match(terminalRateLimit.body, /Production：未修改/);

const blocked = buildGqDailyFailurePushDeerMessage({
  error: new Error("GQ production write is blocked by the shared anomaly gate or required-detail validation."),
  dailyResult: dailyResult({ allowPublish: false }),
});
assert.match(blocked.body, /失败阶段：Validation/);
assert.match(blocked.body, /allowPublish：false/);

const missingKey = await sendGqDailyPushDeerNotification({ dailyResult: dailyResult(), env: {}, fetchImpl: async () => { throw new Error("must not fetch without a key"); } });
assert.equal(missingKey.notificationSent, false);
assert.equal(missingKey.notificationSkipped, true);
assert.equal(missingKey.notificationReason, "missing PushDeer key");

const apiFailure = await sendGqDailyPushDeerNotification({
  dailyResult: dailyResult(),
  env: { PUSHDEER_KEY: "fixture-key" },
  fetchImpl: async () => ({ ok: false, status: 503 }),
});
assert.equal(apiFailure.notificationSent, false);
assert.equal(apiFailure.notificationSkipped, false);
assert.equal(apiFailure.notificationReason, "PushDeer HTTP 503");

const apiSuccess = await sendGqDailyPushDeerNotification({
  testNotification: true,
  env: { YAN_DOUBUY_PUSHDEER_PUSHKEY: "fixture-key" },
  fetchImpl: async (url) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.searchParams.get("text"), "烟斗派｜GQ PushDeer 测试 ✅");
    assert.equal(requestUrl.searchParams.get("desp"), "GQ Tobaccos 自动日更通知已连接。");
    return { ok: true, status: 200 };
  },
});
assert.equal(apiSuccess.notificationSent, true);
assert.equal(apiSuccess.pushDeerEnvName, "YAN_DOUBUY_PUSHDEER_PUSHKEY");
assert.equal(apiSuccess.title, "烟斗派｜GQ PushDeer 测试 ✅");

assert.deepEqual(buildGqPushDeerTestMessage(), {
  title: "烟斗派｜GQ PushDeer 测试 ✅",
  body: "GQ Tobaccos 自动日更通知已连接。",
});

console.log("GQ Tobaccos PushDeer notification fixture tests passed.");
