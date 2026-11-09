import { expect, it } from "bun:test";
import { buildDiscordEvents } from "@/libs/discordEvents";
import { listDiscordRaids } from "@/queries/discordEvents";
import { planetScaleFixture } from "../setup/planetscale";

const now = new Date("2026-10-29T12:00:00Z");

// Relational SQL extras can decode as numeric strings; verify our emitted phases through the production adapter.
it.each([
  ["open", "0", "100", null, ["start"]],
  ["defeated open", "0", "0", null, ["start", "end"]],
  ["dormant exclusive", "1", "100", null, []],
  ["active exclusive", "1", "100", "2026-10-30 12:00:00.000", ["start"]],
  ["expired exclusive", "1", "100", "2026-10-29 11:59:00.000", ["start", "end"]],
] as const)(
  "builds %s raid alerts from PlanetScale wire values",
  async (_name, exclusive, health, deadline, phases) => {
    const { database } = planetScaleFixture(() => ({
      fields: [
        { name: "id", type: "VARCHAR" },
        { name: "name", type: "VARCHAR" },
        { name: "createdAt", type: "DATETIME" },
        { name: "hidden", type: "INT8" },
        { name: "raidBossCurrentHealth", type: "INT64" },
        { name: "raidStartedAt", type: "DATETIME" },
        { name: "raidEndsAt", type: "DATETIME" },
        { name: "isExclusive", type: "INT64" },
      ],
      rows: [
        [
          "raid",
          "Boss",
          "2026-10-29 12:00:00.000",
          "0",
          health,
          null,
          deadline,
          exclusive,
        ],
      ],
    }));
    const events = buildDiscordEvents({
      raids: await listDiscordRaids(database),
      wars: [],
      territories: [],
      enabledAt: { raids: new Date(0) },
      observed: new Set(),
      now,
    });
    expect(events.map((event) => event.id.split(":").at(-1))).toEqual([...phases]);
  },
);
