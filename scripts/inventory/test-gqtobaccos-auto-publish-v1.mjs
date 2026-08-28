import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const wrapper = await fs.readFile(
  path.join(root, "scripts", "inventory", "run-gqtobaccos-auto-publish.ps1"),
  "utf8"
);

assert.match(wrapper, /\[int\[\]\]\$AllowedExitCodes = @\(0\)/);
assert.match(wrapper, /\$previousErrorActionPreference = \$ErrorActionPreference/);
assert.match(wrapper, /\$ErrorActionPreference = "Continue"/);
assert.match(wrapper, /\$exitCode = \$LASTEXITCODE/);
assert.match(wrapper, /finally \{\s+\$ErrorActionPreference = \$previousErrorActionPreference/);
assert.match(wrapper, /\$exitCode -notin \$AllowedExitCodes/);
assert.match(wrapper, /gitExitCode=\$exitCode; stderr-tail=/);
assert.match(wrapper, /\$PublicationPaths = @\(/);
assert.doesNotMatch(wrapper, /round5-public-index/);
assert.match(wrapper, /function Get-GqPublicationDirtyPaths/);
assert.match(wrapper, /function Restore-GqPublicationPaths/);
assert.match(wrapper, /"restore", "--staged", "--worktree", "--"/);
assert.match(wrapper, /remainingDirtyCount=/);
assert.match(wrapper, /Cleanup\\uff1a\\u6210\\u529f/);
assert.match(wrapper, /Cleanup\\uff1a\\u5931\\u8d25/);
assert.match(wrapper, /\$cleanupStatus = "success"/);
assert.match(wrapper, /\$cleanupStatus = "failure"/);
assert.match(wrapper, /\$publicationStage = "add"/);
assert.match(wrapper, /Send-GqFailurePushDeer -FailureType "git-publication" -Stage \$publicationStage/);
assert.match(wrapper, /\$publicationStage = "commit"/);
assert.match(wrapper, /-Stage "push"/);
assert.match(wrapper, /\\u9636\\u6bb5\\uff1apush/);
assert.match(wrapper, /\\u672c\\u5730 Commit\\uff1a\\u5df2\\u521b\\u5efa/);
assert.match(wrapper, /\\u672c\\u8f6e\\u672c\\u5730 publication \\u4fee\\u6539\\u5df2\\u6062\\u590d/);

assert.match(wrapper, /function Invoke-GitFetchWithRetry/);
assert.match(wrapper, /for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)/);
assert.match(wrapper, /\$delaySeconds = if \(\$attempt -eq 1\) \{ 10 \} else \{ 30 \}/);
assert.match(wrapper, /Start-Sleep -Seconds \$delaySeconds/);
assert.match(wrapper, /Invoke-GitFetchWithRetry/);
assert.match(wrapper, /function Invoke-GitPushWithRetry/);
assert.match(wrapper, /git push origin HEAD failed \(attempt \$attempt\/3\)/);
assert.match(wrapper, /Invoke-GitPushWithRetry/);
assert.match(wrapper, /function Get-GqRetainedPublicationCommit/);
assert.match(wrapper, /"rev-list", "--count", "origin\/main\.\.HEAD"/);
assert.match(wrapper, /chore\(inventory\): publish GQ Tobaccos daily update/);
assert.match(wrapper, /"diff-tree", "--no-commit-id", "--name-only", "-r", \$commit/);
assert.match(wrapper, /"reset", "--hard", "origin\/main"/);
assert.match(wrapper, /retained-commit-push-required/);
assert.match(wrapper, /retained-commit-discarded/);

assert.match(wrapper, /function Send-GqFailurePushDeer/);
assert.match(wrapper, /\\u70df\\u6597\\u6d3e\\u5e93\\u5b58\\u65e5\\u62a5\\uff5cGQ Tobaccos \\u274c/);
assert.match(wrapper, /\\u72b6\\u6001\\uff1a\\u542f\\u52a8\\u5931\\u8d25/);
assert.match(wrapper, /Production\\uff1a\\u672a\\u4fee\\u6539/);
assert.match(wrapper, /const \{ sendPushDeerNotification \} = await import\("NOTIFIER_MODULE_URL"\)/);
assert.match(wrapper, /\$notifierLauncher = 'await import\(`/);
assert.match(wrapper, /& \$notificationNode\.Source "--input-type=module" "-e" \$notifierLauncher \$notifierScriptBase64 \$payloadBase64/);

assert.match(wrapper, /Assert-TrackedRuntimeClean/);
assert.match(wrapper, /GQ scheduled runtime must run from the formal main worktree/);
assert.match(wrapper, /merge-base --is-ancestor HEAD origin\/main/);
assert.match(wrapper, /"merge", "--ff-only", "origin\/main"/);
assert.match(wrapper, /if \(\$PreflightOnly\) \{/);
assert.match(wrapper, /runner was not started/);
assert.doesNotMatch(wrapper, /gqtobaccos\.com/);

const publicationPaths = [
  "data/products/gqtobaccos-products.json",
  "data/products/unified-products-staging.json",
  "data/generated/public-products/fixture.json",
];

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

async function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

async function createFixture() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gq-auto-publish-fixture-"));
  const seedRoot = path.join(temporaryRoot, "seed");
  const originRoot = path.join(temporaryRoot, "origin.git");
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  await fs.mkdir(path.join(seedRoot, "scripts", "inventory"), { recursive: true });
  await fs.copyFile(
    path.join(root, "scripts", "inventory", "run-gqtobaccos-auto-publish.ps1"),
    path.join(seedRoot, "scripts", "inventory", "run-gqtobaccos-auto-publish.ps1")
  );
  const fixtureNotifier = path.join(seedRoot, "scripts", "inventory", "inventory-pushdeer-notifier-v1.mjs");
  await fs.writeFile(
    fixtureNotifier,
    'import fs from "node:fs/promises";\nexport async function sendPushDeerNotification(message) {\n  await fs.writeFile(process.env.GQ_FIXTURE_NOTIFIER_MARKER, JSON.stringify(message));\n  return { notificationSent: true, notificationSkipped: false, notificationReason: "fixture" };\n}\n',
    "utf8"
  );
  await writeFile(
    seedRoot,
    "scripts/inventory/run-gqtobaccos-daily-v1.mjs",
    'import fs from "node:fs";\nfs.writeFileSync(process.env.GQ_FIXTURE_MUTATION_PATH, "fixture mutation");\nfs.writeFileSync(process.env.GQ_FIXTURE_RUNNER_MARKER, "started");\n'
  );
  for (const relativePath of publicationPaths) {
    await writeFile(seedRoot, relativePath, "baseline\n");
  }

  execFileSync("git", ["init", "-b", "main", seedRoot], { stdio: "ignore" });
  git(seedRoot, ["config", "user.email", "fixture@example.test"]);
  git(seedRoot, ["config", "user.name", "Fixture"]);
  git(seedRoot, ["add", "--", "."]);
  git(seedRoot, ["commit", "-m", "fixture baseline"]);
  execFileSync("git", ["init", "--bare", "--initial-branch=main", originRoot], { stdio: "ignore" });
  git(seedRoot, ["remote", "add", "origin", originRoot]);
  git(seedRoot, ["push", "-u", "origin", "main"]);
  execFileSync("git", ["clone", originRoot, runtimeRoot], { stdio: "ignore" });

  return { temporaryRoot, originRoot, runtimeRoot };
}

function runWrapper({ runtimeRoot, pathPrefix = "" }) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(runtimeRoot, "scripts", "inventory", "run-gqtobaccos-auto-publish.ps1"),
      "-ApplyProduction",
    ],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathPrefix ? `${pathPrefix};${process.env.PATH}` : process.env.PATH,
        GQ_FIXTURE_MUTATION_PATH: path.join(runtimeRoot, publicationPaths[0]),
        GQ_FIXTURE_NOTIFIER_MARKER: path.join(runtimeRoot, ".gq-notifier-called"),
        GQ_FIXTURE_RUNNER_MARKER: path.join(runtimeRoot, ".gq-runner-started"),
        GQ_FIXTURE_PUSH_COUNTER: path.join(runtimeRoot, ".gq-push-attempts"),
        PUSHDEER_KEY: "",
        PUSHDEER_PUSHKEY: "",
        YAN_DOUBUY_PUSHDEER_PUSHKEY: "",
      },
    }
  );
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writePushRetryHook(runtimeRoot, failuresBeforeSuccess) {
  const hooksRoot = path.join(runtimeRoot, ".githooks");
  await fs.mkdir(hooksRoot, { recursive: true });
  await writeFile(
    runtimeRoot,
    ".githooks/pre-push",
    `#!/bin/sh\ncount=0\nif [ -f "$GQ_FIXTURE_PUSH_COUNTER" ]; then count=$(cat "$GQ_FIXTURE_PUSH_COUNTER"); fi\ncount=$((count + 1))\nprintf '%s' "$count" > "$GQ_FIXTURE_PUSH_COUNTER"\nif [ "$count" -le ${failuresBeforeSuccess} ]; then\n  echo fixture push failure >&2\n  exit 19\nfi\n`
  );
  await fs.chmod(path.join(hooksRoot, "pre-push"), 0o755);
  git(runtimeRoot, ["config", "core.hooksPath", ".githooks"]);
}

