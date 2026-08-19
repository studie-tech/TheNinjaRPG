import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATAR_FULL_WIDTH,
  avatarRenditionWidth,
  useAvatarRenditionWidth,
} from "@/layout/Avatar";

const Harness: React.FC<{ size: number }> = ({ size }) => {
  const width = useAvatarRenditionWidth(size);
  // Captured on the first render, before the mount effect runs.
  const [firstRenderWidth] = useState(width);
  return (
    <>
      <span data-testid="first">{firstRenderWidth}</span>
      <span data-testid="current">{width}</span>
    </>
  );
};

describe("avatarRenditionWidth", () => {
  it.each([100, 24, 512])("keeps the requested size in the light layout", (size) => {
    expect(avatarRenditionWidth(size, true)).toBe(size);
  });

  it.each([100, 24, 512])("uses the shared rendition in the full layout", (size) => {
    expect(avatarRenditionWidth(size, false)).toBe(AVATAR_FULL_WIDTH);
  });
});

describe("useAvatarRenditionWidth", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("always reports the full rendition on the first render", () => {
    localStorage.setItem("lightLayout", "true");
    render(<Harness size={100} />);
    expect(screen.getByTestId("first").textContent).toBe(String(AVATAR_FULL_WIDTH));
  });

  it("switches to the requested size once mounted in the light layout", () => {
    localStorage.setItem("lightLayout", "true");
    render(<Harness size={100} />);
    expect(screen.getByTestId("current").textContent).toBe("100");
  });

  it("keeps the full rendition once mounted in the full layout", () => {
    render(<Harness size={100} />);
    expect(screen.getByTestId("current").textContent).toBe(String(AVATAR_FULL_WIDTH));
  });
});
