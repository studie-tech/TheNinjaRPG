import { bloodline, village } from "@/drizzle/schema";
import { registerRouter } from "@/server/api/routers/register";
import type { DrizzleClient } from "@/server/db";
import { getTestDatabase } from "./testDatabase";

type CharacterInput = Parameters<
  ReturnType<typeof registerRouter.createCaller>["createCharacter"]
>[0];
type NamedCharacter = Pick<CharacterInput, "username" | "bloodlineId"> &
  Partial<CharacterInput>;

/** Valid character form; the caller names the character and its bloodline. */
export const characterInput = (character: NamedCharacter): CharacterInput => ({
  gender: "Male",
  hair_color: "Black",
  eye_color: "Blue",
  skin_color: "Light",
  attribute_1: "Soft features",
  attribute_2: "Glasses",
  attribute_3: "Short Hair",
  read_tos: true,
  read_privacy: true,
  read_earlyaccess: true,
  ...character,
});

/** Registers `userId` with the given request context, which a real caller would carry. */
export const registerCharacter = async (
  userId: string,
  character: NamedCharacter,
  { database, userIp }: { database?: DrizzleClient; userIp?: string } = {},
) =>
  registerRouter
    .createCaller({
      drizzle: database ?? (await getTestDatabase()),
      userId,
      userIp,
    } as never)
    .createCharacter(characterInput(character));

/** The starting village and bloodline a new character needs: `${prefix}-horizon` and `${prefix}-bloodline`. */
export const insertRegistrationContent = async (prefix: string, kageId = "kage") => {
  const database = await getTestDatabase();
  await Promise.all([
    database
      .insert(village)
      .values({ id: `${prefix}-horizon`, name: "Horizon", sector: 1, kageId }),
    database.insert(bloodline).values({
      id: `${prefix}-bloodline`,
      name: `${prefix} bloodline`,
      image: "/bloodline.png",
      description: "test",
      effects: [],
      rank: "D",
    }),
  ]);
};
