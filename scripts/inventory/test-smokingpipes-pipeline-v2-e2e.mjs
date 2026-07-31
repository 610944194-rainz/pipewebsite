import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  acquireOwnerTokenLock,
  createCycle,
  cyclePaths,
  loadOrCreateCycle,
  readCycle,
  readJson,
  releaseOwnerTokenLock,
  transitionCycle,
  writeCycle,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  runSmokingpipesCollectOnlyV2,
} from "./smokingpipes-collect-only-v2.mjs";
import {
  buildSmokingpipesReleaseBundleV2,
} from "./smokingpipes-build-release-bundle-v2.mjs";
import {
  validateSmokingpipesReleaseBundleV2,
} from "./validate-smokingpipes-release-bundle-v2.mjs";
import {
  runSmokingpipesAutoPublishV2,
} from "./smokingpipes-auto-publish-v2.mjs";
import {
  createProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readWorkspaceJson(relativeFile) {
  return JSON.parse(await fs.promises.readFile(path.join(workspaceRoot, relativeFile), "utf8"));
}

function git(directory, arguments_) {
  return execFileSync("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function writeText(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, contents, "utf8");
}

function runPublisher(arguments_) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(workspaceRoot, "scripts", "inventory", "publish-smokingpipes-release-bundle-v2.ps1"),
    ...arguments_,
  ], { encoding: "utf8", windowsHide: true });
}

function trustedSnapshot(products) {
  return {
    version: "smokingpipes-current-list-dry-run-v1",
    source: "smokingpipes",
    products,
    summary: {
      expectedPages: 1,
      effectiveScannedPages: 1,
      fullExpectedRangeScanned: true,
      failedPages: [],
      captchaDetected: false,
      verificationDetected: false,
    },
  };
}

function listItem(id, brand = "Test Brand") {
  return {
    source: "smokingpipes",
    sourceProductId: id,
    sourceUrl: "https://example.test/moreinfo.cfm?product_id=" + id,
    title: "Fixture Pipe " + id,
    rawTitle: "Fixture Pipe " + id,
    brand,
    price: "$120.00",
    image: "https://example.test/" + id + ".jpg",
    mainImage: "https://example.test/" + id + ".jpg",
    listPage: 1,
    listPosition: Number(id),
  };
}

async function transitionToReady({ stateRoot, cycleId }) {
  let cycle = await readCycle(stateRoot, cycleId);
  cycle = await transitionCycle({ stateRoot, cycle, phase: "collecting-list", reason: "fixture" });
  cycle = await transitionCycle({ stateRoot, cycle, phase: "list-ready", reason: "fixture" });
  return transitionCycle({ stateRoot, cycle, phase: "ready-to-bundle", reason: "fixture" });
}

