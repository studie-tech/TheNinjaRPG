import { beforeEach, expect, it } from "bun:test";
import { DMG_SETTING_DEFAULTS } from "@/drizzle/constants";
import { gameSetting } from "@/drizzle/schema";
import { dmgConfig } from "@/libs/combat/constants";
import { fetchDmgConfig } from "@/libs/gamesettings";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("fetchDmgConfig", () => {
  beforeEach(() => resetTables(gameSetting));

  it("creates missing settings with their defaults", async () => {
    const database = await getTestDatabase();

    expect(await fetchDmgConfig(database)).toEqual(dmgConfig);

    const rows = await database.select().from(gameSetting);
    expect(rows.map((row) => row.name).sort()).toEqual(
      Object.keys(DMG_SETTING_DEFAULTS).sort(),
    );
  });

  it("keeps stored values and fills only the gaps", async () => {
    const database = await getTestDatabase();
    await database
      .insert(gameSetting)
      .values({ id: "curve", name: "DMG_CURVE", value: 7, time: new Date() });

    expect(await fetchDmgConfig(database)).toEqual({ ...dmgConfig, curve: 7 });
    expect(await database.select().from(gameSetting)).toHaveLength(
      Object.keys(DMG_SETTING_DEFAULTS).length,
    );
  });
});
