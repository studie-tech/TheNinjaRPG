/**
 * Row builders for the shared test database. Each fills the columns the schema requires and
 * leaves the rest to their defaults, so a test only states the fields it is actually about.
 */
import { nanoid } from "nanoid";
import {
  aiProfile,
  clan,
  item,
  jutsu,
  petSpecies,
  quest,
  questHistory,
  userData,
  userItem,
  userPet,
  userVote,
} from "@/drizzle/schema";
import type { QuestContentType } from "@/validators/objectives";
import { getTestDatabase } from "./testDatabase";

type Insert<T> = Partial<T> & Record<string, unknown>;

/** Authored species rows are explicit fixtures; schema setup does not seed content. */
export const insertPetSpecies = async (
  species: Insert<typeof petSpecies.$inferInsert>[],
) => {
  const database = await getTestDatabase();
  const rows = species.map((entry, index) => ({
    id: `pet-species-${index}`,
    name: `Species ${index}`,
    description: "A small companion animal",
    rarity: "COMMON" as const,
    isActive: true,
    ...entry,
  }));
  await database.insert(petSpecies).values(rows);
  return rows;
};

export const insertUsers = async (users: Insert<typeof userData.$inferInsert>[]) => {
  const database = await getTestDatabase();
  const rows = users.map((user, index) => ({
    userId: `user-${index}`,
    username: `user-${index}`,
    gender: "Male",
    streak: 0,
    ...user,
  }));
  await database.insert(userData).values(rows as never);
  return rows;
};

/** Quest rows; `content` keys a test omits keep the empty defaults. */
export const insertQuests = async (
  quests: (Insert<Omit<typeof quest.$inferInsert, "content">> & {
    content?: Partial<QuestContentType>;
  })[],
) => {
  const database = await getTestDatabase();
  const rows = quests.map((entry) => ({
    id: nanoid(),
    name: "Test quest",
    questType: "daily",
    ...entry,
    content: {
      objectives: [],
      reward: {},
      sceneBackground: "",
      sceneCharacters: [],
      ...entry.content,
    },
  }));
  await database.insert(quest).values(rows as never);
  return rows;
};

export const insertQuestHistory = async (
  entries: Insert<typeof questHistory.$inferInsert>[],
) => {
  const database = await getTestDatabase();
  const rows = entries.map((entry) => ({
    id: nanoid(),
    userId: "user-0",
    questId: "quest-0",
    questType: "daily",
    ...entry,
  }));
  await database.insert(questHistory).values(rows as never);
  return rows;
};

export const insertItems = async (items: Insert<typeof item.$inferInsert>[]) => {
  const database = await getTestDatabase();
  const rows = items.map((entry, index) => ({
    id: `item-${index}`,
    name: `Item ${index}`,
    image: "/item.png",
    description: "test item",
    itemType: "MATERIAL",
    furnitureData: null,
    rarity: "COMMON",
    slot: "ITEM",
    target: "CHARACTER",
    effects: [],
    ...entry,
  }));
  await database.insert(item).values(rows as never);
  return rows;
};

export const insertUserItems = async (
  userItems: Insert<typeof userItem.$inferInsert>[],
) => {
  const database = await getTestDatabase();
  const rows = userItems.map((entry, index) => ({
    id: `user-item-${index}`,
    userId: "user-0",
    quantity: 1,
    equipped: "NONE",
    homeX: null,
    homeY: null,
    homeRotation: 0,
    ...entry,
  }));
  await database.insert(userItem).values(rows as never);
  return rows;
};

/** The founder follows `leaderId` unless a test separates them. */
export const insertClans = async (clans: Insert<typeof clan.$inferInsert>[]) => {
  const database = await getTestDatabase();
  const rows = clans.map((entry, index) => {
    const id = entry.id ?? `clan-${index}`;
    return {
      id,
      name: id,
      image: "/clan.png",
      villageId: "village",
      founderId: entry.leaderId ?? "leader",
      leaderId: "leader",
      leaderOrderId: `${id}-order`,
      ...entry,
    };
  });
  await database.insert(clan).values(rows as never);
  return rows;
};

/** Complete jutsu row, usable in memory by the pure training calculators. */
export const jutsuRow = (
  id: string,
  overrides: Insert<typeof jutsu.$inferInsert> = {},
) => ({
  id,
  name: id,
  description: id,
  battleDescription: id,
  image: "/jutsu.png",
  effects: [],
  target: "SELF" as const,
  range: 0,
  requiredRank: "STUDENT" as const,
  jutsuRank: "D" as const,
  jutsuType: "NORMAL" as const,
  ...overrides,
});

export const insertJutsus = async (jutsus: Insert<typeof jutsu.$inferInsert>[]) => {
  const database = await getTestDatabase();
  const rows = jutsus.map((entry, index) =>
    jutsuRow(entry.id ?? `jutsu-${index}`, entry),
  );
  await database.insert(jutsu).values(rows as never);
  return rows;
};

/** `speciesId` matches the first row of `insertPetSpecies`. */
export const insertUserPets = async (pets: Insert<typeof userPet.$inferInsert>[]) => {
  const database = await getTestDatabase();
  const rows = pets.map((entry, index) => {
    const id = entry.id ?? `user-pet-${index}`;
    return {
      id,
      userId: "user-0",
      name: id,
      speciesId: "pet-species-0",
      paletteIndex: 0,
      characteristicIndex: 0,
      auraIndex: 0,
      ...entry,
    };
  });
  await database.insert(userPet).values(rows as never);
  return rows;
};

/** `fetchUpdatedUser` creates a missing vote row, and parallel requests would race on it. */
export const insertUserVotes = async (
  votes: Insert<typeof userVote.$inferInsert>[],
) => {
  const database = await getTestDatabase();
  const rows = votes.map((entry) => ({
    id: `vote-${entry.userId}`,
    secret: "secret01",
    lastVoteAt: new Date(),
    ...entry,
  }));
  await database.insert(userVote).values(rows as never);
  return rows;
};

/** The profile battle initiation falls back to; schema setup does not seed it. */
export const insertDefaultAiProfile = async (
  overrides: Insert<typeof aiProfile.$inferInsert> = {},
) => {
  const database = await getTestDatabase();
  const row = { id: "Default", userId: "default-ai", rules: [], ...overrides };
  await database.insert(aiProfile).values(row as never);
  return row;
};
