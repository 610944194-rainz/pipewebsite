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
  hashFile,
  hashText,
  loadOrCreateCycle,
  readCycle,
  readJson,
  releaseOwnerTokenLock,
  resolveActiveSmokingpipesCycle,
  transitionCycle,
  writeCycle,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  runSmokingpipesCollectOnlyV2,
  collectionSummary,
  SMOKINGPIPES_V2_DETAIL_PACING,
  SMOKINGPIPES_V2_LIST_MAX_PAGES,
  trustedListReason,
} from "./smokingpipes-collect-only-v2.mjs";
import {
  runSmokingpipesProgressiveMode,
} from "./smokingpipes-progressive-runner-v1.mjs";
import {
  buildSmokingpipesReleaseBundleV2,
  GIT_JSON_MAX_BUFFER_BYTES,
  readJsonAtGitRef,
} from "./smokingpipes-build-release-bundle-v2.mjs";
import {
  validateSmokingpipesReleaseBundleV2,
} from "./validate-smokingpipes-release-bundle-v2.mjs";
import {
  runSmokingpipesAutoPublishV2,
  parseSmokingpipesPublisherResult,
  buildSmokingpipesV2Notification,
  smokingpipesV2ExitCode,
} from "./smokingpipes-auto-publish-v2.mjs";
import {
  markSmokingpipesReleaseState,
} from "./smokingpipes-release-state-v2.mjs";
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

function runPublisher(arguments_, { env = {}, cwd = workspaceRoot } = {}) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(workspaceRoot, "scripts", "inventory", "publish-smokingpipes-release-bundle-v2.ps1"),
    ...arguments_,
  ], { encoding: "utf8", windowsHide: true, cwd, env: { ...process.env, ...env } });
}

function lastJson(stdout) {
  return parseSmokingpipesPublisherResult(`ordinary log\n${stdout}`);
}

