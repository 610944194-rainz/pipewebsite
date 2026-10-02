import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findDanishStrongVerificationResume,
  isDanishStrongVerificationFailure,
  runDanishDailyWithStrongVerificationRetry,
} from "./run-danish-daily-v1.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-strong-verification-retry-"));
const recent = Date.now() - 60000;
const priorRunId = "danish-daily-prior";
const priorRawRoot = path.join(tempRoot, "data", "raw", "danish-full-refresh", priorRunId);
const priorRunRoot = path.join(tempRoot, "data", "inventory", "danish-daily", priorRunId);
fs.mkdirSync(priorRawRoot, { recursive: true });
fs.mkdirSync(priorRunRoot, { recursive: true });
fs.writeFileSync(path.join(priorRunRoot, "run-summary.json"), `${JSON.stringify({
  runId: priorRunId,
  mode: "publish",
  status: "failed",
  failureReason: "manual-verification-timeout after 900 seconds",
  finishedAt: new Date(recent).toISOString(),
  productionWritten: false,
  backupCreated: false,
  strongVerificationRetry: { retryableExit: true, resumeNextScheduler: true },
  paths: { rawRoot: priorRawRoot, backupRoot: path.join(tempRoot, "backups", priorRunId) },
})}\n`, "utf8");

assert.equal(isDanishStrongVerificationFailure("manual-verification-timeout"), true);
assert.equal(isDanishStrongVerificationFailure("parser contract failure"), false);
assert.equal(findDanishStrongVerificationResume({ root: tempRoot }).runId, priorRunId);
assert.equal(
  findDanishStrongVerificationResume({
    root: tempRoot,
    now: recent + 3 * 86400000,
  }),
  null,
  "over-age retryable runs must not be reused"
);

// Explicit retry metadata, a recent timestamp, and a trusted List are all required for reuse.
{
  const unsafeRunRoot = path.join(tempRoot, "data", "inventory", "danish-daily", "unsafe-run");
  const unsafeRawRoot = path.join(tempRoot, "data", "raw", "danish-full-refresh", "unsafe-run");
  fs.mkdirSync(unsafeRunRoot, { recursive: true });
  fs.mkdirSync(unsafeRawRoot, { recursive: true });
  fs.writeFileSync(path.join(unsafeRawRoot, "list.json"), "{not-json", "utf8");
  fs.writeFileSync(path.join(unsafeRunRoot, "run-summary.json"), `${JSON.stringify({
    runId: "unsafe-run",
    mode: "publish",
    status: "failed",
    failureReason: "manual-verification-timeout",
    finishedAt: new Date(recent + 1000).toISOString(),
    productionWritten: false,
    backupCreated: false,
    strongVerificationRetry: { retryableExit: true, resumeNextScheduler: true },
    paths: { rawRoot: unsafeRawRoot },
  })}\n`, "utf8");
  assert.equal(findDanishStrongVerificationResume({ root: tempRoot }).runId, priorRunId);
}

// Exactly one same-run resume follows manual timeout, after locks are released.
{
  const attempts = [];
  const report = await runDanishDailyWithStrongVerificationRetry({ root: tempRoot, mode: "publish" }, {
    runOnce: async (options) => {
      attempts.push(options);
      return {
        runId: priorRunId,
        status: "failed",
        failureReason: "manual-verification-timeout",
        productionWritten: false,
        paths: { rawRoot: priorRawRoot, summaryPath: path.join(tempRoot, "strong-verification-summary.json") },
      };
    },
    wait: async (ms) => {
      assert.equal(ms, 10000);
      assert.equal(fs.existsSync(path.join(tempRoot, "data/inventory/state/danish-daily.lock")), false);
    },
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].runId, priorRunId);
  assert.equal(attempts[1].rawRoot, priorRawRoot);
  assert.equal(attempts[0].runId, priorRunId);
  assert.equal(attempts[0].rawRoot, priorRawRoot);
  assert.equal(report.status, "failed");
  assert.equal(report.productionWritten, false);
  assert.equal(report.strongVerificationRetry.retryableExit, true);
  assert.equal(report.strongVerificationRetry.resumeNextScheduler, true);
  assert.equal(report.strongVerificationRetry.resumedRunId, priorRunId);
}

for (const reason of ["CAPTCHA blocked", "validation failed", "Git failed", "Production gate failed", "manual-verification-timeout timedOut=true"]) {
  let count = 0;
  await runDanishDailyWithStrongVerificationRetry({ root: tempRoot, mode: "publish", runId: "no-same-day-retry" }, {
    runOnce: async () => { count++; return { status: "failed", runId: "no-same-day-retry", failureReason: reason,
      productionWritten: false, paths: { rawRoot: priorRawRoot, summaryPath: path.join(tempRoot, "other-summary.json") } }; },
    wait: async () => assert.fail("non-timeout errors must not same-day retry"),
  });
  assert.equal(count, 1);
}

{
  let count = 0;
  const report = await runDanishDailyWithStrongVerificationRetry({ root: tempRoot, mode: "publish", runId: "resume-success" }, {
    runOnce: async (options) => {
      count++;
      assert.equal(options.runId, "resume-success");
      return { status: count === 1 ? "failed" : "publish-passed", runId: options.runId, failureReason: count === 1 ? "manual-verification-timeout" : "",
        productionWritten: false, paths: { rawRoot: priorRawRoot, summaryPath: path.join(tempRoot, "resume-success.json") } };
    }, wait: async () => {},
  });
  assert.equal(count, 2);
  assert.equal(report.status, "publish-passed");
  assert.equal(report.strongVerificationRetry.retryableExit, false);
}

// Deterministic failures stay non-retryable and run only once.
{
  let count = 0;
  const report = await runDanishDailyWithStrongVerificationRetry({ root: tempRoot, runId: "ordinary-failure" }, {
    runOnce: async () => {
      count += 1;
      return { status: "failed", failureReason: "parser contract failure", productionWritten: false };
    },
  });
  assert.equal(count, 1);
  assert.equal(report.strongVerificationRetry.retryableExit, false);
}

console.log("Danish strong-verification retry focused tests passed");
