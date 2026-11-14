import { beforeEach, expect, it } from "bun:test";
import { DMG_SETTING_DEFAULTS } from "@/drizzle/constants";
import { gameSetting } from "@/drizzle/schema";
import { dmgConfig } from "@/libs/combat/constants";
import { fetchDmgConfig, updateDmgConfig } from "@/libs/gamesettings";
import { listCachedGameSettings } from "@/queries/gamesettings";
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

  it("saves concurrent config values and refreshes the shared settings catalogue", async () => {
    const database = await getTestDatabase();
    await fetchDmgConfig(database);
    await listCachedGameSettings(database);
    const config = { ...dmgConfig, curve: 7 };

    await updateDmgConfig(database, config);

    expect(await fetchDmgConfig(database)).toEqual(config);
    expect(
      (await listCachedGameSettings(database)).find((row) => row.name === "DMG_CURVE")
        ?.value,
    ).toBe(config.curve);
  });
});
