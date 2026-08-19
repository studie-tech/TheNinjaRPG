import { renderToString } from "react-dom/server";
import type React from "react";
import { describe, expect, it } from "vitest";
import {
  AVATAR_FULL_WIDTH,
  avatarRenditionWidth,
  useAvatarRenditionWidth,
} from "@/layout/Avatar";

describe("avatarRenditionWidth", () => {
  for (const size of [100, 24, 512]) {
    it(`keeps the requested size (${size}) in the light layout`, () => {
      expect(avatarRenditionWidth(size, true)).toBe(size);
    });

    it(`uses the shared rendition (${size}) in the full layout`, () => {
      expect(avatarRenditionWidth(size, false)).toBe(AVATAR_FULL_WIDTH);
    });
  }
});

const Probe: React.FC<{ size: number }> = ({ size }) => {
  const width = useAvatarRenditionWidth(size);
  return <span>{width}</span>;
};

describe("useAvatarRenditionWidth", () => {
  it("reports the full rendition on the server render so the first client render matches", () => {
    const markup = renderToString(<Probe size={100} />);
    expect(markup).toContain(String(AVATAR_FULL_WIDTH));
    expect(markup).not.toContain(">100<");
  });
});
