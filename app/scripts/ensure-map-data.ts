/**
 * Ensure the committed world topology exists. Fresh source checkouts include
 * the generated JSON; source archives that omit it can recreate the same graph
 * deterministically during postinstall without relying on a mutable CDN asset.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const OUT = "src/data/hexasphere.json";

const main = async () => {
  if (existsSync(OUT)) return;
  console.log(`Generating missing ${OUT}`);
  const child = spawn(process.execPath, ["run", "scripts/generate-globe.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`World topology generation failed with exit code ${exitCode}`);
  }
};

await main();