async function main() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "smokingpipes-v2-e2e-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const stateRoot = path.join(temporaryRoot, "state");
  try {
    const template = (await readWorkspaceJson("data/products/smokingpipes-products.json"))[0];
    await writeJsonAtomic(
      path.join(runtimeRoot, "data", "products", "smokingpipes-products.json"),
      [template]
    );
    await writeJsonAtomic(
      path.join(runtimeRoot, "data", "products", "danish-products.json"),
      []
    );
    await writeText(runtimeRoot, "scripts/validate-public-product-indexes-v1.mjs", "process.exit(0);\n");
    await writeText(runtimeRoot, "scripts/test-public-products-inventory-default-v1.mjs", "process.exit(0);\n");
    await writeText(runtimeRoot, "package.json", JSON.stringify({
      private: true,
      scripts: { build: "node -e \"process.exit(9)\"" },
    }));
    git(temporaryRoot, ["init", "--initial-branch=main", runtimeRoot]);
    git(runtimeRoot, ["config", "user.email", "fixture@example.invalid"]);
    git(runtimeRoot, ["config", "user.name", "Fixture"]);
    git(runtimeRoot, ["add", "--", "."]);
    git(runtimeRoot, ["commit", "-m", "fixture baseline"]);
    const runtimeBaseSha = git(runtimeRoot, ["rev-parse", "HEAD"]);
    const bareOrigin = path.join(temporaryRoot, "origin.git");
    execFileSync("git", ["clone", "--bare", runtimeRoot, bareOrigin], { stdio: "ignore" });
    git(runtimeRoot, ["remote", "add", "origin", bareOrigin]);
    git(runtimeRoot, ["fetch", "origin"]);
    git(runtimeRoot, ["branch", "--set-upstream-to=origin/main", "main"]);
    const releaseRoot = path.join(temporaryRoot, "release");
    execFileSync("git", ["clone", bareOrigin, releaseRoot], { stdio: "ignore" });
    const products = [
      ...Array.from({ length: 48 }, (_, index) => listItem(String(900000 + index))),
      listItem("999999", "Falcon"),
    ];
    const listPath = path.join(temporaryRoot, "list.json");
    await writeJsonAtomic(listPath, trustedSnapshot(products));
    const detailProcessor = async (candidate) => ({
      detail: { sourceProductId: candidate.sourceProductId, title: candidate.listTitle },
      convertedProduct: {
        ...structuredClone(template),
        id: "smokingpipes-" + candidate.sourceProductId,
        sourceProductId: candidate.sourceProductId,
        sourceUrl: candidate.sourceUrl,
        brand: candidate.listBrand || "Test Brand",
        rawTitle: candidate.listTitle,
        fullTitle: candidate.listTitle,
        displayNameEn: candidate.listTitle,
        imageUrl: candidate.listPrimaryImage,
        mainImageUrl: candidate.listPrimaryImage,
        detailImageUrl: candidate.listPrimaryImage,
        galleryImages: [candidate.listPrimaryImage],
        price: {
          ...template.price,
          current: { ...template.price.current, rawText: candidate.listPrice, amount: 120 },
          listPrice: { ...template.price.listPrice, rawText: candidate.listPrice, amount: 120 },
        },
      },
      publicReady: true,
    });

    const first = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      listInputPath: listPath,
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(first.status, "enriching-details");
    assert.equal(first.cycle.collection.pendingDetailIds.length, 24);
    const second = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(second.status, "ready-to-bundle");
    assert.equal(second.networkAccessed, false);
    assert.equal(second.cycle.collection.completedDetailIds.length, 48);
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "900000.json")), true);
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "999999.json")), false);

    const built = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: "2030-01-01",
      baselineRoot: runtimeRoot,
      baseMainSha: "fixture-base",
      generatorCommitSha: "fixture-generator",
      maxAutoApply: 2000,
    });
    assert.equal(built.status, "bundle-ready");
    const validation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: runtimeRoot,
    });
    assert.equal(validation.valid, true, validation.blockers.join("; "));
    const outputProducts = await readJson(
      path.join(built.bundleRoot, "outputs", "data", "products", "smokingpipes-products.json")
    );
    assert.equal(outputProducts.some((product) => /falcon/i.test(String(product.brand || product.brandName || ""))), false);

    const invalidBundleRoot = path.join(temporaryRoot, "invalid-bundle");
    await writeJsonAtomic(path.join(invalidBundleRoot, "manifest.json"), {
      schemaVersion: "smokingpipes-release-bundle-v2",
      bundleId: "invalid-fixture-bundle",
      baseMainSha: runtimeBaseSha,
      selectedIds: ["invalid-fixture"],
      actualAppliedCount: 1,
      maxAutoApply: 10,
      changeTypeCounts: { other: 1 },
      featuredExcluded: true,
      outputFileHashes: { "data/products/smokingpipes-products.json": "not-a-real-hash" },
    });
    await writeJsonAtomic(path.join(invalidBundleRoot, "summary.json"), {});
    await writeJsonAtomic(path.join(invalidBundleRoot, "changes.json"), []);
    const validatorFailure = runPublisher([
      "-StateRoot", stateRoot,
      "-CycleId", "2030-01-01",
      "-BundleRoot", invalidBundleRoot,
      "-ReleaseRoot", releaseRoot,
      "-RuntimeRoot", workspaceRoot,
    ]);
    assert.notEqual(validatorFailure.status, 0);
    assert.match(`${validatorFailure.stdout}\n${validatorFailure.stderr}`, /release-retryable/);
    assert.equal(git(releaseRoot, ["status", "--short"]), "");

    const publishBundle = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: "2030-01-01",
      runtimeRoot,
      baseMainSha: runtimeBaseSha,
      generatorCommitSha: runtimeBaseSha,
      maxAutoApply: 2000,
    });
    assert.equal(publishBundle.status, "bundle-ready");
    const buildFailure = runPublisher([
      "-StateRoot", stateRoot,
      "-CycleId", "2030-01-01",
      "-BundleRoot", publishBundle.bundleRoot,
      "-ReleaseRoot", releaseRoot,
      "-RuntimeRoot", workspaceRoot,
    ]);
    assert.notEqual(buildFailure.status, 0);
    assert.match(`${buildFailure.stdout}\n${buildFailure.stderr}`, /release-retryable/);
    assert.equal(git(releaseRoot, ["status", "--short"]), "");
    assert.equal(git(releaseRoot, ["rev-parse", "HEAD"]), git(releaseRoot, ["rev-parse", "origin/main"]));

    const retainedDetail = await readJson(path.join(stateRoot, "details", "900000.json"));
    const releaseRetry = await readCycle(stateRoot, "2030-01-01");
    assert.equal(releaseRetry.phase, "release-retryable");
    assert.equal((await readJson(path.join(stateRoot, "details", "900000.json"))).sourceProductId, retainedDetail.sourceProductId);
    const retry = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(retry.status, "release-resume-required");
    assert.equal(retry.networkAccessed, false);

    const remoteWriter = path.join(temporaryRoot, "remote-writer");
    execFileSync("git", ["clone", bareOrigin, remoteWriter], { stdio: "ignore" });
    git(remoteWriter, ["config", "user.email", "writer@example.invalid"]);
    git(remoteWriter, ["config", "user.name", "Writer"]);
    await writeText(remoteWriter, "remote-advance.txt", "advance\n");
    git(remoteWriter, ["add", "--", "remote-advance.txt"]);
    git(remoteWriter, ["commit", "-m", "fixture remote advance"]);
    git(remoteWriter, ["push", "origin", "HEAD:main"]);
    const remoteRetry = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      live: false,
      publisher: async ({ bundleRoot }) => {
        assert.equal(bundleRoot, publishBundle.bundleRoot);
        return { status: "release-retryable", injected: true };
      },
    });
    assert.equal(remoteRetry.networkAccessed, false);
    assert.equal(git(runtimeRoot, ["status", "--short"]), "");
    assert.equal(git(runtimeRoot, ["rev-parse", "HEAD"]), git(runtimeRoot, ["rev-parse", "origin/main"]));

    const detailFailureId = "2030-01-03";
    const detailFailureList = path.join(temporaryRoot, "detail-failure-list.json");
    await writeJsonAtomic(detailFailureList, trustedSnapshot([listItem("910000")]));
    const failedDetailRun = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: detailFailureId,
      listInputPath: detailFailureList,
      detailLimit: 1,
      processDetail: async () => {
        throw new Error("fixture detail failure");
      },
    });
    assert.equal(failedDetailRun.status, "enriching-details");
    const failedDetailPath = path.join(stateRoot, "details", "910000.json");
    const failedDetail = await readJson(failedDetailPath);
    assert.equal(failedDetail.detailStatus, "blocked");
    const failedPaths = cyclePaths(stateRoot, detailFailureId);
    const retryState = await readJson(failedPaths.legacyProgressiveState);
    retryState.candidates[0].nextEligibleAt = new Date(0).toISOString();
    await writeJsonAtomic(failedPaths.legacyProgressiveState, retryState);
    const resumedDetailRun = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: detailFailureId,
      detailLimit: 1,
      processDetail: detailProcessor,
    });
    assert.equal(resumedDetailRun.status, "ready-to-bundle");
    assert.equal((await readJson(failedDetailPath)).detailStatus, "complete");
    assert.equal(resumedDetailRun.networkAccessed, false);

    const noChangeId = "2030-01-02";
    const { cycle: noChangeCycle } = await loadOrCreateCycle({ stateRoot, cycleId: noChangeId });
    const noChangePaths = cyclePaths(stateRoot, noChangeId);
    await writeJsonAtomic(noChangePaths.legacyProgressiveState, createProgressiveDailyState({ dailyRunId: noChangeId }));
    await writeJsonAtomic(noChangePaths.listManifest, {
      schemaVersion: "smokingpipes-list-manifest-v2",
      snapshotHash: "fixture-snapshot",
    });
    await transitionToReady({ stateRoot, cycleId: noChangeId });
    const noChange = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: noChangeId,
      baselineRoot: runtimeRoot,
      baseMainSha: "fixture-base",
      generatorCommitSha: "fixture-generator",
    });
    assert.equal(noChange.status, "no-change");

    const lockOne = await acquireOwnerTokenLock({ stateRoot, ownerToken: "fixture-owner" });
    const lockTwo = await acquireOwnerTokenLock({ stateRoot, ownerToken: "other-owner" });
    assert.equal(lockOne.acquired, true);
    assert.equal(lockTwo.acquired, false);
    await releaseOwnerTokenLock({ stateRoot, ownerToken: "fixture-owner" });

    const atomicTarget = path.join(stateRoot, "atomic", "value.json");
    await writeJsonAtomic(atomicTarget, { value: 1 });
    assert.deepEqual(await readJson(atomicTarget), { value: 1 });
    const invalid = createCycle({ cycleId: "2030-01-03" });
    await writeCycle(stateRoot, invalid);
    await assert.rejects(
      transitionCycle({ stateRoot, cycle: invalid, phase: "published", reason: "illegal" }),
      /illegal cycle transition/
    );

    const autoPublishScript = await fs.promises.readFile(
      path.join(workspaceRoot, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1"),
      "utf8"
    );
    assert.equal(autoPublishScript.includes("test-inventory-runner-v1.mjs"), false);
    console.log("Smokingpipes V2 pipeline E2E passed");
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