async function createRetainedPublicationCommit(fixture) {
  const parent = git(fixture.runtimeRoot, ["rev-parse", "HEAD"]);
  await writeFile(fixture.runtimeRoot, publicationPaths[0], "retained publication mutation\n");
  git(fixture.runtimeRoot, ["add", "--", ...publicationPaths]);
  git(fixture.runtimeRoot, ["commit", "-m", "chore(inventory): publish GQ Tobaccos daily update"]);
  return { parent, commit: git(fixture.runtimeRoot, ["rev-parse", "HEAD"]) };
}

async function advanceOrigin(fixture) {
  const advanceRoot = path.join(fixture.temporaryRoot, "origin-advance");
  execFileSync("git", ["clone", fixture.originRoot, advanceRoot], { stdio: "ignore" });
  git(advanceRoot, ["config", "user.email", "fixture@example.test"]);
  git(advanceRoot, ["config", "user.name", "Fixture"]);
  await writeFile(advanceRoot, "README.md", "unrelated remote advance\n");
  git(advanceRoot, ["add", "--", "README.md"]);
  git(advanceRoot, ["commit", "-m", "fixture remote advance"]);
  git(advanceRoot, ["push", "origin", "main"]);
  return git(advanceRoot, ["rev-parse", "HEAD"]);
}

