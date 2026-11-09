import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { CHARACTER_DELETION_CONFIRMATION, type UserRole } from "@/drizzle/constants";
import { profileRouter } from "@/server/api/routers/profile";
import * as deleteUserData from "@/server/utils/accountDeletion/deleteUserData";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

let deletionAt: Date | null;
let role: UserRole;
const writeTimer = vi.fn();
const readUser = vi.fn();

beforeEach(() => {
  deletionAt = null;
  role = "USER";
  writeTimer.mockReset();
  writeTimer.mockResolvedValue({ rowsAffected: 1 });
  readUser.mockReset();
  readUser.mockImplementation(async (_client: unknown, userId: string) => ({
    userId,
    role,
    deletionAt,
    anbuId: null,
    clanId: null,
  }));
  stubProfile("fetchUser", readUser);
  stubProfile("updateUserDataForToggleDeletionTimer", writeTimer);
  vi.spyOn(deleteUserData, "deleteUser").mockResolvedValue(undefined);
});

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

/** Exercise router guards while query doubles prevent database and deletion side effects. */
const caller = () => callerForDatabase(profileRouter, "player", {} as never);

it.each([undefined, "", "delete my character", "Delete my character "])(
  "rejects starting a self-deletion timer without the exact phrase (%s)",
  async (confirmation) => {
    expect(
      await caller().toggleDeletionTimer({ userId: "player", confirmation }),
    ).toMatchObject({
      success: false,
      message: expect.stringContaining(CHARACTER_DELETION_CONFIRMATION),
    });
    expect(writeTimer).not.toHaveBeenCalled();
  },
);

it("starts a confirmed request and allows cancellation without typing", async () => {
  const started = await caller().toggleDeletionTimer({
    userId: "player",
    confirmation: CHARACTER_DELETION_CONFIRMATION,
  });
  expect(started).toEqual(
    expect.objectContaining({
      success: true,
      affectedUserId: "player",
      userPatch: expect.objectContaining({ deletionAt: writeTimer.mock.calls[0]?.[1] }),
      userDelta: expect.objectContaining({}),
    }),
  );
  deletionAt = new Date(Date.now() + 60_000);
  expect(await caller().toggleDeletionTimer({ userId: "player" })).toMatchObject({
    success: true,
    affectedUserId: "player",
    userPatch: { deletionAt: null },
    userDelta: {},
  });
  expect(writeTimer).toHaveBeenCalledTimes(2);
});

it("does not restart a timer when a cancellation arrives after the request was cancelled", async () => {
  expect(await caller().toggleDeletionTimer({ userId: "player" })).toMatchObject({
    success: false,
  });
  expect(writeTimer).not.toHaveBeenCalled();
});

it("requires the phrase again before permanent self-deletion", async () => {
  deletionAt = new Date(Date.now() - 1000);
  expect(await caller().confirmDeletion({ userId: "player" })).toMatchObject({
    success: false,
  });
  expect(deleteUserData.deleteUser).not.toHaveBeenCalled();
  expect(
    await caller().confirmDeletion({
      userId: "player",
      confirmation: CHARACTER_DELETION_CONFIRMATION,
    }),
  ).toMatchObject({ success: true });
  expect(deleteUserData.deleteUser).toHaveBeenCalledTimes(1);
});

it("keeps the waiting period enforced even with the correct phrase", async () => {
  deletionAt = new Date(Date.now() + 60_000);
  expect(
    await caller().confirmDeletion({
      userId: "player",
      confirmation: CHARACTER_DELETION_CONFIRMATION,
    }),
  ).toMatchObject({ success: false, message: "Deletion timer not passed yet" });
  expect(deleteUserData.deleteUser).not.toHaveBeenCalled();
});

it("preserves staff management permissions for another character", async () => {
  role = "HEAD_MODERATOR";
  expect(await caller().toggleDeletionTimer({ userId: "other-player" })).toMatchObject({
    success: true,
  });
  deletionAt = new Date(Date.now() - 1000);
  expect(await caller().confirmDeletion({ userId: "other-player" })).toMatchObject({
    success: true,
  });
});

it.each(["toggleDeletionTimer", "confirmDeletion"] as const)(
  "%s reuses the self-service actor read and retains separate staff target reads",
  async (method) => {
    deletionAt = new Date(Date.now() - 1000);
    expect(
      await caller()[method]({
        userId: "player",
        confirmation: CHARACTER_DELETION_CONFIRMATION,
      }),
    ).toMatchObject({ success: true });
    expect(readUser.mock.calls.map((call) => call[1])).toEqual(["player"]);

    readUser.mockClear();
    role = "HEAD_MODERATOR";
    expect(await caller()[method]({ userId: "other-player" })).toMatchObject({
      success: true,
    });
    expect(readUser.mock.calls.map((call) => call[1])).toEqual([
      "player",
      "other-player",
    ]);
  },
);

it("rejects deletion management of another character by a player", async () => {
  expect(
    await caller().toggleDeletionTimer({
      userId: "other-player",
      confirmation: CHARACTER_DELETION_CONFIRMATION,
    }),
  ).toMatchObject({ success: false });
  deletionAt = new Date(Date.now() - 1000);
  expect(
    await caller().confirmDeletion({
      userId: "other-player",
      confirmation: CHARACTER_DELETION_CONFIRMATION,
    }),
  ).toMatchObject({ success: false });
  expect(writeTimer).not.toHaveBeenCalled();
  expect(deleteUserData.deleteUser).not.toHaveBeenCalled();
});

it.each(["CONTENT", "BALANCE", "EVENT-ADMIN", "JR_MODERATOR"] as const)(
  "rejects deleting another character for %s staff without deletion rights",
  async (staffRole) => {
    role = staffRole;
    deletionAt = new Date(Date.now() - 1000);
    expect(await caller().confirmDeletion({ userId: "other-player" })).toMatchObject({
      success: false,
      message: "You can't delete other users",
    });
    expect(deleteUserData.deleteUser).not.toHaveBeenCalled();
  },
);
