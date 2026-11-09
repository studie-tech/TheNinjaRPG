#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { run } = require("npm-check-updates");
const root = fileURLToPath(new URL("..", import.meta.url));
const checkOnly = process.argv.includes("--check");
const files = ["app/package.json", "mobile/package.json"];

// Query every manifest before writing any of them. Keep contextual overrides such as
// `$cytoscape` intact; npm-check-updates expects flat version strings in these sections.
const updates = await Promise.all(files.map(async (file) => {
  const original = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const manifest = JSON.parse(original);
  for (const group of ["dependencies", "devDependencies", "optionalDependencies", "overrides"]) {
    const versions = Object.fromEntries(Object.entries(manifest[group] ?? {}).filter(
      ([, value]) => typeof value === "string" && !value.startsWith("$"),
    ));
    if (!Object.keys(versions).length) continue;
    const changed = await run({
      packageData: JSON.stringify({ dependencies: versions }, null, 2),
      dep: "prod",
      target: "latest",
      jsonUpgraded: true,
      silent: true,
    });
    for (const [name, version] of Object.entries(changed)) {
      console.log(`${file} ${group}.${name}: ${manifest[group][name]} -> ${version}`);
      manifest[group][name] = version;
    }
  }
  if (manifest.packageManager) {
    const changed = await run({
      packageData: JSON.stringify({ packageManager: manifest.packageManager }, null, 2),
      dep: "packageManager", target: "latest", jsonUpgraded: true, silent: true,
    });
    if (changed.bun) manifest.packageManager = `bun@${changed.bun}`;
  }
  return { file, original, updated: `${JSON.stringify(manifest, null, 2)}\n` };
}));

const changed = updates.filter(({ original, updated }) => original !== updated);
if (checkOnly) {
  console.log(changed.length ? `${changed.length} manifests need updates.` : "All npm manifests match the latest releases.");
  process.exitCode = changed.length ? 1 : 0;
} else {
  for (const { file, updated } of changed) {
    const target = new URL(`../${file}`, import.meta.url);
    const temp = new URL(`${target.href}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, updated);
      renameSync(temp, target);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  for (const file of files) {
    const result = spawnSync(process.execPath, [`${root}/scripts/dev-bun.mjs`, "update"], {
      cwd: `${root}/${file.replace("/package.json", "")}`, stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log("Review migration guides before running the repository checks.");
}
