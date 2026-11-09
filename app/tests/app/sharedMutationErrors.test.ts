import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "bun:test";

/**
 * These mutations report thrown errors through the QueryClient's default handler, which
 * adds the transport-uncertainty message, the BotID reload action, abort handling and
 * Sentry capture. A local onError would replace all of that.
 */
const mutations = [
  { file: "items", path: "blackmarket.buyItemSlot" },
  { file: "reports", path: "reports.clear" },
  { file: "conceptart", path: "conceptart.create" },
  { file: "conceptart", path: "conceptart.createVideo" },
  { file: "manual/staff", path: "applications.create" },
  { file: "manual/world/tilesets", path: "mapAsset.create" },
  { file: "manual/world/tilesets", path: "mapAsset.delete" },
  { file: "manual/world/tilesets", path: "mapTerrain.create" },
  { file: "manual/world/tilesets", path: "mapTerrain.delete" },
] as const;

/** The options object of `api.<path>.useMutation({ ... })`, up to its closing line. */
const mutationOptions = (file: string, path: string) => {
  const lines = readFileSync(
    join(import.meta.dirname, "../../src/app/[shell]", file, "page.tsx"),
    "utf8",
  ).split("\n");
  const start = lines.findIndex((line) => line.includes(`api.${path}.useMutation({`));
  if (start < 0) throw new Error(`${path} mutation was not found`);
  const indent = lines[start]!.match(/^\s*/)![0];
  const end = lines.findIndex((line, i) => i > start && line === `${indent}});`);
  if (end < 0) throw new Error(`${path} mutation options did not close`);
  return lines.slice(start, end + 1).join("\n");
};

it.each(mutations)(
  "$path leaves thrown errors to the shared handler",
  ({ file, path }) => {
    const options = mutationOptions(file, path);
    expect(options).toContain("onSuccess");
    expect(options).not.toContain("onError");
  },
);