const fixture = await createFixture();
try {
  const hooksRoot = path.join(fixture.runtimeRoot, ".githooks");
  await fs.mkdir(hooksRoot, { recursive: true });
  await writeFile(fixture.runtimeRoot, ".githooks/pre-commit", "#!/bin/sh\necho fixture commit failure >&2\nexit 17\n");
  await fs.chmod(path.join(hooksRoot, "pre-commit"), 0o755);
  git(fixture.runtimeRoot, ["config", "core.hooksPath", ".githooks"]);
  const baselineHead = git(fixture.runtimeRoot, ["rev-parse", "HEAD"]);

  const commitFailure = runWrapper(fixture);
  const commitOutput = `${commitFailure.stdout}\n${commitFailure.stderr}`;
  assert.equal(commitFailure.status, 1, commitOutput);
  assert.match(commitOutput, /gitExitCode=\d+/);
  const commitNotification = JSON.parse(await fs.readFile(path.join(fixture.runtimeRoot, ".gq-notifier-called"), "utf8"));
  assert.match(commitNotification.body, /Cleanup：成功/);
  assert.match(commitNotification.body, /gitExitCode=\d+/);
  assert.match(commitNotification.body, /fixture commit failure/);
  assert.equal(git(fixture.runtimeRoot, ["rev-parse", "HEAD"]), baselineHead);
  assert.equal(git(fixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), "");
  assert.equal(git(fixture.runtimeRoot, ["diff", "--cached", "--name-only"]), "");

  await fs.rm(path.join(hooksRoot, "pre-commit"));
  const pushCounter = path.join(fixture.runtimeRoot, ".gq-push-attempts");
  await writePushRetryHook(fixture.runtimeRoot, 3);
  await fs.rm(path.join(fixture.runtimeRoot, ".gq-notifier-called"));

  const pushFailure = runWrapper(fixture);
  const pushOutput = `${pushFailure.stdout}\n${pushFailure.stderr}`;
  assert.equal(pushFailure.status, 1, pushOutput);
  assert.match(pushOutput, /gitExitCode=\d+/);
  assert.equal(await fs.readFile(pushCounter, "utf8"), "3");
  const pushNotification = JSON.parse(await fs.readFile(path.join(fixture.runtimeRoot, ".gq-notifier-called"), "utf8"));
  assert.match(pushNotification.body, /阶段：push/);
  assert.notEqual(git(fixture.runtimeRoot, ["rev-parse", "HEAD"]), baselineHead);
  assert.equal(git(fixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), "");
  assert.equal(git(fixture.runtimeRoot, ["rev-parse", "origin/main"]), baselineHead);
} finally {
  await fs.rm(fixture.temporaryRoot, { recursive: true, force: true });
}

