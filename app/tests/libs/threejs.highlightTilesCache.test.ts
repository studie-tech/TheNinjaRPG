import { describe, expect, it } from "vitest";

import { getHighlightTilesCacheKey } from "@/libs/threejs/combat";

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

  it("treats a missing action id as empty", () => {
    expect(getHighlightTilesCacheKey({ ...base, actionId: undefined })).toEqual(
      getHighlightTilesCacheKey({ ...base, actionId: undefined }),
    );
    expect(getHighlightTilesCacheKey({ ...base, actionId: undefined })).not.toEqual(
      getHighlightTilesCacheKey(base),
    );
  });
});
