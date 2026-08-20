import { expect, test } from "bun:test";
import { slugFromUrl } from "../git";

test("slugFromUrl parses issue and PR URLs", () => {
  expect(slugFromUrl("https://github.com/studie-tech/TheNinjaRPG/issues/123")).toBe(
    "studie-tech/TheNinjaRPG",
  );
  expect(slugFromUrl("https://github.com/studie-tech/TheNinjaRPG/pull/456")).toBe(
    "studie-tech/TheNinjaRPG",
  );
  expect(slugFromUrl("https://github.com/studie-tech/TheNinjaRPG")).toBe(
    "studie-tech/TheNinjaRPG",
  );
});

test("slugFromUrl parses SSH remotes and strips .git", () => {
  expect(slugFromUrl("git@github.com:studie-tech/TheNinjaRPG.git")).toBe(
    "studie-tech/TheNinjaRPG",
  );
  expect(slugFromUrl("https://github.com/studie-tech/TheNinjaRPG.git")).toBe(
    "studie-tech/TheNinjaRPG",
  );
});

test("slugFromUrl returns null for non-GitHub URLs", () => {
  expect(slugFromUrl("https://gitlab.com/studie-tech/TheNinjaRPG")).toBeNull();
  expect(slugFromUrl("not a url")).toBeNull();
  expect(slugFromUrl("")).toBeNull();
});
