import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const runtimeRoot = path.resolve(process.env.SMOKINGPIPES_RUNTIME_ROOT || process.cwd());
const gitDirectory = path.join(runtimeRoot, ".git");
const commonDir = execFileSync("git", ["-C", runtimeRoot, "rev-parse", "--git-common-dir"], {
  encoding: "utf8",
}).trim().replace(/\\/g, "/");

assert.ok(fs.statSync(gitDirectory).isDirectory(), `Runtime .git must be a directory: ${gitDirectory}`);
assert.equal(commonDir, ".git", `Runtime Git common dir must be local .git, got ${commonDir}`);
assert.equal(execFileSync("git", ["-C", runtimeRoot, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
console.log(`Smokingpipes Runtime is an independent clean clone: ${runtimeRoot}`);
