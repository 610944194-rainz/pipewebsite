import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-postapply-e2e-"));
const fixture = path.join(tempRoot, "fixture-worktree");
const bare = path.join(tempRoot, "fixture-origin.git");
const patchPath = path.join(tempRoot, "production.patch");
const npmPath = "C:\\Program Files\\nodejs\\npm.cmd";
const powershellPath = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: options.cwd || root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: options.stdio || "pipe" });
  if (!options.allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function git(cwd, args, options = {}) {
  return run("git", args, { ...options, cwd });
}

function writeJson(relative, value) {
  const target = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  run("git", ["init", "--bare", bare]);
  run("git", ["clone", "--no-local", root, fixture]);
  git(fixture, ["config", "user.email", "e2e@example.invalid"]);
  git(fixture, ["config", "user.name", "Smokingpipes E2E"]);
  git(fixture, ["switch", "-c", "automation/postapply-e2e", "dc8e03d"]);
  for (const commit of ["e819476", "40afff3", "0800f3a", "64efc8b", "3f5b779", "c56c308", "471893e", "2ae8f95", "4777921"]) git(fixture, ["cherry-pick", commit]);
  git(fixture, ["remote", "set-url", "origin", bare]);
  git(fixture, ["push", "origin", "HEAD:main"]);
  git(fixture, ["branch", "--set-upstream-to=origin/main"]);

  const patchFd = fs.openSync(patchPath, "w");
  const diff = spawnSync("git", ["-C", root, "diff", "--binary", "dc8e03d..aa6b346c21d0e897c89e590b57713036f5c98c12", "--", "data/products", "data/generated/public-products"], { stdio: ["ignore", patchFd, "pipe"] });
  fs.closeSync(patchFd);
  assert.equal(diff.status, 0, diff.stderr?.toString());
  git(fixture, ["apply", "--binary", patchPath]);
  assert.equal(git(fixture, ["diff", "--name-only", "--", "data/products", "data/generated/public-products"]).stdout.trim().split(/\r?\n/).filter(Boolean).length, 72);
  git(fixture, ["diff", "--check"]);

  writeJson("data/review/smokingpipes-auto-publish-latest.json", { productionWritten: true, appliedCount: 895, commitPerformed: false, pushPerformed: false });
  writeJson("data/inventory/smokingpipes-daily-task-state.json", { productionWritten: true, appliedCount: 895 });
  writeJson("data/inventory/smokingpipes-progressive-daily-state.json", { candidates: [], fullExpectedRangeScanned: true });

  run(powershellPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& '${npmPath}' --cache '${path.join(os.tmpdir(), "yandoubuy-npm-cache")}' ci; exit $LASTEXITCODE`], { cwd: fixture, stdio: "inherit" });
  const recoveryScript = path.join(fixture, "scripts", "inventory", "resume-smokingpipes-post-apply-v1.ps1");
  const before = git(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  const started = Date.now();
  const first = run(powershellPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", recoveryScript, "-AutomationWorktree", fixture, "-BuildExecutable", npmPath, "-ExpectedAppliedCount", "895", "-FaultInjectFinalReportWriteFailure", "-AllowTestFaultInjection"], { cwd: fixture, allowFailure: true, stdio: "inherit" });
  assert.notEqual(first.status, 0, "fault-injected recovery must report failure after push");
  const after = git(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  const remote = git(fixture, ["rev-parse", "origin/main"]).stdout.trim();
  assert.notEqual(after, before);
  assert.equal(remote, after);
  assert.equal(Number(git(fixture, ["rev-list", "--count", `${before}..${after}`]).stdout.trim()), 1);
  const reportPath = path.join(fixture, "data", "review", "smokingpipes-post-apply-recovery-latest.json");
  const markdownPath = path.join(fixture, "data", "review", "smokingpipes-post-apply-recovery-latest.md");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.status, "push-complete-final-report-failed");
  assert.equal(report.failureStage, "final-report");
  assert.equal(report.commitPerformed, true);
  assert.equal(report.pushPerformed, true);
  assert.ok((report.failureReason || "").length < 32768);
  assert.ok(fs.statSync(reportPath).size < 2 * 1024 * 1024);
  assert.ok(fs.statSync(markdownPath).size < 2 * 1024 * 1024);
  assert.equal(fs.readdirSync(path.dirname(reportPath)).filter((name) => name.endsWith(".tmp")).length, 0);

  const second = run(powershellPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", recoveryScript, "-AutomationWorktree", fixture, "-BuildExecutable", npmPath, "-ExpectedAppliedCount", "895", "-FaultInjectFinalReportWriteFailure", "-AllowTestFaultInjection"], { cwd: fixture, allowFailure: true });
  assert.notEqual(second.status, 0);
  assert.equal(git(fixture, ["rev-parse", "HEAD"]).stdout.trim(), after);
  assert.equal(git(fixture, ["rev-parse", "origin/main"]).stdout.trim(), remote);

  console.log(JSON.stringify({ scenario: "final-report-write-failure", status: "PASS", durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)), stagedFileCount: 72, commitSha: after, remoteSha: remote, jsonBytes: fs.statSync(reportPath).size, markdownBytes: fs.statSync(markdownPath).size, residualProcesses: 0 }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
