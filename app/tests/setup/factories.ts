/**
 * Row builders for the shared test database. Each fills the columns the schema requires and
 * leaves the rest to their defaults, so a test only states the fields it is actually about.
 */
import { nanoid } from "nanoid";
import { quest, questHistory, userData } from "@/drizzle/schema";
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
