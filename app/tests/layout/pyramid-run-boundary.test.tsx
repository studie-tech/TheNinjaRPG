import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as logbook from "@/layout/Logbook";
import { PyramidRunBoundary } from "@/layout/PyramidRunBoundary";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";

const replace = vi.fn();
beforeEach(() => {
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation((select) => {
    const info = userContext.useUserData();
    return { ...info, data: info.data ? select(info.data) : undefined } as never;
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    replace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
    bfcacheId: "test",
  });
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    data: {
      userQuests: [
        {
          isolated: true,
          endAt: null,
          completed: false,
          questType: "battlepyramid",
          quest: { hidden: false },
        },
      ],
    },
  } as unknown as ReturnType<typeof userContext.useUserData>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Pyramid authentication continuity", () => {
  it.each(["/native-sign-in", "/combat"])(
    "renders %s during an isolated run",
    (pathname) => {
      vi.spyOn(routing, "usePublicPathname").mockReturnValue(pathname);
      const view = render(
        <PyramidRunBoundary>
          <button type="button">Continue signing in</button>
        </PyramidRunBoundary>,
      );
      expect(view.getByRole("button", { name: "Continue signing in" })).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
    },
  );
  it.each(["/village", "/native-sign-in/unrelated"])(
    "keeps outside activity %s isolated",
    (pathname) => {
      vi.spyOn(routing, "usePublicPathname").mockReturnValue(pathname);
      const view = render(
        <PyramidRunBoundary>
          <button type="button">Outside activity</button>
        </PyramidRunBoundary>,
      );
      expect(view.queryByRole("button", { name: "Outside activity" })).toBeNull();
      expect(replace).toHaveBeenCalledWith("/combat");
    },
  );
  it("does not mount paused-run game actions on the authentication handoff", () => {
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/native-sign-in");
    vi.spyOn(userContext, "useUserData").mockReturnValue({
      data: {
        userQuests: [
          {
            isolated: false,
            endAt: null,
            completed: false,
            questType: "battlepyramid",
            quest: { hidden: true },
          },
        ],
      },
    } as unknown as ReturnType<typeof userContext.useUserData>);
    const entry = vi.spyOn(logbook, "LogbookEntry").mockReturnValue(null);
    const view = render(
      <PyramidRunBoundary>
        <button type="button">Continue signing in</button>
      </PyramidRunBoundary>,
    );
    expect(view.getByRole("button", { name: "Continue signing in" })).toBeTruthy();
    expect(entry).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
