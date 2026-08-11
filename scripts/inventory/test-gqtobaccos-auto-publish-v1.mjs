import assert from "node:assert/strict";
import fs from "node:fs/promises";
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

assert.match(wrapper, /function Invoke-GitFetchWithRetry/);
assert.match(wrapper, /for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)/);
assert.match(wrapper, /\$delaySeconds = if \(\$attempt -eq 1\) \{ 10 \} else \{ 30 \}/);
assert.match(wrapper, /Start-Sleep -Seconds \$delaySeconds/);
assert.match(wrapper, /Invoke-GitFetchWithRetry/);

assert.match(wrapper, /function Send-GqStartupFailurePushDeer/);
assert.match(wrapper, /\\u70df\\u6597\\u6d3e\\u5e93\\u5b58\\u65e5\\u62a5\\uff5cGQ Tobaccos \\u274c/);
assert.match(wrapper, /\\u72b6\\u6001\\uff1a\\u542f\\u52a8\\u5931\\u8d25/);
assert.match(wrapper, /Production\\uff1a\\u672a\\u4fee\\u6539/);
assert.match(wrapper, /const \{ sendPushDeerNotification \} = await import\("NOTIFIER_MODULE_URL"\)/);
assert.match(wrapper, /\$notifierLauncher = 'await import\(`/);
assert.match(wrapper, /& \$notificationNode\.Source "--input-type=module" "-e" \$notifierLauncher \$notifierScriptBase64 \$reasonBase64/);

assert.match(wrapper, /Assert-TrackedRuntimeClean/);
assert.match(wrapper, /GQ scheduled runtime must run from the formal main worktree/);
assert.match(wrapper, /merge-base --is-ancestor HEAD origin\/main/);
assert.match(wrapper, /"merge", "--ff-only", "origin\/main"/);
assert.match(wrapper, /if \(\$PreflightOnly\) \{/);
assert.match(wrapper, /runner was not started/);
assert.doesNotMatch(wrapper, /gqtobaccos\.com/);

console.log("GQ Tobaccos auto-publish wrapper policy tests passed.");
