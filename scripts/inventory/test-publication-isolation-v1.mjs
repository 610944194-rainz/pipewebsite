import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath) => fs.readFile(path.join(root, relativePath), "utf8");

const [gqWrapper, gqRunner, smokingpipesPublisher, danishPublisher, lockModule] = await Promise.all([
  read("scripts/inventory/run-gqtobaccos-auto-publish.ps1"),
  read("scripts/inventory/run-gqtobaccos-daily-v1.mjs"),
  read("scripts/inventory/publish-smokingpipes-release-bundle-v2.ps1"),
  read("scripts/server/publish-source.sh"),
  read("scripts/lib/production-publish-lock-v1.psm1"),
]);

const sharedLockModule = "production-publish-lock-v1.psm1";
assert.match(gqWrapper, new RegExp(sharedLockModule));
assert.match(smokingpipesPublisher, new RegExp(sharedLockModule));
assert.match(lockModule, /\/srv\/yandoubuy\/state\/publisher\/production-publish\.lock/);
assert.match(danishPublisher, /production-publish\.lock/);
assert.match(danishPublisher, /flock -w/);

// CASE A/F: source collection and detail work do not take the global lock;
// a publication lock timeout is retryable and does not become a health flag.
assert.doesNotMatch(gqRunner, /production-publish-lock-v1/);
assert.match(gqWrapper, /publisher-lock-timeout/);
assert.match(smokingpipesPublisher, /publisher-lock-timeout/);
assert.match(danishPublisher, /publisher-lock-timeout/);

// CASE B/G: the final base fetch/ff-only check happens after lock acquisition.
assert.ok(gqWrapper.indexOf("Acquire-ProductionPublishLock") < gqWrapper.indexOf("$lockedSyncResult = Sync-FormalMainRuntime"));
assert.ok(gqWrapper.indexOf("$lockedSyncResult = Sync-FormalMainRuntime") < gqWrapper.lastIndexOf("Invoke-GqCandidateApply -CandidatePath"));
assert.ok(smokingpipesPublisher.indexOf("Acquire-ProductionPublishLock") < smokingpipesPublisher.lastIndexOf("Invoke-ReleaseFetchWithRetry"));
assert.match(danishPublisher, /fetch origin/);
assert.match(danishPublisher, /pull --ff-only origin main/);

// CASE C/D/E: failures before push restore only this source's tracked paths;
// a post-commit push failure retains a clean recognizable commit.
assert.match(gqWrapper, /function Restore-GqPublicationPaths/);
assert.match(gqWrapper, /function Restore-GqRuntimeAfterPushFailure/);
assert.match(gqWrapper, /reset\", \"--hard\", \"origin\/main/);
assert.match(smokingpipesPublisher, /reset/, "Smokingpipes release cleanup must reset before push");
assert.match(smokingpipesPublisher, /Release-ProductionPublishLock/);
assert.match(danishPublisher, /rollback_if_needed/);
assert.match(danishPublisher, /rollback_required=0/);

// CASE F: every source serializes only Production/Git publication; no central
// collector lock or shared mutable queue is introduced.
assert.doesNotMatch(gqRunner, /PUBLISHER_LOCK_PATH|production-publish/);
assert.doesNotMatch(smokingpipesPublisher, /data\/inventory\/state\/smokingpipes\.lock/);
assert.match(gqWrapper, /--apply-candidate=/);
assert.match(gqWrapper, /--notify-on-failure/);
assert.match(gqWrapper, /--notify-report=/);
assert.match(gqRunner, /applyGqProductionCandidate/);
assert.match(gqRunner, /GQ Production apply must run through the locked scheduled publisher candidate path/);

console.log("cross-source publication isolation contract tests passed (cases A-G).");
