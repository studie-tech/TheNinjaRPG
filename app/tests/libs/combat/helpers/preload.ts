import type { AiProfile } from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeBattleUser } from "./battleScenario";

type PreloadOptions = Parameters<typeof processUsersForBattle>[1];

/** Fetched-character shape battle initiation consumes: a battle user with empty relations. */
export const makeCombatQueryUser = (
  id: string,
  overrides: Record<string, unknown> = {},
): CombatQueryUser =>
  makeBattleUser(id, {
    regenAt: new Date(),
    regeneration: 0,
    money: 0,
    effects: [],
    bloodright: [],
    userSkills: [],
    items: [],
    jutsus: [],
    bloodline: null,
    village: null,
    clan: null,
    anbuSquad: null,
    aiProfile: null,
    ...overrides,
  }) as unknown as CombatQueryUser;

/**
 * Runs battle initiation on preloaded combatants in a 10x10 COMBAT battle with the
 * first user on the left. Scenarios that reach the database pass a stub `client`.
 */
export const preloadBattle = (
  users: CombatQueryUser[],
  {
    client = {} as DrizzleClient,
    ...options
  }: Partial<PreloadOptions> & { client?: DrizzleClient } = {},
) =>
  processUsersForBattle(client, {
    users,
    battleType: "COMBAT",
    leftSideUserIds: users.slice(0, 1).map((user) => user.userId),
    hide: false,
    isSummon: false,
    width: 10,
    height: 10,
    settings: [],
    relations: [],
    wars: [],
    villages: [],
    defaultProfile: { id: "default" } as AiProfile,
    ...options,
  });
