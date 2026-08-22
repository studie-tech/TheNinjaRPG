import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Tauri shell resolves the sidecar as <Resource dir>/tnr-dev-client (see
// sidecar_path in src-tauri/src/main.rs). The bundler only puts it there if the
// resource is declared in map form; the list form ("../bin/tnr-dev-client")
// silently preserves the relative prefix as "_up_/bin/", which builds fine and
// then fails at runtime with a sidecar the app can never start.

const root = join(import.meta.dir, "..", "..");
const conf = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
) as {
  bundle: { resources: unknown; icon: string[] };
};

// Keep in sync with `dir.join("tnr-dev-client")` in src-tauri/src/main.rs.
const EXPECTED_RESOURCE_NAME = "tnr-dev-client";

test("the sidecar is bundled where the Tauri shell looks for it", () => {
  const { resources } = conf.bundle;
  expect(Array.isArray(resources)).toBe(false);
  const destinations = Object.values(resources as Record<string, string>);
  expect(destinations).toContain(EXPECTED_RESOURCE_NAME);
});

test("the sidecar resource points at the compiled binary", () => {
  const sources = Object.keys(conf.bundle.resources as Record<string, string>);
  expect(sources).toContain("../bin/tnr-dev-client");
});

test("bundle icons are declared and the files exist", () => {
  const { icon } = conf.bundle;
  expect(icon.length).toBeGreaterThan(0);
  // tauri build fails outright on a missing icon path, so a stale entry here
  // breaks packaging rather than degrading it.
  for (const rel of icon) {
    const path = join(root, "src-tauri", rel);
    expect(() => readFileSync(path)).not.toThrow();
  }
  expect(icon.some((i) => i.endsWith(".icns"))).toBe(true);
  expect(icon.some((i) => i.endsWith(".ico"))).toBe(true);
});
