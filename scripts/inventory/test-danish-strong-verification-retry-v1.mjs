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
  finishedAt: "2026-09-08T01:00:00.000Z",
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
    now: Date.parse("2026-09-10T13:00:00.000Z"),
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
    finishedAt: "2026-09-08T02:00:00.000Z",
    productionWritten: false,
    backupCreated: false,
    strongVerificationRetry: { retryableExit: true, resumeNextScheduler: true },
    paths: { rawRoot: unsafeRawRoot },
  })}\n`, "utf8");
  assert.equal(findDanishStrongVerificationResume({ root: tempRoot }).runId, priorRunId);
}

// A strong verification failure exits once, leaves the next attempt to Scheduler, and never sleeps in-process.
{
  const attempts = [];
  const report = await runDanishDailyWithStrongVerificationRetry({ root: tempRoot }, {
    runOnce: async (options) => {
      attempts.push(options);
      return {
        status: "failed",
        failureReason: "manual-verification-timeout",
        productionWritten: false,
        paths: { summaryPath: path.join(tempRoot, "strong-verification-summary.json") },
      };
    },
    wait: async () => assert.fail("strong verification must not sleep or retry in one Scheduler task"),
  });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].runId, priorRunId);
  assert.equal(attempts[0].rawRoot, priorRawRoot);
  assert.equal(report.status, "failed");
  assert.equal(report.productionWritten, false);
  assert.equal(report.strongVerificationRetry.retryableExit, true);
  assert.equal(report.strongVerificationRetry.resumeNextScheduler, true);
  assert.equal(report.strongVerificationRetry.resumedRunId, priorRunId);
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
