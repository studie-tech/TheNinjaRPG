import { describe, expect, it } from "bun:test";
import { initTRPC } from "@trpc/server";
import {
  buildToolRegistry,
  handleCallEndpoint,
  parseResponseFilters,
  type ResponseFilters,
} from "@/libs/mcp/meta-tools";
import { extractToolsFromProcedures } from "@/libs/mcp/tools";
import type { McpMeta } from "@/libs/mcp/types";

const payload = {
  users: [{ name: "Ninja", level: 5, active: true }, { name: "Kage" }],
  meta: { "*": "star", total: 2, nested: { deep: true } },
  nothing: null,
};

const t = initTRPC.meta<McpMeta>().create();
const router = t.router({
  game: t.router({ read: t.procedure.query(() => payload) }),
});
const registry = buildToolRegistry(extractToolsFromProcedures(router));
const filtered = async (filters: ResponseFilters) => {
  const result = await handleCallEndpoint(
    registry,
    async () => router.createCaller({}),
    "game.read",
    () => [],
    () => true,
    undefined,
    filters,
  );
  const block = result.content[0];
  return block && "text" in block ? block.text : "";
};
const select = async (...paths: string[]) =>
  JSON.parse(await filtered({ select: paths }));
const search = async (term: string) => JSON.parse(await filtered({ search: term }));

describe("response field selection", () => {
  it("reads own properties along a dotted path", async () => {
    expect(await select("meta.total", "meta.nested.deep", "users.length")).toEqual({
      "meta.total": 2,
      "meta.nested.deep": true,
      "users.length": 2,
    });
  });

  it("omits paths that resolve to nothing", async () => {
    expect(
      await select("missing", "meta.total.value", "nothing.value", "meta.toString"),
    ).toEqual({});
  });

  it("returns the expanded items of a trailing wildcard", async () => {
    expect(
      await select("users.*", "meta.nested.*", "nothing.*", "meta.total.*"),
    ).toEqual({
      "users.*": payload.users,
      "meta.nested.*": [true],
    });
  });

  it("maps the rest of a path over a wildcard and drops items without it", async () => {
    expect(await select("users.*.level", "meta.*.deep", "users.*.name")).toEqual({
      "users.*.level": [5],
      "meta.*.deep": [true],
      "users.*.name": ["Ninja", "Kage"],
    });
  });

  it("normalizes a segment before reading it", async () => {
    expect(await select(" meta .total", "meta. * ")).toEqual({
      " meta .total": 2,
      "meta. * ": "star",
    });
  });

  it("refuses dangerous, malformed and overly deep paths", async () => {
    expect(
      await select(
        "__proto__",
        "constructor.name",
        "meta.prototype",
        "users.0.__proto__",
        "me ta",
        "meta..total",
        "users.*.__proto__",
        Array.from({ length: 21 }, () => "meta").join("."),
      ),
    ).toEqual({ "users.*.__proto__": [] });
  });
});

describe("response search", () => {
  it("keeps a whole value under a matching key", async () => {
    expect(await search("NEST")).toEqual({ meta: { nested: { deep: true } } });
  });

  it("matches strings, numbers and booleans case-insensitively", async () => {
    expect(await search("kAGE")).toEqual({ users: [{ name: "Kage" }] });
    expect(await search("5")).toEqual({ users: [{ level: 5 }] });
    expect(await search("TRUE")).toEqual({
      users: [{ active: true }],
      meta: { nested: { deep: true } },
    });
  });

  it("answers an empty object without a match", async () => {
    expect(await search("absent")).toEqual({});
  });
});

describe("parseResponseFilters", () => {
  it("is undefined without a usable filter", () => {
    expect(parseResponseFilters(undefined)).toBeUndefined();
    expect(
      parseResponseFilters({ select: [], search: "", maxLength: 0 }),
    ).toBeUndefined();
    expect(parseResponseFilters({ select: [1, 2], maxLength: -1 })).toBeUndefined();
  });

  it("keeps valid filters and clamps the response length", () => {
    expect(
      parseResponseFilters({
        select: ["a", 1, "b"],
        search: "term",
        maxLength: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ select: ["a", "b"], search: "term", maxLength: 1024 * 1024 });
  });
});
