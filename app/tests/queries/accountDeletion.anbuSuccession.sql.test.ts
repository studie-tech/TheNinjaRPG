import { beforeEach, expect, it } from "bun:test";
import { asc } from "drizzle-orm";
import { anbuSquad, userData } from "@/drizzle/schema";
import { updateAnbuSquadForRemoveAccountGameData } from "@/queries/accountDeletion";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const squad = (id: string, leaderId: string) => ({
  id,
  image: "squad.png",
  name: id,
  leaderId,
  villageId: "village",
  kageOrderId: "",
  leaderOrderId: "",
});

describeWithDatabase("account deletion ANBU succession", () => {
  beforeEach(async () => {
    await resetTables(anbuSquad, userData);
  });

  it("hands each led squad to its oldest other member and leaves other squads alone", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId: "departing",
        anbuId: "led",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
      { userId: "newer", anbuId: "led", createdAt: new Date("2025-03-01T00:00:00Z") },
      { userId: "older", anbuId: "led", createdAt: new Date("2025-01-01T00:00:00Z") },
      {
        userId: "outsider",
        anbuId: "other",
        createdAt: new Date("2023-01-01T00:00:00Z"),
      },
      {
        userId: "elsewhere",
        anbuId: "other",
        createdAt: new Date("2025-02-01T00:00:00Z"),
      },
    ]);
    await db
      .insert(anbuSquad)
      .values([
        squad("led", "departing"),
        squad("alone", "departing"),
        squad("other", "elsewhere"),
      ]);

    const result = await updateAnbuSquadForRemoveAccountGameData(db, "departing");

    expect(result.rowsAffected).toBe(2);
    const squads = await db
      .select({ id: anbuSquad.id, leaderId: anbuSquad.leaderId })
      .from(anbuSquad)
      .orderBy(asc(anbuSquad.id));
    expect(squads).toEqual([
      { id: "alone", leaderId: null },
      { id: "led", leaderId: "older" },
      { id: "other", leaderId: "elsewhere" },
    ]);
  });
});
