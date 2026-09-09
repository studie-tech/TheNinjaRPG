import { describe, expect, it } from "vitest";

import {
  getHighlightTilesCacheKey,
  nextCombatHoverCursor,
} from "@/libs/threejs/highlightTilesCache";

const base = {
  actionId: "move",
  battleVersion: 3,
  userId: "user-1",
  longitude: 4,
  latitude: 5,
  canUseTile: true,
  hoverTileName: "5,6",
};

describe("getHighlightTilesCacheKey", () => {
  it("is stable for identical highlight inputs", () => {
    expect(getHighlightTilesCacheKey(base)).toEqual(getHighlightTilesCacheKey(base));
  });

  it("changes when the hovered tile changes, so hover selection can update", () => {
    expect(getHighlightTilesCacheKey(base)).not.toEqual(
      getHighlightTilesCacheKey({ ...base, hoverTileName: "5,7" }),
    );
  });

  it("changes when the local actor can no longer act", () => {
    expect(getHighlightTilesCacheKey(base)).not.toEqual(
      getHighlightTilesCacheKey({ ...base, canUseTile: false }),
    );
  });

  it("changes when action, version, or position change", () => {
    const key = getHighlightTilesCacheKey(base);
    expect(key).not.toEqual(getHighlightTilesCacheKey({ ...base, actionId: "attack" }));
    expect(key).not.toEqual(getHighlightTilesCacheKey({ ...base, battleVersion: 4 }));
    expect(key).not.toEqual(getHighlightTilesCacheKey({ ...base, longitude: 5 }));
    expect(key).not.toEqual(getHighlightTilesCacheKey({ ...base, latitude: 6 }));
    expect(key).not.toEqual(getHighlightTilesCacheKey({ ...base, userId: "user-2" }));
  });

  it("does not collide when a field contains the key delimiter", () => {
    expect(
      getHighlightTilesCacheKey({ ...base, actionId: "a|3", battleVersion: 4 }),
    ).not.toEqual(
      getHighlightTilesCacheKey({ ...base, actionId: "a", battleVersion: 3, userId: "4|user-1" }),
    );
  });

  it("treats a missing action id as empty", () => {
    expect(getHighlightTilesCacheKey({ ...base, actionId: undefined })).toEqual(
      getHighlightTilesCacheKey({ ...base, actionId: undefined }),
    );
    expect(getHighlightTilesCacheKey({ ...base, actionId: undefined })).not.toEqual(
      getHighlightTilesCacheKey(base),
    );
  });
});

describe("nextCombatHoverCursor", () => {
  it("restores pointer after a mutation settles back to default", () => {
    expect(nextCombatHoverCursor("pointer", "default")).toBe("pointer");
    expect(nextCombatHoverCursor("pointer", "")).toBe("pointer");
  });

  it("does not override an in-flight wait cursor", () => {
    expect(nextCombatHoverCursor("pointer", "wait")).toBe("wait");
    expect(nextCombatHoverCursor("default", "wait")).toBe("wait");
  });

  it("clears pointer when the hover is no longer a valid target", () => {
    expect(nextCombatHoverCursor("default", "pointer")).toBe("default");
  });
});
