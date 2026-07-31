import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  syncSmokingpipesRuntimeV2,
} from "./smokingpipes-auto-publish-v2.mjs";

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

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-runtime-sync-v2-"));
  try {
    const source = path.join(temporaryRoot, "source");
    const bare = path.join(temporaryRoot, "origin.git");
    const runtime = path.join(temporaryRoot, "runtime");
    const writer = path.join(temporaryRoot, "writer");
    fs.mkdirSync(source, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", source], { stdio: "ignore" });
    git(source, ["config", "user.email", "fixture@example.invalid"]);
    git(source, ["config", "user.name", "Fixture"]);
    write(source, "README.md", "base\n");
    git(source, ["add", "--", "README.md"]);
    git(source, ["commit", "-m", "base"]);
    execFileSync("git", ["clone", "--bare", source, bare], { stdio: "ignore" });
    clone(runtime, bare);
    git(runtime, ["switch", "-c", "automation/smokingpipes-production-run", "origin/main"]);
    clone(writer, bare);
    git(writer, ["config", "user.email", "writer@example.invalid"]);
    git(writer, ["config", "user.name", "Writer"]);
    write(writer, "remote.txt", "advance\n");
    git(writer, ["add", "--", "remote.txt"]);
    git(writer, ["commit", "-m", "remote advance"]);
    git(writer, ["push", "origin", "HEAD:main"]);

    const synced = syncSmokingpipesRuntimeV2(runtime);
    assert.equal(synced, git(runtime, ["rev-parse", "origin/main"]));
    assert.equal(fs.existsSync(path.join(runtime, "remote.txt")), true);

    write(runtime, "local.txt", "ahead\n");
    git(runtime, ["add", "--", "local.txt"]);
    git(runtime, ["commit", "-m", "local ahead"]);
    assert.throws(
      () => syncSmokingpipesRuntimeV2(runtime),
      /ahead of or diverged from origin\/main/
    );
    console.log("Smokingpipes runtime sync V2 E2E passed");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
