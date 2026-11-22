import { describe, expect, it } from "bun:test";
import * as gameConstants from "@/drizzle/constants";
import {
  CS_SFX,
  HOME_FURNITURE_STARTERS,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  TD_SFX,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
} from "@/drizzle/constants";
import {
  RESERVED_CONTENT_IDS,
  reservedContentDeletionError,
} from "@/libs/reservedContent";
import { deleteUser } from "@/server/utils/accountDeletion/deleteUserData";

describe("reserved content", () => {
  it("reserves exported IDs whose names identify a content dependency", () => {
    for (const [name, value] of Object.entries(gameConstants)) {
      if (typeof value !== "string") continue;
      const kind = name.match(/_(JUTSU|ITEM|QUEST|BLOODLINE|AI|DUMMY)_ID$/)?.[1];
      const type =
        name.startsWith("ID_SFX_") || name.startsWith("ID_ANIMATION_")
          ? "asset"
          : kind === "DUMMY"
            ? "ai"
            : kind?.toLowerCase();
      if (!type) continue;
      expect(
        reservedContentDeletionError(type as keyof typeof RESERVED_CONTENT_IDS, value),
        name,
      ).toContain("reserved content");
    }
  });

  it("protects every minigame sound cue from its source map", () => {
    for (const id of [...Object.values(TD_SFX), ...Object.values(CS_SFX)]) {
      expect(reservedContentDeletionError("asset", id)).toContain("reserved content");
    }
  });

  it("keeps tutorial and Sage Mode jutsu reserved", () => {
    for (const id of [TUTORIAL_JUTSU_ID, SAGE_MODE_ACTIVATION_JUTSU_ID]) {
      expect(reservedContentDeletionError("jutsu", id)).toContain("reserved content");
    }
  });

  it("protects the starter home fixtures granted to every character", () => {
    for (const { itemId } of HOME_FURNITURE_STARTERS)
      expect(reservedContentDeletionError("item", itemId)).toContain(
        "reserved content",
      );
  });

  it("scopes reservations to the owning content type and allows ordinary IDs", () => {
    expect(reservedContentDeletionError("item", TUTORIAL_ITEM_ID)).toBeString();
    expect(reservedContentDeletionError("badge", TUTORIAL_ITEM_ID)).toBeNull();
    expect(reservedContentDeletionError("asset", "staff-created-sound")).toBeNull();
    expect(reservedContentDeletionError("asset", `${TD_SFX.throw}-copy`)).toBeNull();
  });

  it("rejects case, accent and trailing-space aliases accepted by database lookups", () => {
    for (const id of [TD_SFX.fire.toUpperCase(), `${TD_SFX.fire} `, "bódy"]) {
      expect(reservedContentDeletionError("asset", id)).toBeString();
    }
  });

  it("protects required characters in the shared deletion helper before any database access", async () => {
    const database = new Proxy({} as Parameters<typeof deleteUser>[0], {
      get() {
        throw new Error("Reserved character deletion must not reach the database");
      },
    });
    for (const id of RESERVED_CONTENT_IDS.ai) {
      expect(await deleteUser(database, id)).toMatchObject({
        success: false,
        message: expect.stringContaining("reserved content"),
      });
      expect(await deleteUser(database, `${id.toUpperCase()} `)).toMatchObject({
        success: false,
      });
    }
  });
});