function trustedSnapshot(products, { summary = {}, pages = null, config = null } = {}) {
  const anchoredProducts = products.some((product) => product.sourceProductId === "109736")
    ? products
    : [trustedExistingListItem(), ...products];
  return {
    version: "smokingpipes-current-list-dry-run-v1",
    source: "smokingpipes",
    ...(pages ? { pages } : {}),
    ...(config ? { config } : {}),
    products: anchoredProducts,
    summary: {
      expectedPages: 2,
      effectiveScannedPages: 2,
      detectedTotalPages: 2,
      detectionConfidence: "high",
      fullExpectedRangeScanned: true,
      failedPages: [],
      captchaDetected: false,
      verificationDetected: false,
      ...summary,
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

function trustedExistingListItem() {
  return {
    source: "smokingpipes",
    sourceProductId: "109736",
    sourceUrl: "https://www.smokingpipes.com/pipes/new/Missourimeerschaum/moreinfo.cfm?product_id=109736",
    title: "Missouri Pride Straight (6mm) Tobacco Pipe",
    rawTitle: "Missouri Pride Straight (6mm) Tobacco Pipe",
    brand: "Missouri Meerschaum",
    price: "$8.63",
    image: "https://c647068.ssl.cf2.rackcdn.com/products/002-543-0001.jpg",
    mainImage: "https://c647068.ssl.cf2.rackcdn.com/products/002-543-0001.jpg",
    listPage: 1,
    listPosition: 1,
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
    const template = structuredClone(
      (await readWorkspaceJson("data/products/smokingpipes-products.json"))[0]
    );
    template.inventoryStatus = "available";
    await writeJsonAtomic(
      path.join(runtimeRoot, "data", "products", "smokingpipes-products.json"),
      [
        template,
        ...Array.from({ length: 500 }, (_, index) => ({
          ...structuredClone(template),
          id: `smokingpipes-sold-${index}`,
          sourceProductId: `sold-${index}`,
          sourceUrl: `https://example.test/sold-${index}`,
          inventoryStatus: "sold",
        })),
      ]
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
    const largeGitRoot = path.join(temporaryRoot, "large-git-json");
    await fs.promises.mkdir(largeGitRoot, { recursive: true });
    await writeText(largeGitRoot, "large.json", JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024) }));
    git(temporaryRoot, ["init", "--initial-branch=main", largeGitRoot]);
    git(largeGitRoot, ["config", "user.email", "fixture@example.invalid"]);
    git(largeGitRoot, ["config", "user.name", "Fixture"]);
    git(largeGitRoot, ["add", "--", "large.json"]);
    git(largeGitRoot, ["commit", "-m", "large JSON fixture"]);
    const largeJson = readJsonAtGitRef({ runtimeRoot: largeGitRoot, ref: "HEAD", relativePath: "large.json" });
    assert.equal(largeJson.payload.length, 2 * 1024 * 1024);
    assert.ok(GIT_JSON_MAX_BUFFER_BYTES > 2 * 1024 * 1024);
    let preflightDetailCalled = false;
    const preflight = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-04",
      skipSync: true,
      preflightOnly: true,
      processDetail: async () => {
        preflightDetailCalled = true;
        throw new Error("preflight must not process details");
      },
    });
    assert.equal(preflight.status, "preflight-passed");
    assert.equal(preflight.networkAccessed, false);
    assert.equal(preflightDetailCalled, false);

    const bundleFailureId = "2030-01-05";
    const bundleFailureCycle = createCycle({ cycleId: bundleFailureId });
    bundleFailureCycle.phase = "ready-to-bundle";
    bundleFailureCycle.collection = {
      ...bundleFailureCycle.collection,
      observedCandidateCount: 1,
      completedDetailIds: ["900000"],
      pendingDetailIds: [],
    };
    bundleFailureCycle.history.push({ at: bundleFailureCycle.updatedAt, phase: bundleFailureCycle.phase, reason: "fixture-ready" });
    await writeCycle(stateRoot, bundleFailureCycle);
    const bundleFailure = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: bundleFailureId,
      skipSync: true,
      collector: async () => ({ status: "ready-to-bundle", cycle: await readCycle(stateRoot, bundleFailureId), networkAccessed: false }),
      bundleBuilder: async () => { throw new Error("fixture bundle builder failure"); },
    });
    assert.equal(bundleFailure.status, "release-retryable");
    assert.equal(bundleFailure.failureStage, "bundle-build");
    assert.equal(bundleFailure.networkAccessed, false);
    assert.equal(bundleFailure.publishedCount, 0);
    assert.equal(smokingpipesV2ExitCode(bundleFailure.status), 1);
    const retainedBundleFailureCycle = await readCycle(stateRoot, bundleFailureId);
    assert.equal(retainedBundleFailureCycle.phase, "release-retryable");
    assert.equal(retainedBundleFailureCycle.failure.stage, "bundle-build");
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

    const detailStatistics = collectionSummary({
      candidates: [
        { sourceProductId: "new-complete", changeTypes: ["new-product"], detailStatus: "complete" },
        { sourceProductId: "new-pending", changeTypes: ["new-product"], detailStatus: "pending" },
        { sourceProductId: "sold-complete", changeTypes: ["explicit-out-of-stock"], detailStatus: "complete" },
        { sourceProductId: "price-complete", changeTypes: ["price-change"], detailStatus: "complete" },
        { sourceProductId: "reappeared-complete", changeTypes: ["reappeared"], detailStatus: "complete" },
      ],
    });
    assert.equal(detailStatistics.completedDetailIds.length, 1);
    assert.equal(detailStatistics.pendingDetailIds.length, 1);
    assert.equal(detailStatistics.completedWithoutDetailCount, 3);

    const incompleteThreePageSnapshot = trustedSnapshot([listItem("incomplete-three")], {
      config: { maxPages: 3, requestedMaxPages: 3 },
      summary: {
        expectedPages: 3,
        pagesScanned: 3,
        effectiveScannedPages: 3,
        detectedTotalPages: null,
        detectionConfidence: "low",
        paginationLinksFound: 0,
        normalEndOfListConfirmed: false,
        normalEndOfListPage: null,
      },
    });
    assert.match(
      trustedListReason(incompleteThreePageSnapshot),
      /no trusted pagination total or normal end-of-list evidence/
    );
    const incompleteThreePath = path.join(temporaryRoot, "incomplete-three.json");
    await writeJsonAtomic(incompleteThreePath, incompleteThreePageSnapshot);
    const incompleteThreeResult = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-06",
      listInputPath: incompleteThreePath,
      processDetail: async () => {
        throw new Error("untrusted list must not process details");
      },
    });
    assert.equal(incompleteThreeResult.status, "collection-retryable");
    assert.equal(incompleteThreeResult.cycle.phase, "collection-retryable");
    assert.equal(fs.existsSync(path.join(stateRoot, "cycles", "2030-01-06", "bundles")), false);

    const detectedPaginationSnapshot = trustedSnapshot([listItem("detected-pagination")], {
      summary: {
        expectedPages: 105,
        effectiveScannedPages: 105,
        detectedTotalPages: 105,
        detectionConfidence: "high",
      },
    });
    assert.equal(trustedListReason(detectedPaginationSnapshot), null);

    const normalEndOfListSnapshot = trustedSnapshot([listItem("normal-end")], {
      pages: Array.from({ length: 104 }, (_, index) => ({ page: index + 1 })),
      summary: {
        expectedPages: 104,
        effectiveScannedPages: 104,
        detectedTotalPages: null,
        detectionConfidence: "low",
        normalEndOfListConfirmed: true,
        normalEndOfListPage: 105,
      },
    });
    assert.equal(trustedListReason(normalEndOfListSnapshot), null);

    const cappedWithoutEndSnapshot = trustedSnapshot([listItem("capped-without-end")], {
      config: { maxPages: 200, requestedMaxPages: 200 },
      summary: {
        expectedPages: 200,
        effectiveScannedPages: 200,
        detectedTotalPages: null,
        detectionConfidence: "low",
        normalEndOfListConfirmed: false,
        normalEndOfListPage: null,
      },
    });
    assert.match(
      trustedListReason(cappedWithoutEndSnapshot),
      /no trusted pagination total or normal end-of-list evidence/
    );
    assert.match(
      trustedListReason(detectedPaginationSnapshot, { fatalWarnings: ["fixture"] }),
      /fatal warnings/
    );
    assert.equal(SMOKINGPIPES_V2_LIST_MAX_PAGES, 200);
    assert.deepEqual(SMOKINGPIPES_V2_DETAIL_PACING, {
      detailWarmupMinMs: 4000,
      detailWarmupMaxMs: 10000,
      detailBatchSize: 20,
      detailBatchCooldownMinMs: 30000,
      detailBatchCooldownMaxMs: 60000,
    });

    let detailPacingPassedToRunner = null;
    const progressiveRunner = async (input) => {
      if (input.options?.mode === "progressive-detail-chunk") {
        detailPacingPassedToRunner = {
          detailWarmupMinMs: input.options.detailWarmupMinMs,
          detailWarmupMaxMs: input.options.detailWarmupMaxMs,
          detailBatchSize: input.options.detailBatchSize,
          detailBatchCooldownMinMs: input.options.detailBatchCooldownMinMs,
          detailBatchCooldownMaxMs: input.options.detailBatchCooldownMaxMs,
        };
      }
      return runSmokingpipesProgressiveMode(input);
    };

    const first = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      listInputPath: listPath,
      detailLimit: 24,
      processDetail: detailProcessor,
      progressiveRunner,
    });
    assert.equal(first.status, "enriching-details", first.error);
    assert.equal(first.cycle.collection.pendingDetailIds.length, 24);
    assert.deepEqual(detailPacingPassedToRunner, SMOKINGPIPES_V2_DETAIL_PACING);
    const second = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(second.status, "ready-to-bundle");
    assert.equal(second.networkAccessed, false);
    assert.equal(second.cycle.collection.completedDetailIds.length, 48, JSON.stringify(second.cycle.collection));
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "900000.json")), true);
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "999999.json")), false);
    const legacyBaselineRoot = path.join(temporaryRoot, "legacy-falcon-baseline");
    const legacyFalcon = {
      ...structuredClone(template),
      id: "smokingpipes-legacy-falcon",
      sourceProductId: "legacy-falcon",
      brand: "Falcon",
      brandName: "Falcon",
    };
    await writeJsonAtomic(
      path.join(legacyBaselineRoot, "data", "products", "smokingpipes-products.json"),
      [legacyFalcon]
    );
    await writeJsonAtomic(
      path.join(legacyBaselineRoot, "data", "products", "danish-products.json"),
      []
    );
    const built = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: "2030-01-01",
      baselineRoot: legacyBaselineRoot,
      baseMainSha: "fixture-base",
      generatorCommitSha: "fixture-generator",
      maxAutoApply: 2000,
    });
    assert.equal(built.status, "bundle-ready");
    const validation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: legacyBaselineRoot,
    });
    assert.equal(validation.valid, true, validation.blockers.join("; "));
    assert.equal(built.manifest.selectedIds.includes("legacy-falcon"), true);
    const outputProducts = await readJson(
      path.join(built.bundleRoot, "outputs", "data", "products", "smokingpipes-products.json")
    );
    const publicManifest = await readJson(
      path.join(built.bundleRoot, "outputs", "data", "generated", "public-products", "manifest.json")
    );
    const stagingPath = path.join(built.bundleRoot, "outputs", "data", "products", "unified-products-staging.json");
    assert.equal(publicManifest.inputHashes.staging.toLowerCase(), (await hashFile(stagingPath)).toLowerCase());
    assert.equal(outputProducts.some((product) => /falcon/i.test(String(product.brand || product.brandName || ""))), false);
    const bundleManifestPath = path.join(built.bundleRoot, "manifest.json");
    const bundleManifest = await readJson(bundleManifestPath);
    publicManifest.inputHashes.staging = publicManifest.inputHashes.staging.toUpperCase();
    await writeJsonAtomic(
      path.join(built.bundleRoot, "outputs", "data", "generated", "public-products", "manifest.json"),
      publicManifest
    );
    bundleManifest.outputFileHashes["data/generated/public-products/manifest.json"] = await hashFile(
      path.join(built.bundleRoot, "outputs", "data", "generated", "public-products", "manifest.json")
    );
    await writeJsonAtomic(bundleManifestPath, bundleManifest);
    const caseInsensitiveValidation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: legacyBaselineRoot,
    });
    assert.equal(caseInsensitiveValidation.valid, true, caseInsensitiveValidation.blockers.join("; "));
    await fs.promises.appendFile(stagingPath, "\n", "utf8");
    const byteChangedValidation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: legacyBaselineRoot,
    });
    assert.equal(byteChangedValidation.valid, false);
    assert.ok(byteChangedValidation.blockers.includes("retained bundle public staging hash mismatch"));

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
    assert.equal(
      git(releaseRoot, ["rev-parse", "HEAD"]),
      git(releaseRoot, ["rev-parse", "origin/main"]),
      `${buildFailure.stdout}\n${buildFailure.stderr}`
    );

    const retainedDetail = await readJson(path.join(stateRoot, "details", "900000.json"));
    const releaseRetry = await readCycle(stateRoot, "2030-01-01");
    assert.equal(releaseRetry.phase, "bundle-ready");
    await transitionCycle({ stateRoot, cycle: releaseRetry, phase: "release-retryable", reason: "fixture-orchestrator-retry" });
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

    const validatorRetryId = "2030-01-06";
    const validatorRetryFixture = await createRetainedBundleFixture({
      cycleId: validatorRetryId,
      count: 1,
      legacyGeneratorCommitSha: "legacy-builder-validator-retry",
    });
    await setLegacyCompactStagingHash(validatorRetryFixture.retained.bundleRoot);
    let rebuiltAfterValidatorFailure = 0;
    const rebuiltValidatorRetry = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: validatorRetryId,
      skipSync: true,
      noPublish: true,
      collector: offlineResumeCollector(validatorRetryId, { collector: 0, details: 0 }),
      bundleBuilder: async (arguments_) => {
        rebuiltAfterValidatorFailure += 1;
        return buildSmokingpipesReleaseBundleV2(arguments_);
      },
    });
    assert.equal(rebuiltAfterValidatorFailure, 1);
    assert.equal(rebuiltValidatorRetry.status, "bundle-ready");

    async function createRetainedBundleFixture({ cycleId, count, legacyGeneratorCommitSha }) {
      const listInputPath = path.join(temporaryRoot, `${cycleId}-list.json`);
      const ids = Array.from({ length: count }, (_, index) => String(930000 + index));
      await writeJsonAtomic(listInputPath, trustedSnapshot(ids.map((id) => listItem(id))));
      const collected = await runSmokingpipesCollectOnlyV2({
        stateRoot,
        runtimeRoot,
        cycleId,
        listInputPath,
        detailLimit: count,
        processDetail: detailProcessor,
      });
      assert.equal(collected.status, "ready-to-bundle");
      assert.equal(collected.networkAccessed, false);
      assert.equal(collected.cycle.collection.completedDetailIds.length, count);
      assert.equal(collected.cycle.collection.pendingDetailIds.length, 0);
      const retained = await buildSmokingpipesReleaseBundleV2({
        stateRoot,
        cycleId,
        runtimeRoot,
        baseMainSha: runtimeBaseSha,
        generatorCommitSha: legacyGeneratorCommitSha,
        maxAutoApply: 2000,
      });
      assert.deepEqual(
        retained.cycle.bundle.changeTypeCounts,
        retained.manifest.changeTypeCounts
      );
      let retryCycle = await readCycle(stateRoot, cycleId);
      retryCycle = await transitionCycle({
        stateRoot,
        cycle: retryCycle,
        phase: "release-retryable",
        reason: "fixture-retained-bundle-retry",
        patch: { failure: { stage: "release-retryable", message: "fixture retained bundle retry" } },
      });
      return { retained, retryCycle };
    }

    async function setLegacyCompactStagingHash(bundleRoot) {
      const publicManifestPath = path.join(
        bundleRoot,
        "outputs",
        "data",
        "generated",
        "public-products",
        "manifest.json"
      );
      const stagingPath = path.join(bundleRoot, "outputs", "data", "products", "unified-products-staging.json");
      const publicManifest = await readJson(publicManifestPath);
      publicManifest.inputHashes.staging = hashText(JSON.stringify(await readJson(stagingPath)));
      await writeJsonAtomic(publicManifestPath, publicManifest);
      const bundleManifestPath = path.join(bundleRoot, "manifest.json");
      const bundleManifest = await readJson(bundleManifestPath);
      bundleManifest.outputFileHashes["data/generated/public-products/manifest.json"] = await hashFile(publicManifestPath);
      await writeJsonAtomic(bundleManifestPath, bundleManifest);
    }

    function offlineResumeCollector(cycleId, counters) {
      return async (arguments_) => {
        counters.collector += 1;
        const resumed = await runSmokingpipesCollectOnlyV2({
          ...arguments_,
          cycleId,
          live: false,
          processDetail: async () => {
            counters.details += 1;
            throw new Error("retained bundle resume must not process details");
          },
        });
        assert.equal(resumed.status, "release-resume-required");
        assert.equal(resumed.networkAccessed, false);
        return resumed;
      };
    }

    // Reproduce the retained 99-detail failure: an old Builder's compact JSON
    // hash is internally inconsistent with the pretty-printed staging file.
    const retainedFaultId = "2030-01-07";
    const retainedFault = await createRetainedBundleFixture({
      cycleId: retainedFaultId,
      count: 99,
      legacyGeneratorCommitSha: "legacy-builder-compact-staging-hash",
    });
    await setLegacyCompactStagingHash(retainedFault.retained.bundleRoot);
    const retainedFaultValidation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: retainedFault.retained.bundleRoot,
      runtimeRoot,
    });
    assert.equal(retainedFaultValidation.valid, false);
    assert.ok(retainedFaultValidation.blockers.includes("retained bundle public staging hash mismatch"));
    const retainedFaultCounters = { collector: 0, details: 0, builder: 0, publisher: 0, notifications: 0 };
    const retainedFaultResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: retainedFaultId,
      skipSync: true,
      live: false,
      notificationsEnabled: true,
      collector: offlineResumeCollector(retainedFaultId, retainedFaultCounters),
      bundleBuilder: async (arguments_) => {
        retainedFaultCounters.builder += 1;
        return buildSmokingpipesReleaseBundleV2(arguments_);
      },
      publisher: async ({ bundleRoot }) => {
        retainedFaultCounters.publisher += 1;
        const rebuiltPublicManifest = await readJson(path.join(
          bundleRoot,
          "outputs",
          "data",
          "generated",
          "public-products",
          "manifest.json"
        ));
        assert.equal(
          rebuiltPublicManifest.inputHashes.staging.toLowerCase(),
          (await hashFile(path.join(bundleRoot, "outputs", "data", "products", "unified-products-staging.json"))).toLowerCase()
        );
        return { status: "published", commitSha: "fixture-retained-rebuilt-published", exitCode: 0 };
      },
      notifier: async () => {
        retainedFaultCounters.notifications += 1;
        return { notificationSent: true, notificationReason: "fixture-sent" };
      },
    });
    assert.equal(retainedFaultResult.status, "published");
    assert.equal(retainedFaultResult.publishedCount, 99);
    assert.equal(retainedFaultResult.networkAccessed, false);
    assert.deepEqual(retainedFaultCounters, { collector: 1, details: 0, builder: 1, publisher: 1, notifications: 1 });
    const retainedFaultCycle = await readCycle(stateRoot, retainedFaultId);
    assert.equal(retainedFaultCycle.phase, "published");
    assert.equal(retainedFaultCycle.collection.completedDetailIds.length, 99);
    assert.equal(retainedFaultCycle.collection.pendingDetailIds.length, 0);
    const retainedFaultLedger = await readJson(path.join(stateRoot, "ledger", "published-bundles.json"));
    assert.equal(retainedFaultLedger.entries.filter((entry) => entry.cycleId === retainedFaultId).length, 1);

    const invalidRebuildId = "2030-01-08";
    const invalidRebuild = await createRetainedBundleFixture({
      cycleId: invalidRebuildId,
      count: 1,
      legacyGeneratorCommitSha: "legacy-builder-invalid-rebuild",
    });
    await setLegacyCompactStagingHash(invalidRebuild.retained.bundleRoot);
    const invalidRebuildCounters = { collector: 0, details: 0, builder: 0, publisher: 0 };
    const invalidRebuildResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: invalidRebuildId,
      skipSync: true,
      live: false,
      collector: offlineResumeCollector(invalidRebuildId, invalidRebuildCounters),
      bundleBuilder: async (arguments_) => {
        invalidRebuildCounters.builder += 1;
        const rebuilt = await buildSmokingpipesReleaseBundleV2(arguments_);
        await setLegacyCompactStagingHash(rebuilt.bundleRoot);
        return rebuilt;
      },
      publisher: async () => {
        invalidRebuildCounters.publisher += 1;
        throw new Error("invalid rebuilt bundle must not reach Publisher");
      },
    });
    assert.equal(invalidRebuildResult.status, "release-retryable");
    assert.equal(invalidRebuildResult.failureStage, "bundle-validator");
    assert.equal(invalidRebuildResult.networkAccessed, false);
    assert.deepEqual(invalidRebuildCounters, { collector: 1, details: 0, builder: 1, publisher: 0 });
    const invalidRebuildCycle = await readCycle(stateRoot, invalidRebuildId);
    assert.equal(invalidRebuildCycle.failure.stage, "bundle-validator");
    assert.equal(
      invalidRebuildCycle.failure.retainedBundleRebuildAttemptedForBundleId,
      invalidRebuildCycle.bundle.bundleId
    );
    const invalidRebuildSecondAttempt = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: invalidRebuildId,
      skipSync: true,
      live: false,
      collector: offlineResumeCollector(invalidRebuildId, invalidRebuildCounters),
      bundleBuilder: async () => {
        invalidRebuildCounters.builder += 1;
        throw new Error("an already rebuilt invalid bundle must not rebuild again");
      },
      publisher: async () => {
        invalidRebuildCounters.publisher += 1;
        throw new Error("an already rebuilt invalid bundle must not reach Publisher");
      },
    });
    assert.equal(invalidRebuildSecondAttempt.status, "release-retryable");
    assert.equal(invalidRebuildSecondAttempt.failureStage, "bundle-validator");
    assert.deepEqual(invalidRebuildCounters, { collector: 2, details: 0, builder: 1, publisher: 0 });

    const differentRetainedBundle = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: invalidRebuildId,
      runtimeRoot,
      baseMainSha: runtimeBaseSha,
      generatorCommitSha: "fixture-different-retained-bundle",
      maxAutoApply: 2000,
    });
    const rebuiltForDifferentBundle = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: invalidRebuildId,
      runtimeRoot,
      baseMainSha: runtimeBaseSha,
      generatorCommitSha: "fixture-different-retained-bundle-rebuild",
      maxAutoApply: 2000,
    });
    assert.notEqual(differentRetainedBundle.bundleId, invalidRebuildCycle.bundle.bundleId);
    await setLegacyCompactStagingHash(differentRetainedBundle.bundleRoot);
    let differentRetainedCycle = await readCycle(stateRoot, invalidRebuildId);
    differentRetainedCycle = await transitionCycle({
      stateRoot,
      cycle: differentRetainedCycle,
      phase: "release-retryable",
      reason: "fixture-different-retained-bundle",
      patch: {
        bundle: {
          bundleId: differentRetainedBundle.bundleId,
          path: path.relative(stateRoot, differentRetainedBundle.bundleRoot).replace(/\\/g, "/"),
          baseMainSha: differentRetainedBundle.manifest.baseMainSha,
          actualAppliedCount: differentRetainedBundle.manifest.actualAppliedCount,
          selectedIds: differentRetainedBundle.manifest.selectedIds,
        },
        failure: {
          stage: "bundle-validator",
          message: "fixture old bundle rebuild marker",
          retainedBundleRebuildAttemptedForBundleId: invalidRebuildCycle.bundle.bundleId,
        },
      },
    });
    assert.equal(
      differentRetainedCycle.failure.retainedBundleRebuildAttemptedForBundleId,
      invalidRebuildCycle.bundle.bundleId
    );
    const differentRetainedCounters = { collector: 0, details: 0, builder: 0 };
    const differentRetainedResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: invalidRebuildId,
      skipSync: true,
      live: false,
      noPublish: true,
      collector: offlineResumeCollector(invalidRebuildId, differentRetainedCounters),
      bundleBuilder: async () => {
        differentRetainedCounters.builder += 1;
        return rebuiltForDifferentBundle;
      },
    });
    assert.equal(differentRetainedResult.status, "bundle-ready");
    assert.deepEqual(differentRetainedCounters, { collector: 1, details: 0, builder: 1 });

    const validRetainedId = "2030-01-09";
    const validRetained = await createRetainedBundleFixture({
      cycleId: validRetainedId,
      count: 1,
      legacyGeneratorCommitSha: "legacy-builder-valid-retained",
    });
    const validRetainedCounters = { collector: 0, details: 0, builder: 0, publisher: 0 };
    const validRetainedResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: validRetainedId,
      skipSync: true,
      live: false,
      collector: offlineResumeCollector(validRetainedId, validRetainedCounters),
      bundleBuilder: async () => {
        validRetainedCounters.builder += 1;
        throw new Error("valid retained bundle must not rebuild");
      },
      publisher: async ({ bundleRoot }) => {
        validRetainedCounters.publisher += 1;
        assert.equal(bundleRoot, validRetained.retained.bundleRoot);
        return { status: "published", commitSha: "fixture-valid-retained-published", exitCode: 0 };
      },
    });
    assert.equal(validRetainedResult.status, "published");
    assert.deepEqual(validRetainedCounters, { collector: 1, details: 0, builder: 0, publisher: 1 });

    const semanticFailureId = "2030-01-10";
    await createRetainedBundleFixture({
      cycleId: semanticFailureId,
      count: 1,
      legacyGeneratorCommitSha: "legacy-builder-semantic-failure",
    });
    const semanticFailureCounters = { collector: 0, details: 0 };
    const semanticFailureResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: semanticFailureId,
      skipSync: true,
      live: false,
      collector: offlineResumeCollector(semanticFailureId, semanticFailureCounters),
      publisher: async () => ({
        status: "release-retryable",
        failureStage: "public-validator",
        error: "fixture public validation failure",
        exitCode: 1,
      }),
    });
    assert.equal(semanticFailureResult.status, "release-retryable");
    assert.equal((await readCycle(stateRoot, semanticFailureId)).failure.stage, "public-validator");
    assert.deepEqual(semanticFailureCounters, { collector: 1, details: 0 });

    const remoteWriter = path.join(temporaryRoot, "remote-writer");
    execFileSync("git", ["clone", bareOrigin, remoteWriter], { stdio: "ignore" });
    git(remoteWriter, ["config", "user.email", "writer@example.invalid"]);
    git(remoteWriter, ["config", "user.name", "Writer"]);
    await writeText(remoteWriter, "remote-advance.txt", "advance\n");
    git(remoteWriter, ["add", "--", "remote-advance.txt"]);
    git(remoteWriter, ["commit", "-m", "fixture remote advance"]);
    git(remoteWriter, ["push", "origin", "HEAD:main"]);
    const staleBase = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      live: false,
      publisher: async ({ bundleRoot }) => {
        assert.equal(bundleRoot, publishBundle.bundleRoot);
        return { status: "stale-base", remoteMainSha: git(runtimeRoot, ["rev-parse", "origin/main"]), exitCode: 2 };
      },
    });
    assert.equal(staleBase.status, "stale-base");
    assert.equal(staleBase.networkAccessed, false);
    assert.equal((await readCycle(stateRoot, "2030-01-01")).phase, "release-retryable");
    assert.equal((await readCycle(stateRoot, "2030-01-01")).failure.stage, "stale-base");
    assert.equal(fs.existsSync(publishBundle.bundleRoot), true);
    const rebuiltAfterStaleBase = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      live: false,
      publisher: async ({ bundleRoot, cycleId }) => {
        const manifest = await readJson(path.join(bundleRoot, "manifest.json"));
        assert.equal(manifest.baseMainSha, git(runtimeRoot, ["rev-parse", "origin/main"]));
        assert.notEqual(bundleRoot, publishBundle.bundleRoot);
        await markSmokingpipesReleaseState({
          stateRoot,
          cycleId,
          bundleId: manifest.bundleId,
          status: "published",
          commitSha: "fixture-stale-base-published",
        });
        return { status: "published", commitSha: "fixture-stale-base-published", exitCode: 0 };
      },
    });
    assert.equal(rebuiltAfterStaleBase.status, "published");
    assert.equal(rebuiltAfterStaleBase.networkAccessed, false);
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

    // A normal invocation on Aug 1 must resume the incomplete Jul 31 cycle
    // from latest.json and process only its pending details.
    const catchupId = "2026-07-31";
    const catchupListPath = path.join(temporaryRoot, "catchup-list.json");
    await writeJsonAtomic(catchupListPath, trustedSnapshot([listItem("920001"), listItem("920002")]));
    const catchupFirst = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: catchupId,
      listInputPath: catchupListPath,
      detailLimit: 1,
      processDetail: detailProcessor,
    });
    assert.equal(catchupFirst.status, "enriching-details");
    assert.equal(catchupFirst.cycle.collection.pendingDetailIds.length, 1);
    const catchupSecond = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-01T02:00:00.000Z"),
      detailLimit: 1,
      noPublish: true,
      skipSync: true,
      processDetail: detailProcessor,
    });
    assert.equal(catchupSecond.cycleId, catchupId);
    assert.equal(catchupSecond.status, "bundle-ready");
    assert.equal(catchupSecond.networkAccessed, false);
    assert.equal(fs.existsSync(path.join(stateRoot, "cycles", "2026-08-01")), false);
    assert.equal(catchupSecond.cycle.collection.pendingDetailIds.length, 0);

    // Terminal latest cycles start the current date, while manual review never
    // silently advances to another cycle.
    await writeCycle(stateRoot, {
      ...catchupSecond.cycle,
      phase: "published",
      updatedAt: "2026-08-01T02:01:00.000Z",
      history: [...catchupSecond.cycle.history, { at: "2026-08-01T02:01:00.000Z", phase: "published", reason: "fixture-terminal" }],
    });
    const terminalResolution = await resolveActiveSmokingpipesCycle({
      stateRoot,
      now: new Date("2026-08-01T03:00:00.000Z"),
    });
    assert.equal(terminalResolution.cycleId, "2026-08-01");
    const tomorrow = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-01T03:00:00.000Z"),
      listInputPath: catchupListPath,
      detailLimit: 2,
      processDetail: detailProcessor,
    });
    assert.equal(tomorrow.cycle.cycleId, "2026-08-01");

    const manualId = "2026-08-02";
    const manual = createCycle({ cycleId: manualId });
    manual.phase = "manual-review-required";
    manual.history.push({ at: manual.updatedAt, phase: manual.phase, reason: "fixture-manual" });
    await writeCycle(stateRoot, manual);
    const manualResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-03T03:00:00.000Z"),
      skipSync: true,
      preflightOnly: true,
    });
    assert.equal(manualResult.status, "manual-review-required");
    assert.equal(fs.existsSync(path.join(stateRoot, "cycles", "2026-08-03")), false);
    const manualCli = spawnSync(process.execPath, [
      path.join(workspaceRoot, "scripts", "inventory", "smokingpipes-auto-publish-v2.mjs"),
      `--state-root=${stateRoot}`,
      `--runtime-root=${runtimeRoot}`,
      "--preflight-only=true",
      "--skip-sync=true",
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(manualCli.status, 1);
    assert.match(manualCli.stdout, /manual-review-required/);

    const interruptedId = "2026-08-03";
    const { cycle: interruptedNew } = await loadOrCreateCycle({ stateRoot, cycleId: interruptedId });
    let interrupted = await transitionCycle({ stateRoot, cycle: interruptedNew, phase: "collecting-list", reason: "fixture" });
    interrupted = await transitionCycle({ stateRoot, cycle: interrupted, phase: "list-ready", reason: "fixture" });
    interrupted = await transitionCycle({ stateRoot, cycle: interrupted, phase: "ready-to-bundle", reason: "fixture" });
    interrupted = await transitionCycle({
      stateRoot,
      cycle: interrupted,
      phase: "bundle-ready",
      reason: "fixture",
      patch: { bundle: { bundleId: "retained-fixture-bundle", path: "cycles/2026-08-03/bundles/retained-fixture-bundle" } },
    });
    interrupted = await transitionCycle({ stateRoot, cycle: interrupted, phase: "validating-release", reason: "fixture" });
    const recovered = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-04T03:00:00.000Z"),
      skipSync: true,
      preflightOnly: true,
    });
    assert.equal(recovered.status, "preflight-passed");
    assert.equal(recovered.cycle.cycleId, interruptedId);
    assert.equal(recovered.cycle.phase, "release-retryable");
    assert.equal(recovered.cycle.failure.stage, "interrupted-validating-release");
    assert.equal(recovered.networkAccessed, false);

    for (const status of [
      "published", "no-change", "same-day-complete", "enriching-details",
      "ready-to-bundle", "bundle-ready", "preflight-passed", "already-running",
    ]) {
      assert.equal(smokingpipesV2ExitCode(status), 0, status);
    }
    for (const status of [
      "collection-retryable", "release-retryable", "manual-review-required", "stale-base",
      "push-retryable", "publisher-output-invalid", "stale-lock-requires-manual-recovery",
      "bundle-validator-failed", "unknown-status",
    ]) {
      assert.equal(smokingpipesV2ExitCode(status), 1, status);
    }

    const notificationStateRoot = path.join(temporaryRoot, "notification-state");
    const notificationCycle = createCycle({ cycleId: "2026-08-04" });
    notificationCycle.phase = "manual-review-required";
    notificationCycle.collection = {
      ...notificationCycle.collection,
      observedCandidateCount: 211,
      completedDetailIds: ["1"],
      pendingDetailIds: ["3"],
      completedWithoutDetailCount: 3,
      quarantinedDetailIds: ["4"],
    };
    notificationCycle.history.push({ at: notificationCycle.updatedAt, phase: notificationCycle.phase, reason: "fixture-notification" });
    await writeCycle(notificationStateRoot, notificationCycle);
    let notificationCalls = 0;
    const notified = await runSmokingpipesAutoPublishV2({
      stateRoot: notificationStateRoot,
      runtimeRoot,
      skipSync: true,
      notificationsEnabled: true,
      notifier: async () => {
        notificationCalls += 1;
        return { notificationSent: true, notificationReason: "fixture-sent" };
      },
    });
    assert.equal(notified.status, "manual-review-required");
    assert.equal(notificationCalls, 1);
    assert.equal(notified.notificationFailed, false);
    const notificationFailure = await runSmokingpipesAutoPublishV2({
      stateRoot: notificationStateRoot,
      runtimeRoot,
      skipSync: true,
      notificationsEnabled: true,
      notifier: async () => { throw new Error("fixture PushDeer failure"); },
    });
    assert.equal(notificationFailure.status, "manual-review-required");
    assert.equal(notificationFailure.notificationFailed, true);
    assert.match(notificationFailure.notificationReason, /fixture PushDeer failure/);
    const detailMessage = buildSmokingpipesV2Notification({
      status: "enriching-details",
      cycleId: notificationCycle.cycleId,
      cycle: notificationCycle,
      networkAccessed: false,
    }).body;
    assert.match(detailMessage, /实际详情完成: 1/);
    assert.match(detailMessage, /无需抓详情的状态变更: 3/);
    assert.match(detailMessage, /待处理详情: 1/);
    assert.doesNotMatch(detailMessage, /已完成详情/);
    assert.match(detailMessage, /下一窗口/);
    const publishedMessage = buildSmokingpipesV2Notification({
      status: "published",
      cycleId: notificationCycle.cycleId,
      cycle: {
        ...notificationCycle,
        bundle: {
          changeTypeCounts: {
            "new-product": 120,
            "price-change": 10,
            "explicit-out-of-stock": 649,
            reappeared: 57,
          },
        },
      },
      changeTypeCounts: {},
    }).body;
    assert.match(publishedMessage, /新增: 120/);
    assert.match(publishedMessage, /改价: 10/);
    assert.match(publishedMessage, /下架: 649/);
    assert.match(publishedMessage, /恢复库存: 57/);
    assert.doesNotMatch(publishedMessage, /变更类型: \{\}/);

    // Publisher E2E: a bundle can own many output files while only the files
    // whose content changed are staged. Hashes are verified on both sides of
    // the copy, empty staged diffs block, and injected unexpected staging is
    // rejected and cleaned from the temporary release clone.
    const subsetRoot = path.join(temporaryRoot, "publisher-subset");
    const subsetSource = path.join(subsetRoot, "source");
    const subsetBare = path.join(subsetRoot, "origin.git");
    const subsetRelease = path.join(subsetRoot, "release");
    const subsetBundleRoot = path.join(subsetRoot, "bundle");
    const fakeRuntimeRoot = path.join(subsetRoot, "runtime");
    const subsetStateRoot = path.join(subsetRoot, "state");
    const ownedFiles = [
      "data/products/smokingpipes-products.json",
      "data/products/unified-products-staging.json",
      "data/generated/public-products/catalog.json",
      "data/generated/public-products/filters.json",
      "data/generated/public-products/brands.json",
      "data/generated/public-products/detail-lookup.json",
      "data/generated/public-products/recent-new.json",
      "data/generated/public-products/manifest.json",
    ];
    const baselineOutputs = Object.fromEntries(ownedFiles.map((file) => [file, { file, version: "baseline" }]));
    for (const [file, value] of Object.entries(baselineOutputs)) {
      await writeJsonAtomic(path.join(subsetSource, file), value);
    }
    await writeText(subsetSource, "scripts/validate-public-product-indexes-v1.mjs", [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { execFileSync } from "node:child_process";',
      'if (process.env.SMOKINGPIPES_TEST_STAGE_UNEXPECTED === "1") {',
      '  const root = process.env.SMOKINGPIPES_TEST_RELEASE_ROOT;',
      '  fs.writeFileSync(path.join(root, "unexpected.txt"), "unexpected\\n");',
      '  execFileSync("git", ["-C", root, "add", "--", "unexpected.txt"]);',
      '}',
    ].join("\n"));
    await writeText(subsetSource, "scripts/test-public-products-inventory-default-v1.mjs", "process.exit(0);\n");
    await writeText(subsetSource, "package.json", JSON.stringify({ private: true, type: "module", scripts: { build: "node -e \"process.exit(0)\"" } }));
    git(temporaryRoot, ["init", "--initial-branch=main", subsetSource]);
    git(subsetSource, ["config", "user.email", "fixture@example.invalid"]);
    git(subsetSource, ["config", "user.name", "Fixture"]);
    git(subsetSource, ["add", "--", "."]);
    git(subsetSource, ["commit", "-m", "subset baseline"]);
    const subsetBaseSha = git(subsetSource, ["rev-parse", "HEAD"]);
    execFileSync("git", ["clone", "--bare", subsetSource, subsetBare], { stdio: "ignore" });
    execFileSync("git", ["clone", subsetBare, subsetRelease], { stdio: "ignore" });
    git(subsetRelease, ["config", "user.email", "fixture@example.invalid"]);
    git(subsetRelease, ["config", "user.name", "Fixture"]);
    await writeText(fakeRuntimeRoot, "scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs", "process.exit(0);\n");

    async function writeFixtureBundle(bundleRoot, outputValues, baseMainSha, bundleId) {
      const outputFileHashes = {};
      for (const [file, value] of Object.entries(outputValues)) {
        const target = path.join(bundleRoot, "outputs", file);
        await writeJsonAtomic(target, value);
        outputFileHashes[file] = await hashFile(target);
      }
      await writeJsonAtomic(path.join(bundleRoot, "manifest.json"), {
        bundleId,
        baseMainSha,
        actualAppliedCount: 2,
        outputFileHashes,
      });
      return outputFileHashes;
    }

    const changedFiles = ownedFiles.slice(0, 2);
    const subsetOutputs = structuredClone(baselineOutputs);
    for (const file of changedFiles) subsetOutputs[file] = { file, version: "changed" };
    const subsetHashes = await writeFixtureBundle(subsetBundleRoot, subsetOutputs, subsetBaseSha, "subset-bundle");
    const subsetPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-01",
      "-BundleRoot", subsetBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ]);
    assert.equal(subsetPublish.status, 0, `${subsetPublish.stdout}\n${subsetPublish.stderr}`);
    const subsetPayload = lastJson(subsetPublish.stdout);
    assert.equal(subsetPayload.status, "published");
    assert.equal(Array.isArray(subsetPayload.stagedFiles), true, JSON.stringify(subsetPayload));
    assert.deepEqual([...subsetPayload.stagedFiles].sort(), [...changedFiles].sort());
    for (const [file, expectedHash] of Object.entries(subsetHashes)) {
      assert.equal(await hashFile(path.join(subsetRelease, file)), expectedHash, file);
    }
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    const emptyBundleRoot = path.join(subsetRoot, "empty-bundle");
    await writeFixtureBundle(
      emptyBundleRoot,
      subsetOutputs,
      git(subsetRelease, ["rev-parse", "origin/main"]),
      "empty-bundle"
    );
    const emptyPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-02",
      "-BundleRoot", emptyBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ]);
    assert.notEqual(emptyPublish.status, 0);
    assert.match(`${emptyPublish.stdout}\n${emptyPublish.stderr}`, /bundle has no staged product change/);
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    const unexpectedBundleRoot = path.join(subsetRoot, "unexpected-bundle");
    const unexpectedOutputs = structuredClone(subsetOutputs);
    for (const file of changedFiles) unexpectedOutputs[file] = { file, version: "changed-again" };
    await writeFixtureBundle(
      unexpectedBundleRoot,
      unexpectedOutputs,
      git(subsetRelease, ["rev-parse", "origin/main"]),
      "unexpected-bundle"
    );
    const unexpectedPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-03",
      "-BundleRoot", unexpectedBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ], {
      env: {
        SMOKINGPIPES_TEST_STAGE_UNEXPECTED: "1",
        SMOKINGPIPES_TEST_RELEASE_ROOT: subsetRelease,
      },
    });
    assert.notEqual(unexpectedPublish.status, 0);
    assert.match(`${unexpectedPublish.stdout}\n${unexpectedPublish.stderr}`, /staged file whitelist mismatch; unexpected=unexpected.txt/);
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    // The Publisher must run real project gates from ReleaseRoot.  This
    // reproduces the production defect by giving the caller Runtime a broken
    // manifest while the Release clone receives a valid Bundle.
    const releaseCwdRoot = path.join(temporaryRoot, "publisher-release-cwd");
    const releaseCwdSource = path.join(releaseCwdRoot, "source");
    const releaseCwdBare = path.join(releaseCwdRoot, "origin.git");
    const releaseCwdInvalidBare = path.join(releaseCwdRoot, "invalid-origin.git");
    const releaseCwdRelease = path.join(releaseCwdRoot, "release");
    const releaseCwdInvalidRelease = path.join(releaseCwdRoot, "release-invalid");
    const releaseCwdRuntime = path.join(releaseCwdRoot, "runtime-caller");
    const releaseCwdState = path.join(releaseCwdRoot, "state");
    await fs.promises.mkdir(releaseCwdRuntime, { recursive: true });
    await writeJsonAtomic(path.join(releaseCwdRuntime, "data", "products", "unified-products-staging.json"), []);
    await writeJsonAtomic(path.join(releaseCwdRuntime, "data", "generated", "public-products", "manifest.json"), {
      inputHashes: { staging: "runtime-fixture-is-deliberately-invalid" },
    });
    execFileSync("git", ["clone", workspaceRoot, releaseCwdSource], { stdio: "ignore" });
    git(releaseCwdSource, ["checkout", "-B", "main", "origin/main"]);
    git(releaseCwdSource, ["config", "user.email", "fixture@example.invalid"]);
    git(releaseCwdSource, ["config", "user.name", "Fixture"]);
    const releaseCwdBaseSha = git(releaseCwdSource, ["rev-parse", "HEAD"]);
    execFileSync("git", ["clone", "--bare", releaseCwdSource, releaseCwdBare], { stdio: "ignore" });
    execFileSync("git", ["clone", "--bare", releaseCwdSource, releaseCwdInvalidBare], { stdio: "ignore" });
    execFileSync("git", ["clone", releaseCwdBare, releaseCwdRelease], { stdio: "ignore" });
    execFileSync("git", ["clone", releaseCwdInvalidBare, releaseCwdInvalidRelease], { stdio: "ignore" });
    for (const releaseFixture of [releaseCwdRelease, releaseCwdInvalidRelease]) {
      git(releaseFixture, ["checkout", "main"]);
      git(releaseFixture, ["config", "user.email", "fixture@example.invalid"]);
      git(releaseFixture, ["config", "user.name", "Fixture"]);
    }
    // Turbopack rejects a node_modules junction that points outside the
    // project root, so the successful Production-gate fixture installs from
    // the local cache in strict offline mode.
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd ci --offline"], {
      cwd: releaseCwdRelease,
      stdio: "ignore",
      windowsHide: true,
    });
    await fs.promises.symlink(
      path.join(workspaceRoot, "node_modules"),
      path.join(releaseCwdInvalidRelease, "node_modules"),
      "junction"
    );
    const releaseCwdCycleId = "2030-03-01";
    const releaseCwdList = path.join(releaseCwdRoot, "list.json");
    await writeJsonAtomic(releaseCwdList, trustedSnapshot([listItem("940000")]));
    const releaseCwdCollected = await runSmokingpipesCollectOnlyV2({
      stateRoot: releaseCwdState,
      runtimeRoot,
      cycleId: releaseCwdCycleId,
      listInputPath: releaseCwdList,
      detailLimit: 1,
      processDetail: detailProcessor,
    });
    assert.equal(releaseCwdCollected.status, "ready-to-bundle");
    const releaseCwdBundle = await buildSmokingpipesReleaseBundleV2({
      stateRoot: releaseCwdState,
      cycleId: releaseCwdCycleId,
      runtimeRoot: workspaceRoot,
      baseMainSha: releaseCwdBaseSha,
      generatorCommitSha: releaseCwdBaseSha,
      maxAutoApply: 2000,
    });
    const callerCwdBeforePublisher = process.cwd();
    const releaseCwdPublish = runPublisher([
      "-StateRoot", releaseCwdState,
      "-CycleId", releaseCwdCycleId,
      "-BundleRoot", releaseCwdBundle.bundleRoot,
      "-ReleaseRoot", releaseCwdRelease,
      "-RuntimeRoot", workspaceRoot,
    ], { cwd: releaseCwdRuntime });
    assert.equal(releaseCwdPublish.status, 0, `${releaseCwdPublish.stdout}\n${releaseCwdPublish.stderr}`);
    assert.equal(lastJson(releaseCwdPublish.stdout).status, "published");
    assert.equal(process.cwd(), callerCwdBeforePublisher);
    assert.equal(git(releaseCwdRelease, ["status", "--short"]), "");

    const invalidReleaseCwdBundleRoot = path.join(releaseCwdRoot, "invalid-public-validator-bundle");
    await fs.promises.cp(releaseCwdBundle.bundleRoot, invalidReleaseCwdBundleRoot, { recursive: true });
    const invalidCatalogPath = path.join(
      invalidReleaseCwdBundleRoot,
      "outputs",
      "data",
      "generated",
      "public-products",
      "catalog.json"
    );
    const invalidCatalog = await readJson(invalidCatalogPath);
    invalidCatalog.products = [];
    await writeJsonAtomic(invalidCatalogPath, invalidCatalog);
    const invalidBundleManifestPath = path.join(invalidReleaseCwdBundleRoot, "manifest.json");
    const invalidBundleManifest = await readJson(invalidBundleManifestPath);
    invalidBundleManifest.outputFileHashes["data/generated/public-products/catalog.json"] = await hashFile(invalidCatalogPath);
    await writeJsonAtomic(invalidBundleManifestPath, invalidBundleManifest);
    const releaseCwdPublicValidatorFailure = runPublisher([
      "-StateRoot", releaseCwdState,
      "-CycleId", "2030-03-02",
      "-BundleRoot", invalidReleaseCwdBundleRoot,
      "-ReleaseRoot", releaseCwdInvalidRelease,
      "-RuntimeRoot", workspaceRoot,
    ], { cwd: releaseCwdRuntime });
    assert.notEqual(releaseCwdPublicValidatorFailure.status, 0);
    const publicValidatorFailureResult = lastJson(releaseCwdPublicValidatorFailure.stdout);
    assert.equal(
      publicValidatorFailureResult.failureStage,
      "public-validator",
      JSON.stringify(publicValidatorFailureResult)
    );
    assert.equal(git(releaseCwdInvalidRelease, ["status", "--short"]), "");

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
