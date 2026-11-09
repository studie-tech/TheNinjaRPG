import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import * as client from "@/app/_trpc/client";
import {
  IMG_FRONTPAGE_SCREENSHOT_COMBAT,
  IMG_FRONTPAGE_SCREENSHOT_GLOBAL,
  IMG_FRONTPAGE_SCREENSHOT_JUTSUS,
  IMG_FRONTPAGE_SCREENSHOT_SECTOR,
  IMG_FRONTPAGE_SCREENSHOT_VILLAGE,
} from "@/drizzle/constants";
import * as cookieConsent from "@/hooks/useCookieConsent";
import * as GameSettings from "@/layout/GameSettings";
import * as Image from "@/layout/Image";
import Welcome from "@/layout/Welcome";
import { GAME_LAYOUTS } from "@/libs/gameLayouts";
import { bunnyImageUrl } from "@/utils/image";
import * as LayoutContext from "@/utils/LayoutContext";
import * as UserContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(LayoutContext, "useActiveLayout").mockReturnValue("default" as never);
  vi.spyOn(LayoutContext, "useIsPixelLanding").mockReturnValue(false as never);
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isSignedIn: true,
    isLoaded: true,
  } as never);
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(cookieConsent, "useCookieConsent").mockReturnValue(false);
  vi.spyOn(GameSettings, "GameSettingsPopover").mockReturnValue(null);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ notifications: [] } as never);
  vi.spyOn(Image, "default").mockImplementation(((props: Record<string, unknown>) => (
    <img
      alt={String(props.alt)}
      data-src={String(props.src)}
      data-size={`${props.width}x${props.height}`}
      className={String(props.className ?? "")}
    />
  )) as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    misc: { trackVisitor: { useMutation: () => ({ mutate: vi.fn() }) } },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("classic welcome page", () => {
  it.each(GAME_LAYOUTS)(
    "includes readable beginner answers in the $id server markup",
    ({ id }) => {
      vi.spyOn(LayoutContext, "useActiveLayout").mockReturnValue(id as never);
      vi.spyOn(LayoutContext, "useIsPixelLanding").mockReturnValue(id === "pixel");
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(<Welcome />);
      expect(container.querySelectorAll("h1").length).toBe(1);
      expect(container.querySelector("h1,h2,h3")?.tagName).toBe("H1");
      expect(container.querySelectorAll("#welcome-questions").length).toBe(1);
      expect(container.querySelector('a[href="/signup"]')).not.toBeNull();
      expect(container.textContent).toContain("No download is required.");
    },
  );

  it("serves one descriptive H1 before the feature headings without running effects", () => {
    const html = renderToStaticMarkup(<Welcome />);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelectorAll("h1").length).toBe(1);
    expect(container.querySelector("h1,h2,h3")?.textContent).toBe(
      "Free Ninja Browser RPG",
    );
    expect(container.querySelector("#signup_btn")).not.toBeNull();
    expect(container.querySelector('a[href="/guide/getting-started"]')).not.toBeNull();
    expect(container.textContent).toContain("No download is required.");
    expect(container.textContent).toContain("Lemu guides your first steps");
    expect(container.querySelectorAll("img:not([alt])").length).toBe(0);
    expect(container.querySelectorAll("picture source").length).toBe(5);
    expect(container.querySelector("picture source")?.getAttribute("srcset")).toBe(
      bunnyImageUrl(IMG_FRONTPAGE_SCREENSHOT_JUTSUS, 512),
    );
  });

  it("renders the snap sections and five feature sections with their screenshots", () => {
    const view = render(<Welcome />);
    const scroller = view.container.firstElementChild!;
    expect(scroller.className).toBe(
      "flex h-screen snap-y snap-mandatory flex-col gap-4 overflow-y-scroll",
    );
    const sections = [...scroller.children];
    expect(sections.map((section) => section.className)).toEqual([
      "flex snap-start snap-always flex-col gap-4 justify-start",
      "flex snap-start snap-always flex-col justify-center gap-4 pl-3 font-bold text-5xl text-foreground",
      ...Array(5).fill("flex snap-start snap-always flex-col justify-center gap-4"),
      "flex snap-start snap-always flex-col justify-center gap-4",
    ]);
    expect(sections[0]!.firstElementChild!.className).toBe(
      "mr-auto ml-auto flex w-[99%] max-w-[768px] flex-col items-center rounded-xl bg-popover/75 mb-10",
    );
    const features = sections.slice(2, 7);
    expect(features.map((feature) => feature.querySelector("h2")?.textContent)).toEqual(
      ["Jutsus", "Combat", "Village", "Sectors", "Travel"],
    );
    expect(features.map((feature) => feature.querySelector("h2")?.className)).toEqual([
      "font-bold text-2xl",
      ...Array(4).fill("pt-4 font-bold text-2xl"),
    ]);
    expect(features.map((feature) => feature.querySelectorAll("p").length)).toEqual([
      2, 2, 2, 2, 2,
    ]);
    expect(features.map((feature) => feature.querySelector("img")?.outerHTML)).toEqual(
      [
        [IMG_FRONTPAGE_SCREENSHOT_JUTSUS, "Screenshot from Jutsus"],
        [IMG_FRONTPAGE_SCREENSHOT_COMBAT, "Screenshot from Combat"],
        [IMG_FRONTPAGE_SCREENSHOT_VILLAGE, "Screenshot from Village"],
        [IMG_FRONTPAGE_SCREENSHOT_SECTOR, "Screenshot from Sector"],
        [IMG_FRONTPAGE_SCREENSHOT_GLOBAL, "Screenshot from the global map"],
      ].map(
        ([src, alt]) =>
          `<img alt="${alt}" data-src="${src}" data-size="768x597" class="w-full rounded-xl">`,
      ),
    );
    for (const feature of features) {
      expect(feature.firstElementChild!.className).toBe(
        "mr-auto ml-auto flex w-[99%] max-w-[768px] flex-col items-center rounded-xl bg-popover/75",
      );
      expect(
        feature.querySelector(".w-full.p-3 > .flex.flex-col.gap-2"),
      ).not.toBeNull();
    }
    expect(view.container.querySelector(".mb-4.inline")?.className).toBe(
      "mb-4 inline items-center gap-2 text-xl",
    );
  });
});
