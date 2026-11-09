import { describe, expect, it } from "bun:test";
import { setAtPath } from "@/libs/contentReview/paths";
import { setAtPath as setInPlace } from "../../../.github/scripts/proposal-paths.mjs";

const fields = () => ({
  name: "Fireball",
  power: 10,
  effects: [{ power: 1 }],
  nested: { list: ["a"], empty: null },
});

/** The written fields, or null when the path was refused. */
const attempt = (write: () => unknown) => {
  try {
    return write();
  } catch {
    return null;
  }
};

describe("CI setAtPath", () => {
  it.each([
    ["name"],
    ["effects.0.power"],
    ["effects.1"],
    ["effects.1.power"],
    ["effects.2"],
    ["effects.x"],
    ["nested.list.1"],
    ["nested.missing"],
    ["nested.missing.deep"],
    ["nested.empty.deep"],
    ["power.deep"],
    ["name.0"],
    ["missing.deep"],
  ])("agrees with the server on %s", (path) => {
    const server = attempt(() => setAtPath(fields(), path, 7));
    const script = attempt(() => {
      const target = fields();
      setInPlace(target, path, 7);
      return target;
    });
    expect(script).toEqual(server);
  });
});
