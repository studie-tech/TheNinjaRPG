import { expect } from "bun:test";
import { quest, village, villageStructure } from "@/drizzle/schema";
import { questPartyRouter } from "@/server/api/routers/questParty";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "./factories";
import { callerFor, getTestDatabase } from "./testDatabase";

type QuestRow = Partial<typeof quest.$inferInsert> & Record<string, unknown>;
type Objectives = (typeof quest.$inferInsert)["content"]["objectives"];

/** Veteran of the home village, close enough to its Administrative Building to form a team. */
export const questTeamMember = (
  userId: string,
  overrides: Record<string, unknown> = {},
) => ({
  userId,
  username: userId,
  status: "AWAKE" as const,
  rank: "JONIN" as const,
  level: 50,
  experience: 20_000_000,
  villageId: "home",
  sector: 50,
  longitude: 10,
  latitude: 10,
  regenAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/** The home village, its Administrative Building and the members who form teams there. */
export const insertQuestTeamWorld = async ({
  sector = 50,
  members = ["leader", "helper"],
  ...member
}: { sector?: number; members?: string[] } & Record<string, unknown> = {}) => {
  const database = await getTestDatabase();
  await database
    .insert(village)
    .values({ id: "home", name: "Home", kageId: "leader", sector });
  await database.insert(villageStructure).values({
    id: "admin",
    villageId: "home",
    name: "Administrative Building",
    route: "/adminbuilding",
    image: "",
  });
  await insertUsers(
    members.map((userId) => questTeamMember(userId, { sector, ...member })),
  );
};

/** Team-enabled quest with immediate retries; attempt limits stay with each test. */
export const teamQuest = (objectives: Objectives, overrides: QuestRow = {}) => ({
  id: "team-quest",
  questType: "event" as const,
  teamEnabled: true,
  retryDelay: "none" as const,
  content: {
    objectives,
    reward: ObjectiveReward.parse({}),
    sceneBackground: "",
    sceneCharacters: [],
  },
  ...overrides,
});

export const insertTeamQuest = (objectives: Objectives, overrides: QuestRow = {}) =>
  insertQuests([teamQuest(objectives, overrides)]);

/** `leader` opens a public team on the team quest and `helper` joins it. */
export const formQuestTeam = async () => {
  const database = await getTestDatabase();
  const leader = await callerFor(questPartyRouter, "leader");
  expect((await leader.create({ questId: "team-quest", isPublic: true })).success).toBe(
    true,
  );
  const party = (await database.query.questParty.findFirst())!;
  const helper = await callerFor(questPartyRouter, "helper");
  expect((await helper.join({ partyId: party.id })).success).toBe(true);
  return { leader, helper, party };
};
