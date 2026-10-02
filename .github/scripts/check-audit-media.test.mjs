import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const check = async (media) => {
  const dir = await mkdtemp(path.join(tmpdir(), "audit-media-"));
  try {
    const file = path.join(dir, "proposals.json");
    await writeFile(file, JSON.stringify({ proposals: [{ changes: [{ media }] }] }));
    return spawnSync(process.execPath, [fileURLToPath(new URL("./check-audit-media.mjs", import.meta.url))], {
      env: { ...process.env, PROPOSALS_FILE: file },
      encoding: "utf8",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("automatic audits allow catalog and search sounds and inspected scene art", async () => {
  const result = await check([
    { kind: "SFX", path: "effects.0.appearSfx", catalogIds: ["sound"], search: null, generate: null },
    { kind: "SFX", path: "effects.1.appearSfx", catalogIds: [], search: "gentle cast", generate: null },
    { kind: "IMAGE", path: "content.sceneCharacters.0", catalogIds: ["elder"], search: null, generate: null },
    { kind: "IMAGE", path: "image", catalogIds: [], search: null, generate: "A village emblem" },
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("automatic audits refuse generated sound before submission", async () => {
  const result = await check([{ kind: "SFX", path: "effects.0.appearSfx", generate: "A short cast" }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sound generation requires an explicit interactive request/);
});

for (const mediaPath of ["content.sceneCharacters.0", "content.objectives.2.sceneCharacters.1"]) {
  test(`automatic audits defer generation at ${mediaPath} to interactive inspection`, async () => {
    const result = await check([{ kind: "IMAGE", path: mediaPath, generate: "A village elder" }]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /generated scene characters require interactive visual inspection/);
  });
}