const pushRetrySuccessFixture = await createFixture();
try {
  const pushCounter = path.join(pushRetrySuccessFixture.runtimeRoot, ".gq-push-attempts");
  await writePushRetryHook(pushRetrySuccessFixture.runtimeRoot, 2);

  const pushRetrySuccess = runWrapper(pushRetrySuccessFixture);
  const pushRetrySuccessOutput = `${pushRetrySuccess.stdout}\n${pushRetrySuccess.stderr}`;
  assert.equal(pushRetrySuccess.status, 0, pushRetrySuccessOutput);
  assert.equal(await fs.readFile(pushCounter, "utf8"), "3");
  assert.equal(git(pushRetrySuccessFixture.runtimeRoot, ["rev-parse", "HEAD"]), git(pushRetrySuccessFixture.runtimeRoot, ["rev-parse", "origin/main"]));
  assert.equal(await fileExists(path.join(pushRetrySuccessFixture.runtimeRoot, ".gq-runner-started")), true);
} finally {
  await fs.rm(pushRetrySuccessFixture.temporaryRoot, { recursive: true, force: true });
}

const retainedParentFixture = await createFixture();
try {
  const retained = await createRetainedPublicationCommit(retainedParentFixture);
  const retainedPush = runWrapper(retainedParentFixture);
  const retainedPushOutput = `${retainedPush.stdout}\n${retainedPush.stderr}`;
  assert.equal(retainedPush.status, 0, retainedPushOutput);
  assert.match(retainedPushOutput, /retained publication commit pushed; runner was not started/);
  assert.equal(git(retainedParentFixture.runtimeRoot, ["rev-parse", "HEAD"]), retained.commit);
  assert.equal(git(retainedParentFixture.runtimeRoot, ["rev-parse", "origin/main"]), retained.commit);
  assert.equal(await fileExists(path.join(retainedParentFixture.runtimeRoot, ".gq-runner-started")), false);
  assert.equal(git(retainedParentFixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), "");
} finally {
  await fs.rm(retainedParentFixture.temporaryRoot, { recursive: true, force: true });
}

const retainedAdvancedFixture = await createFixture();
try {
  const retained = await createRetainedPublicationCommit(retainedAdvancedFixture);
  await advanceOrigin(retainedAdvancedFixture);

  const retainedAdvanced = runWrapper(retainedAdvancedFixture);
  const retainedAdvancedOutput = `${retainedAdvanced.stdout}\n${retainedAdvanced.stderr}`;
  assert.equal(retainedAdvanced.status, 0, retainedAdvancedOutput);
  assert.notEqual(git(retainedAdvancedFixture.runtimeRoot, ["rev-parse", "HEAD"]), retained.commit);
  assert.equal(git(retainedAdvancedFixture.runtimeRoot, ["rev-parse", "HEAD"]), git(retainedAdvancedFixture.runtimeRoot, ["rev-parse", "origin/main"]));
  assert.equal(await fileExists(path.join(retainedAdvancedFixture.runtimeRoot, ".gq-runner-started")), true);
  assert.equal(git(retainedAdvancedFixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), "");
} finally {
  await fs.rm(retainedAdvancedFixture.temporaryRoot, { recursive: true, force: true });
}

