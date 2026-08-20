import { expect, test } from "bun:test";
import type { CliProbe } from "../clis";
import { detectAllClis, detectCli, parseVersionLine } from "../clis";

function fakeProbe(overrides: Partial<CliProbe> = {}): CliProbe {
  return {
    which: async () => null,
    exists: () => false,
    runVersion: async () => "",
    ...overrides,
  };
}

test("parseVersionLine extracts the first semver", () => {
  expect(parseVersionLine("1.0.12 (Claude Code)")).toBe("1.0.12");
  expect(parseVersionLine("codex-cli 0.19.0")).toBe("0.19.0");
  expect(parseVersionLine("0.2.3-rc.1")).toBe("0.2.3");
});

test("parseVersionLine falls back to unknown", () => {
  expect(parseVersionLine("not a version")).toBe("unknown");
  expect(parseVersionLine("")).toBe("unknown");
});

test("detectCli finds the command via which", async () => {
  const probe = fakeProbe({
    which: async (command) =>
      command === "claude" ? "/opt/homebrew/bin/claude" : null,
    runVersion: async () => "1.2.3 (Claude Code)",
  });
  const info = await detectCli("CLAUDE", probe);
  expect(info).toEqual({
    name: "CLAUDE",
    command: "claude",
    path: "/opt/homebrew/bin/claude",
    version: "1.2.3",
  });
});

test("detectCli falls back to known install paths", async () => {
  const probe = fakeProbe({
    exists: (path) => path.endsWith(".local/bin/codex"),
    runVersion: async () => "codex-cli 0.5.0",
  });
  const info = await detectCli("CODEX", probe);
  expect(info?.command).toBe("codex");
  expect(info?.version).toBe("0.5.0");
  expect(info?.path.endsWith(".local/bin/codex")).toBe(true);
});

test("detectCli returns null when nothing is installed", async () => {
  const info = await detectCli("CODEX", fakeProbe());
  expect(info).toBeNull();
});

test("detectAllClis reports both agents independently", async () => {
  const probe = fakeProbe({
    which: async (command) => (command === "claude" ? "/usr/bin/claude" : null),
    runVersion: async () => "9.9.9",
  });
  const result = await detectAllClis(probe);
  expect(result.claude?.path).toBe("/usr/bin/claude");
  expect(result.codex).toBeNull();
});
