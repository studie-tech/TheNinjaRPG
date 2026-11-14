import { beforeEach, expect, it } from "bun:test";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { userData } from "@/drizzle/schema";
import { listUserDataForSearchUsers } from "@/queries/profile";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("user search", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "viewer", username: "Narutoviewer", approvedTos: true },
      { userId: "short", username: "Naru", approvedTos: true },
      { userId: "ai", username: "Naruai", approvedTos: true, isAi: true },
      { userId: "mix", username: "Narumix", approvedTos: true },
      { userId: "prefix", username: "Narutokun", approvedTos: true },
      { userId: "pending", username: "Naruwait", approvedTos: false },
      { userId: "inner", username: "Uzunaru", approvedTos: true },
      { userId: "innerShort", username: "Kanaru", approvedTos: true },
      { userId: "underscore", username: "na_ru", approvedTos: true },
      { userId: "wildcard", username: "naxru", approvedTos: true },
    ]);
  });

  it("returns a full page of prefix matches, shortest first", async () => {
    expect(await search("naru", { showAi: true, showYourself: true })).toEqual([
      "Naru",
      "Naruai",
      "Narumix",
      "Narutokun",
      "Narutoviewer",
    ]);
  });

  it("fills a short prefix page with substring matches", async () => {
    expect(await search("naru", { showAi: false, showYourself: false })).toEqual([
      "Naru",
      "Narumix",
      "Narutokun",
      "Kanaru",
      "Uzunaru",
    ]);
  });

  it("finds usernames by substring alone", async () => {
    expect(await search("zuna")).toEqual(["Uzunaru"]);
  });

  it("matches LIKE wildcards literally", async () => {
    expect(await search("a_r")).toEqual(["na_ru"]);
  });

  it("forces an index covering username and eligibility filters", async () => {
    const { sql } = listUserDataForSearchUsers(
      await getTestDatabase(),
      { username: "naru", showAi: false, showYourself: false },
      { userId: "viewer" },
      "contains",
      5,
    ).toSQL();
    const indexName = /FORCE INDEX \(([^)]+)\)/.exec(sql)?.[1];
    const covering = getTableConfig(userData).indexes.find(
      (index) => index.config.name === indexName,
    );
    expect(
      covering?.config.columns.map((column) => "name" in column && column.name),
    ).toEqual(["username", "approvedTos", "isAi"]);
  });

  for (const match of ["prefix", "substring"] as const) {
    for (const excluded of ["AI", "unapproved"] as const) {
      it(`finds an eligible ${match} match after fifty shorter ${excluded} users`, async () => {
        await resetTables(userData);
        const prefix = match === "prefix" ? "Naru" : "Anaru";
        await insertUsers([
          { userId: "viewer", username: "Viewer", approvedTos: true },
          ...Array.from({ length: 50 }, (_, i) => ({
            userId: `excluded${i}`,
            username: `${prefix}${i}`,
            approvedTos: excluded !== "unapproved",
            isAi: excluded === "AI",
          })),
          { userId: "eligible", username: `${prefix}human`, approvedTos: true },
        ]);
        expect(await search("naru", { showAi: false, showYourself: false })).toEqual([
          `${prefix}human`,
        ]);
      });
    }
  }
});

/** Usernames the viewer's search returns for `username`. */
const search = async (
  username: string,
  options: { showAi?: boolean; showYourself?: boolean } = {},
) => {
  const viewer = await callerFor(profileRouter, "viewer");
  const rows = await viewer.searchUsers({
    username,
    showAi: options.showAi ?? true,
    showYourself: options.showYourself ?? true,
  });
  return rows.map((row) => row.username);
};