const nonPublicationFixture = await createFixture();
try {
  const baselineHead = git(nonPublicationFixture.runtimeRoot, ["rev-parse", "HEAD"]);
  await writeFile(nonPublicationFixture.runtimeRoot, "README.md", "non-publication local change\n");
  git(nonPublicationFixture.runtimeRoot, ["add", "--", "README.md"]);
  git(nonPublicationFixture.runtimeRoot, ["commit", "-m", "chore(inventory): publish GQ Tobaccos daily update"]);
  const nonPublicationHead = git(nonPublicationFixture.runtimeRoot, ["rev-parse", "HEAD"]);

  const nonPublication = runWrapper(nonPublicationFixture);
  const nonPublicationOutput = `${nonPublication.stdout}\n${nonPublication.stderr}`;
  assert.equal(nonPublication.status, 1, nonPublicationOutput);
  assert.equal(git(nonPublicationFixture.runtimeRoot, ["rev-parse", "HEAD"]), nonPublicationHead);
  assert.notEqual(nonPublicationHead, baselineHead);
  assert.equal(git(nonPublicationFixture.runtimeRoot, ["rev-parse", "origin/main"]), baselineHead);
  assert.equal(await fileExists(path.join(nonPublicationFixture.runtimeRoot, ".gq-runner-started")), false);
  const nonPublicationNotification = JSON.parse(await fs.readFile(path.join(nonPublicationFixture.runtimeRoot, ".gq-notifier-called"), "utf8"));
  assert.match(nonPublicationNotification.body, /状态：启动失败/);
} finally {
  await fs.rm(nonPublicationFixture.temporaryRoot, { recursive: true, force: true });
}

const cleanupFailureFixture = await createFixture();
try {
  const hooksRoot = path.join(cleanupFailureFixture.runtimeRoot, ".githooks");
  const gitShimRoot = path.join(cleanupFailureFixture.temporaryRoot, "git-shim");
  await fs.mkdir(hooksRoot, { recursive: true });
  await fs.mkdir(gitShimRoot, { recursive: true });
  await writeFile(cleanupFailureFixture.runtimeRoot, ".githooks/pre-commit", "#!/bin/sh\necho fixture commit failure >&2\nexit 17\n");
  await fs.chmod(path.join(hooksRoot, "pre-commit"), 0o755);
  git(cleanupFailureFixture.runtimeRoot, ["config", "core.hooksPath", ".githooks"]);
  const realGit = execFileSync("where.exe", ["git"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  await fs.writeFile(
    path.join(gitShimRoot, "git.cmd"),
    `@echo off\r\nif /I "%3"=="restore" (\r\n  echo fixture cleanup failure 1>&2\r\n  exit /b 23\r\n)\r\n"${realGit}" %*\r\n`,
    "utf8"
  );

  const cleanupFailure = runWrapper({ runtimeRoot: cleanupFailureFixture.runtimeRoot, pathPrefix: gitShimRoot });
  const cleanupOutput = `${cleanupFailure.stdout}\n${cleanupFailure.stderr}`;
  assert.equal(cleanupFailure.status, 1, cleanupOutput);
  const cleanupNotification = JSON.parse(await fs.readFile(path.join(cleanupFailureFixture.runtimeRoot, ".gq-notifier-called"), "utf8"));
  assert.match(cleanupNotification.body, /Cleanup：失败/);
  assert.match(cleanupNotification.body, /剩余 Dirty：1/);
  assert.match(cleanupNotification.body, /gitExitCode=23/);
  assert.match(cleanupNotification.body, /fixture commit failure/);
  assert.match(git(cleanupFailureFixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), /^M  data\/products\/gqtobaccos-products\.json$/);
} finally {
  await fs.rm(cleanupFailureFixture.temporaryRoot, { recursive: true, force: true });
}

console.log("GQ Tobaccos auto-publish wrapper policy tests passed.");
