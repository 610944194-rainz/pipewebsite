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
assert.match(wrapper, /function Restore-GqPublicationPaths/);
assert.match(wrapper, /"restore", "--staged", "--worktree", "--"/);
assert.match(wrapper, /\$publicationStage = "add"/);
assert.match(wrapper, /Send-GqFailurePushDeer -FailureType "git-publication" -Stage \$publicationStage/);
assert.match(wrapper, /\$publicationStage = "commit"/);
assert.match(wrapper, /-Stage "push"/);
assert.match(wrapper, /\\u9636\\u6bb5\\uff1apush/);
assert.match(wrapper, /\\u672c\\u5730 Commit\\uff1a\\u5df2\\u521b\\u5efa/);
assert.match(wrapper, /\\u672c\\u8f6e\\u672c\\u5730\\u4fee\\u6539\\u5df2\\u6062\\u590d/);

assert.match(wrapper, /function Invoke-GitFetchWithRetry/);
assert.match(wrapper, /for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)/);
assert.match(wrapper, /\$delaySeconds = if \(\$attempt -eq 1\) \{ 10 \} else \{ 30 \}/);
assert.match(wrapper, /Start-Sleep -Seconds \$delaySeconds/);
assert.match(wrapper, /Invoke-GitFetchWithRetry/);

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
  "data/review/round5-public-index-build-v1.json",
  "data/review/round5-public-index-build-v1.md",
  "data/review/round5-public-index-field-contract-v1.md",
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
  await fs.copyFile(path.join(root, "scripts", "inventory", "inventory-pushdeer-notifier-v1.mjs"), fixtureNotifier);
  await fs.appendFile(
    fixtureNotifier,
    '\nawait (await import("node:fs/promises")).writeFile(process.env.GQ_FIXTURE_NOTIFIER_MARKER, "called");\n',
    "utf8"
  );
  await writeFile(
    seedRoot,
    "scripts/inventory/run-gqtobaccos-daily-v1.mjs",
    'import fs from "node:fs";\nfs.writeFileSync(process.env.GQ_FIXTURE_MUTATION_PATH, "fixture mutation");\n'
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

function runWrapper({ runtimeRoot }) {
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
        GQ_FIXTURE_MUTATION_PATH: path.join(runtimeRoot, publicationPaths[0]),
        GQ_FIXTURE_NOTIFIER_MARKER: path.join(runtimeRoot, ".gq-notifier-called"),
        PUSHDEER_KEY: "",
        PUSHDEER_PUSHKEY: "",
        YAN_DOUBUY_PUSHDEER_PUSHKEY: "",
      },
    }
  );
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
  assert.equal(await fs.readFile(path.join(fixture.runtimeRoot, ".gq-notifier-called"), "utf8"), "called");
  assert.equal(git(fixture.runtimeRoot, ["rev-parse", "HEAD"]), baselineHead);
  assert.equal(git(fixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), "");
  assert.equal(git(fixture.runtimeRoot, ["diff", "--cached", "--name-only"]), "");

  await fs.rm(path.join(hooksRoot, "pre-commit"));
  await writeFile(fixture.runtimeRoot, ".githooks/pre-push", "#!/bin/sh\necho fixture push failure >&2\nexit 19\n");
  await fs.chmod(path.join(hooksRoot, "pre-push"), 0o755);
  await fs.rm(path.join(fixture.runtimeRoot, ".gq-notifier-called"));

  const pushFailure = runWrapper(fixture);
  const pushOutput = `${pushFailure.stdout}\n${pushFailure.stderr}`;
  assert.equal(pushFailure.status, 1, pushOutput);
  assert.match(pushOutput, /gitExitCode=\d+/);
  assert.equal(await fs.readFile(path.join(fixture.runtimeRoot, ".gq-notifier-called"), "utf8"), "called");
  assert.notEqual(git(fixture.runtimeRoot, ["rev-parse", "HEAD"]), baselineHead);
  assert.equal(git(fixture.runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]), "");
  assert.equal(git(fixture.runtimeRoot, ["rev-parse", "origin/main"]), baselineHead);
} finally {
  await fs.rm(fixture.temporaryRoot, { recursive: true, force: true });
}

console.log("GQ Tobaccos auto-publish wrapper policy tests passed.");
