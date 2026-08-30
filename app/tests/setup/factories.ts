/**
 * Row builders for the shared test database. Each fills the columns the schema requires and
 * leaves the rest to their defaults, so a test only states the fields it is actually about.
 */
import { nanoid } from "nanoid";
import { item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import { getTestDatabase } from "./testDatabase";

type Insert<T> = Partial<T> & Record<string, unknown>;

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

export const insertQuests = async (quests: Insert<typeof quest.$inferInsert>[]) => {
  const database = await getTestDatabase();
  const rows = quests.map((entry) => ({
    id: nanoid(),
    name: "Test quest",
    questType: "daily",
    content: { objectives: [], reward: {}, sceneBackground: "", sceneCharacters: [] },
    ...entry,
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
    ...entry,
  }));
  await database.insert(userItem).values(rows as never);
  return rows;
};
