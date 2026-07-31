import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(directory, arguments_) {
  return execFileSync("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function clone(directory, repository) {
  execFileSync("git", ["clone", repository, directory], { stdio: "ignore" });
}

function write(directory, file, content) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function runWrapper({ runtime, stateRoot, releaseRoot }) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(runtime, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1"),
    "-StateRoot", stateRoot,
    "-ReleaseRoot", releaseRoot,
    "-PreflightOnly",
  ], { encoding: "utf8", windowsHide: true, timeout: 60000 });
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-runtime-sync-v2-"));
  try {
    const source = path.join(temporaryRoot, "source");
    const bare = path.join(temporaryRoot, "origin.git");
    const runtime = path.join(temporaryRoot, "runtime");
    const writer = path.join(temporaryRoot, "writer");
    const stateRoot = path.join(temporaryRoot, "state");
    const releaseRoot = path.join(temporaryRoot, "release");
    fs.mkdirSync(source, { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "scripts"), path.join(source, "scripts"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "lib"), path.join(source, "lib"), { recursive: true });
    fs.copyFileSync(path.join(workspaceRoot, "package.json"), path.join(source, "package.json"));
    fs.copyFileSync(path.join(workspaceRoot, ".gitignore"), path.join(source, ".gitignore"));
    write(source, "README.md", "base\n");
    execFileSync("git", ["init", "--initial-branch=main", source], { stdio: "ignore" });
    git(source, ["config", "user.email", "fixture@example.invalid"]);
    git(source, ["config", "user.name", "Fixture"]);
    git(source, ["add", "--", "."]);
    git(source, ["commit", "-m", "base"]);
    execFileSync("git", ["clone", "--bare", source, bare], { stdio: "ignore" });
    clone(runtime, bare);
    git(runtime, ["switch", "-c", "automation/smokingpipes-production-run", "origin/main"]);
    fs.symlinkSync(path.join(workspaceRoot, "node_modules"), path.join(runtime, "node_modules"), "junction");
    clone(writer, bare);
    git(writer, ["config", "user.email", "writer@example.invalid"]);
    git(writer, ["config", "user.name", "Writer"]);

    // Alter the code the wrapper will load. Seeing this changed status proves
    // that the PowerShell sync happened before Node resolved the orchestrator.
    const orchestratorPath = path.join(writer, "scripts", "inventory", "smokingpipes-auto-publish-v2.mjs");
    const original = fs.readFileSync(orchestratorPath, "utf8");
    const updated = original.replace('status: "preflight-passed"', 'status: "same-day-complete"');
    assert.notEqual(updated, original);
    fs.writeFileSync(orchestratorPath, updated, "utf8");
    git(writer, ["add", "--", "scripts/inventory/smokingpipes-auto-publish-v2.mjs"]);
    git(writer, ["commit", "-m", "remote runtime update"]);
    git(writer, ["push", "origin", "HEAD:main"]);

    const result = runWrapper({ runtime, stateRoot, releaseRoot });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /"status":\s*"same-day-complete"/);
    assert.match(result.stdout, new RegExp(`"runtimeSha":\\s*"${git(runtime, ["rev-parse", "origin/main"])}"`));
    assert.equal(git(runtime, ["rev-parse", "HEAD"]), git(runtime, ["rev-parse", "origin/main"]));
    assert.equal(git(runtime, ["status", "--short"]), "");

    write(runtime, "local.txt", "ahead\n");
    git(runtime, ["add", "--", "local.txt"]);
    git(runtime, ["commit", "-m", "local ahead"]);
    const ahead = runWrapper({ runtime, stateRoot, releaseRoot });
    assert.notEqual(ahead.status, 0);
    assert.match(`${ahead.stdout}\n${ahead.stderr}`, /ahead of or diverged from origin\/main/);
    console.log("Smokingpipes runtime sync V2 E2E passed");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
