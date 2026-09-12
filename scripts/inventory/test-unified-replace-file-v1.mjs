import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../build-unified-products-staging-v1.mjs", import.meta.url), "utf8");
const writer = source.slice(source.indexOf("function replaceFileWithRetry("), source.indexOf("function text("));
for (const platform of ["win32", "linux"]) {
  const calls = [];
  const files = new Map([["out", "old"]]);
  let failures = 1;
  const context = vm.createContext({
    process: { platform, pid: 1 },
    path: { dirname: () => "." },
    crypto: { createHash: () => ({ update: () => ({ digest: () => "hash" }) }) },
    sleepSync: () => calls.push("retry"),
    fs: {
      existsSync: (p) => files.has(p),
      chmodSync: () => calls.push("chmod"),
      unlinkSync: (p) => { calls.push("unlink"); files.delete(p); },
      renameSync: (from, to) => {
        calls.push("rename");
        if (failures-- > 0) throw new Error("busy");
        files.set(to, files.get(from)); files.delete(from);
      },
      mkdirSync: () => {},
      writeFileSync: (p, data) => files.set(p, data),
    },
  });
  vm.runInContext(writer, context);
  assert.equal(vm.runInContext('atomicWriteJson("out", {next:true})', context), "HASH");
  assert.equal(files.get("out"), '{\n  "next": true\n}\n');
  assert.equal(files.has("out.tmp-1"), false);
  assert.deepEqual(calls, [...(platform === "win32" ? ["chmod"] : []), "unlink", "rename", "retry", "rename"]);
  failures = 30;
  assert.throws(() => vm.runInContext('atomicWriteJson("out", {})', context), /busy/);
  assert.equal(files.has("out.tmp-1"), false, "failed write removes only its temporary file");
}
console.log("Unified replacement platform/retry/temp-file tests passed.");
