import { describe, expect, it, vi } from "bun:test";
import { fetchContentViewerRole } from "@/queries/profile";
import { getContentRole } from "@/utils/permissions";

describe("getContentRole", () => {
  it("keeps a staff role until its owner plays as a regular player", () => {
    expect(getContentRole({ role: "CONTENT", playsAsPlayer: false })).toBe("CONTENT");
    expect(getContentRole({ role: "CONTENT", playsAsPlayer: true })).toBe("USER");
    expect(getContentRole({ role: "USER", playsAsPlayer: true })).toBe("USER");
  });
});

describe("fetchContentViewerRole", () => {
  const client = (viewer: object | undefined) =>
    ({
      query: { userData: { findFirst: vi.fn().mockResolvedValue(viewer) } },
    }) as never;

  it("shows signed-out and unknown viewers released content only", async () => {
    expect(await fetchContentViewerRole(client({ role: "OWNER" }), null)).toBe("USER");
    expect(await fetchContentViewerRole(client(undefined), "gone")).toBe("USER");
  });

  it("applies the viewer's choice to play as a regular player", async () => {
    expect(
      await fetchContentViewerRole(
        client({ role: "OWNER", playsAsPlayer: false }),
        "me",
      ),
    ).toBe("OWNER");
    expect(
      await fetchContentViewerRole(
        client({ role: "OWNER", playsAsPlayer: true }),
        "me",
      ),
    ).toBe("USER");
  });
});
