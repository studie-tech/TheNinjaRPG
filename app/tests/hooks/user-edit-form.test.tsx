import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { UserRanks } from "@/drizzle/constants";
import { useUserEditForm } from "@/hooks/profile";
import type { UpdateUserSchema } from "@/validators/user";

const user: UpdateUserSchema = {
  username: "Kakashi",
  bloodlineId: "sharingan",
  bloodlineReskinId: null,
  sageModeId: null,
  villageId: "leaf",
  role: "USER",
  rank: "JONIN",
  jutsus: [],
  items: [],
  reason: "",
};
const names = (prefix: string) => [
  { id: `${prefix}-1`, name: `${prefix} one`, image: "" },
];
const loadedQueryData: Record<string, unknown> = {
  "jutsu.getAllNames": [{ id: "chidori", name: "Chidori", image: "" }],
  "item.getAllNames": names("item"),
  "bloodline.getAllNames": names("bloodline"),
  "sageMode.getAllNames": names("sage"),
  "bloodline.getReskinsForBloodline": [
    { id: "reskin", name: "Mangekyo", image: "mangekyo.png", extra: "dropped" },
  ],
  "village.getAllNames": names("village"),
  "jutsu.getPublicUserJutsus": [{ jutsuId: "chidori", level: 7 }],
};
let queryData: Record<string, unknown> = {};
const queryCalls: { path: string; input: unknown; options: unknown }[] = [];

beforeEach(() => {
  queryCalls.length = 0;
  queryData = { ...loadedQueryData };
  const procedure = (path: string) => ({
    useQuery: (input: unknown, options: unknown) => {
      queryCalls.push({ path, input, options });
      return { data: queryData[path], isPending: false };
    },
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    jutsu: {
      getAllNames: procedure("jutsu.getAllNames"),
      getPublicUserJutsus: procedure("jutsu.getPublicUserJutsus"),
    },
    item: { getAllNames: procedure("item.getAllNames") },
    bloodline: {
      getAllNames: procedure("bloodline.getAllNames"),
      getReskinsForBloodline: procedure("bloodline.getReskinsForBloodline"),
    },
    sageMode: { getAllNames: procedure("sageMode.getAllNames") },
    village: { getAllNames: procedure("village.getAllNames") },
    profile: {
      updateUser: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useUserEditForm form entries", () => {
  it("lists every permitted field in order with its options", () => {
    const { result } = renderHook(() =>
      useUserEditForm("user-1", user, {
        canEditUsername: true,
        canEditBloodline: true,
        canEditVillage: true,
        canEditRank: true,
        canEditJutsus: true,
        canEditItems: true,
        canEditStaffAccountFlag: true,
        canEditUserRoles: ["USER", "MODERATOR"],
        canEditRankedLp: true,
      }),
    );
    expect<unknown>(result.current.formData).toEqual([
      { id: "username", type: "text" },
      { id: "role", type: "str_array", values: ["USER", "MODERATOR"] },
      { id: "rank", type: "str_array", values: UserRanks },
      {
        id: "bloodlineId",
        type: "db_values",
        values: names("bloodline"),
        resetButton: true,
      },
      {
        id: "bloodlineReskinId",
        type: "db_values",
        label: "Bloodline Reskin",
        resetButton: true,
        values: [
          { id: "", name: "None", image: "" },
          { id: "reskin", name: "Mangekyo", image: "mangekyo.png" },
        ],
      },
      {
        id: "sageModeId",
        type: "db_values",
        label: "Sage Mode",
        resetButton: true,
        values: [{ id: "", name: "None", image: "" }, ...names("sage")],
      },
      {
        id: "villageId",
        type: "db_values",
        values: names("village"),
        resetButton: true,
      },
      { id: "staffAccount", type: "boolean", label: "Staff Benefits" },
      { id: "rankedLp", type: "number", label: "Ranked LP" },
      {
        id: "jutsus",
        type: "db_values",
        multiple: true,
        doubleWidth: true,
        values: [{ id: "chidori", name: "Chidori (7)", image: "" }],
      },
      {
        id: "items",
        type: "db_values",
        values: names("item"),
        multiple: true,
        doubleWidth: true,
      },
      { id: "reason", type: "textarea", doubleWidth: true },
    ]);
    expect(
      queryCalls.find((call) => call.path === "bloodline.getReskinsForBloodline"),
    ).toEqual({
      path: "bloodline.getReskinsForBloodline",
      input: { bloodlineId: "sharingan" },
      options: { enabled: true },
    });
  });

  it("offers only the reason without permissions, or with an empty role list", () => {
    for (const permissions of [{}, { canEditUserRoles: [] }]) {
      const { result } = renderHook(() => useUserEditForm("user-1", user, permissions));
      expect<unknown>(result.current.formData).toEqual([
        { id: "reason", type: "textarea", doubleWidth: true },
      ]);
    }
  });

  it("keeps the reskin and sage choices to None while their lists are loading", () => {
    queryData["bloodline.getReskinsForBloodline"] = undefined;
    queryData["sageMode.getAllNames"] = undefined;
    queryData["bloodline.getAllNames"] = undefined;
    const { result } = renderHook(() =>
      useUserEditForm("user-1", user, { canEditBloodline: true }),
    );
    expect<unknown>(
      result.current.formData
        .slice(0, 3)
        .map((entry) => "values" in entry && entry.values),
    ).toEqual([
      [],
      [{ id: "", name: "None", image: "" }],
      [{ id: "", name: "None", image: "" }],
    ]);
  });
});
