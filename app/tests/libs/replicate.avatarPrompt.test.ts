import { describe, expect, it } from "bun:test";
import type { UserData } from "@/drizzle/schema";
import { getAvatarPrompt } from "@/libs/replicate";
import type { DrizzleClient } from "@/server/db";

const SUFFIX =
  ", red hair, fully clothed, wearing clothes, dressed, anime, rossdraws portrait, stanley artgerm lau, wlop, looking into camera, interesting background, sfw";
const client = {
  query: {
    userAttribute: { findMany: async () => [{ attribute: "red hair" }] },
  },
} as unknown as DrizzleClient;

describe("getAvatarPrompt", () => {
  it.each([
    ["STUDENT", "Male", "teenage boy"],
    ["STUDENT", "Female", "teenage girl"],
    ["STUDENT", "Other", "teenage"],
    ["GENIN", "Male", "teenage boy"],
    ["GENIN", "Female", "teenage girl"],
    ["GENIN", "Other", "teenager"],
    ["CHUNIN", "Male", "man"],
    ["CHUNIN", "Female", "woman"],
    ["CHUNIN", "Other", "person"],
    ["JONIN", "Male", "man"],
    ["JONIN", "Female", "woman"],
    ["JONIN", "Other", "person"],
    ["ELITE JONIN", "Male", "old man"],
    ["ELITE JONIN", "Female", "old woman"],
    ["ELITE JONIN", "Other", "old person"],
    ["ELDER", "Male", "old man wrinkles"],
    ["ELDER", "Female", "old woman wrinkles"],
    ["ELDER", "Other", "old person wrinkles"],
    ["NONE", "Male", "old man wrinkles"],
    ["NONE", "Female", "old woman wrinkles"],
    ["NONE", "Other", "old person wrinkles"],
  ])("describes a %s %s as %s", async (rank, gender, phenotype) => {
    const user = { userId: "user", rank, gender } as UserData;
    expect(await getAvatarPrompt(client, user)).toBe(`${phenotype}${SUFFIX}`);
  });
});
