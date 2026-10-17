import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bunEnvironment, selectBun } from "../../../scripts/dev-bun.mjs";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fakeBun(version: string) {
  const directory = await mkdtemp(join(tmpdir(), "tnr-bun-test-"));
  directories.push(directory);
  const binary = join(directory, "bun");
  await writeFile(
    binary,
    `#!/bin/sh\n[ "$1" = "--version" ] || exit 99\nprintf '%s\\n' '${version}'\n`,
  );
  await chmod(binary, 0o700);
  return binary;
}

test("an old PATH Bun falls back to a compatible installed runtime", async () => {
  const old = await fakeBun("1.3.14");
  const compatible = await fakeBun("1.4.3");
  expect(selectBun([old, compatible], "1.4.2")).toBe(compatible);
  expect(selectBun([compatible, old], "1.4.2")).toBe(compatible);
});

test("nested package scripts inherit the compatible Bun instead of the old PATH runtime", async () => {
  const old = await fakeBun("1.3.14");
  const compatible = await fakeBun("1.4.3");
  const output = execFileSync("/bin/sh", ["-c", "bun --version"], {
    encoding: "utf8",
    env: bunEnvironment(compatible, { ...process.env, PATH: dirname(old) }),
  });
  expect(output.trim()).toBe("1.4.3");
});

test("minimum and newer major versions work; older and prerelease runtimes fail", async () => {
  for (const version of ["1.4.2", "1.4.10", "1.5.0", "2.0.0"]) {
    const binary = await fakeBun(version);
    expect(selectBun([binary], "1.4.2")).toBe(binary);
  }
  for (const version of ["1.4.1", "1.3.99", "1.4.2-canary"]) {
    const binary = await fakeBun(version);
    expect(() => selectBun([binary], "1.4.2")).toThrow("refusing to rewrite bun.lock");
  }
  expect(() => selectBun(["/missing/bun"], "1.4.2")).toThrow(
    "Install a compatible Bun",
  );
});
