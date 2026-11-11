import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { renderToString } from "react-dom/server";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import AvatarImage, {
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

describe("AvatarImage", () => {
  afterEach(cleanup);
  const defaultFile = IMG_AVATAR_DEFAULT.split("/").at(-1) ?? "";

  it("keeps the loading placeholder while the owner is unknown", () => {
    const view = render(<AvatarImage href={undefined} alt="Kakashi" size={100} />);
    expect(view.queryByRole("img")).toBeNull();
  });

  it("shows the default portrait for a player without an avatar", () => {
    const view = render(<AvatarImage href={null} alt="Kakashi" size={100} />);
    const image = view.getByRole("img", { name: "Kakashi" });
    expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain(defaultFile);
  });

  it("falls back to the default portrait when the image fails to load", () => {
    const view = render(
      <AvatarImage href="https://example.com/missing.webp" alt="Kakashi" size={100} />,
    );
    const image = view.getByRole("img", { name: "Kakashi" });
    expect(image.getAttribute("src")).toContain("missing.webp");
    fireEvent.error(image);
    expect(
      decodeURIComponent(
        view.getByRole("img", { name: "Kakashi" }).getAttribute("src") ?? "",
      ),
    ).toContain(defaultFile);
  });
});
