import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function main() {
  const entrypoint = await read("scripts/inventory/run-smokingpipes-auto-publish.ps1");
  const scheduledEntrypoint = await read("scripts/inventory/run-smokingpipes-scheduled-task-v1.ps1");
  const collectOnly = await read("scripts/inventory/run-smokingpipes-progressive-daily.ps1");
  const publisher = await read("scripts/inventory/publish-smokingpipes-release-bundle-v2.ps1");
  const orchestrator = await read("scripts/inventory/smokingpipes-auto-publish-v2.mjs");
  const collector = await read("scripts/inventory/smokingpipes-collect-only-v2.mjs");
  const diff = await read("scripts/inventory/smokingpipes-diff-inventory-v1.mjs");
  const validator = await read("scripts/validate-public-product-indexes-v1.mjs");

  assert.match(entrypoint, /smokingpipes-auto-publish-v2\.mjs/);
  assert.match(entrypoint, /--state-root=/);
  assert.match(entrypoint, /--release-root=/);
  assert.match(entrypoint, /--no-publish=true/);
  assert.match(entrypoint, /--preflight-only=true/);
  assert.match(entrypoint, /"fetch", "origin"/);
  assert.match(entrypoint, /"merge", "--ff-only", "origin\/main"/);
  assert.match(entrypoint, /--skip-sync=true/);
  assert.match(entrypoint, /--expected-runtime-sha=/);
  assert.match(entrypoint, /--timeout-seconds=\$DailyTimeoutSeconds/);
  assert.match(entrypoint, /\[ValidateRange\(1, 50\)\]/);
  assert.match(entrypoint, /ProgressiveDetailMax = 50/);
  assert.match(entrypoint, /--notify=true/);
  assert.doesNotMatch(entrypoint, /test-inventory-runner-v1\.mjs/);
  assert.doesNotMatch(entrypoint, /progressive-partial-apply/);
  assert.doesNotMatch(entrypoint, /smokingpipes-products\.json/);

  assert.match(scheduledEntrypoint, /run-smokingpipes-auto-publish\.ps1/);
  assert.doesNotMatch(scheduledEntrypoint, /test-inventory-runner-v1\.mjs/);
  assert.doesNotMatch(scheduledEntrypoint, /progressive-partial-apply/);
  assert.doesNotMatch(scheduledEntrypoint, /smokingpipes-daily-invocation-guard-v1/);
  assert.doesNotMatch(scheduledEntrypoint, /data\\inventory\\smokingpipes-daily-task-state/);

  assert.match(collectOnly, /smokingpipes-collect-only-v2\.mjs/);
  assert.match(collectOnly, /StateRoot must be outside the runtime Git worktree/);
  assert.doesNotMatch(collectOnly, /--write-production/);
  assert.doesNotMatch(collectOnly, /progressive-partial-apply/);

  assert.match(orchestrator, /acquireOwnerTokenLock/);
  assert.match(orchestrator, /release-retryable/);
  assert.match(orchestrator, /bundle-ready/);
  assert.match(orchestrator, /phase: "publishing"/);
  assert.match(orchestrator, /phase: "done"/);
  assert.match(orchestrator, /phase: "retryable"/);
  assert.match(orchestrator, /resolveActiveSmokingpipesCycle/);
  assert.match(orchestrator, /interrupted-validating-release/);
  assert.doesNotMatch(orchestrator, /stale-base/);
  assert.doesNotMatch(orchestrator, /validate-smokingpipes-release-bundle-v2\.mjs/);
  assert.match(orchestrator, /smokingpipesV2ExitCode/);
  assert.match(orchestrator, /sendPushDeerNotification/);
  assert.match(orchestrator, /summarizeSmokingpipesV2CliResult/);
  assert.match(orchestrator, /status: "preflight-passed"/);
  assert.match(orchestrator, /deadline,/);
  assert.doesNotMatch(orchestrator, /test-inventory-runner-v1/);
  assert.doesNotMatch(orchestrator, /run-inventory-automation-v1\.mjs/);

  assert.match(publisher, /validate-smokingpipes-release-bundle-v2\.mjs/);
  assert.match(publisher, /validate-public-product-indexes-v1\.mjs/);
  assert.match(publisher, /--structural-only=true/);
  assert.match(publisher, /test-public-products-inventory-default-v1\.mjs/);
  assert.match(publisher, /"diff", "--check"/);
  assert.match(publisher, /Smokingpipes-Bundle-Id:/);
  assert.match(publisher, /merge-base --is-ancestor HEAD origin\/main/);
  assert.match(publisher, /--baseline-root=\$ReleaseRoot/);
  assert.match(publisher, /\$bundleMatchesRemoteMain/);
  assert.match(publisher, /if \(-not \$bundleMatchesRemoteMain\)/);
  assert.match(publisher, /Push-Location -LiteralPath \$ReleaseRoot/);
  assert.match(publisher, /release clone clean/);
  assert.match(publisher, /bundle owns an unsafe or non-Smokingpipes output path/);
  assert.match(publisher, /@\("add", "--"\)/);
  assert.doesNotMatch(publisher, /Get-FileSha256/);
  assert.doesNotMatch(publisher, /hash mismatch after copy/);
  assert.match(publisher, /featured\.json/);
  assert.match(publisher, /SMOKINGPIPES_PUBLISHER_RESULT_JSON=/);
  assert.match(publisher, /failureStage/);
  assert.match(publisher, /bundle-validator/);
  assert.match(publisher, /public-validator/);
  assert.match(publisher, /release-build/);
  assert.doesNotMatch(publisher, /smokingpipes-release-state-v2\.mjs/);
  assert.match(orchestrator, /parseSmokingpipesPublisherResult/);
  assert.match(orchestrator, /published\.failureStage \|\| published\.status/);
  assert.match(collector, /allowLegacyDuplicateSnapshotOverride: false/);
  assert.match(collector, /suspicious duplicate source product IDs/);
  assert.match(collector, /deadlineAtMs: deadline\?\.deadlineAtMs/);
  assert.match(diff, /allowLegacyDuplicateSnapshotOverride = true/);
  assert.match(validator, /--structural-only=true/);

  console.log("Smokingpipes auto-publish V2 policy tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
