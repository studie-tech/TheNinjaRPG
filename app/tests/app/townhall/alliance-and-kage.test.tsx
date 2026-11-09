import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import TownHall from "@/app/[shell]/townhall/page";
import * as localstorage from "@/hooks/localstorage";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as KageDefense from "@/layout/KageDefense";
import * as PublicUser from "@/layout/PublicUser";
import * as UserRequestSystem from "@/layout/UserRequestSystem";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { actualImage } from "../../setup/preload";

type Options = {
  onSuccess: (data: { success: boolean; message: string }) => Promise<void>;
};
const captured: Record<string, Options> = {};
const invalidate = vi.fn(async () => undefined);
const idle = {
  useQuery: () => ({ data: undefined, isPending: false, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
};
const village = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  type: "VILLAGE",
  allianceSystem: true,
  villageGraphic: `/${id}.webp`,
  kageId: `${id}-kage`,
  kage: null,
  ...extra,
});

const mount = (tab: string, user: object) => {
  vi.spyOn(localstorage, "useLocalStorage").mockReturnValue([tab, vi.fn()] as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: {
      userId: "viewer",
      villageId: "home",
      isBanned: false,
      isOutlaw: false,
      role: "USER",
      village: { kageId: "someone" },
      ...user,
    },
    timeDiff: 0,
  } as never);
  return render(
    <AppRouterContext.Provider value={{} as never}>
      <TownHall />
    </AppRouterContext.Provider>,
  );
};

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  // Other suites replace the layout Image module; the card list is read through its images.
  vi.spyOn(Image, "default").mockImplementation(actualImage);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children, title }) => (
    <section aria-label={String(title)}>{children}</section>
  ));
  vi.spyOn(KageDefense, "KageDefense").mockImplementation((() => null) as never);
  vi.spyOn(PublicUser, "default").mockImplementation((() => null) as never);
  vi.spyOn(UserRequestSystem, "default").mockImplementation(() => null);
  const capture = (name: string) => ({
    useMutation: (options: Options) => {
      captured[name] = options;
      return { mutate: vi.fn(), isPending: false };
    },
  });
  const idleRouter = new Proxy({}, { get: () => idle });
  const api = {
    useUtils: () => ({ village: { getAlliances: { invalidate } } }),
    village: {
      get: {
        useQuery: () => ({
          data: { villageData: { kageId: "someone" } },
          isPending: false,
        }),
      },
      getAlliances: {
        useQuery: () => ({
          isPending: false,
          data: {
            villages: [
              village("home", "Home"),
              village("leaf", "Leaf"),
              village("closed", "Closed", { allianceSystem: false }),
              village("band", "Band", { type: "HIDEOUT" }),
            ],
            relationships: [],
            requests: [],
          },
        }),
      },
      acceptRequest: capture("acceptRequest"),
      rejectRequest: capture("rejectRequest"),
      cancelRequest: capture("cancelRequest"),
      createRequest: capture("createRequest"),
      leaveAlliance: capture("leaveAlliance"),
      declareEnemy: capture("declareEnemy"),
    },
    kage: new Proxy({ takeKage: capture("takeKage") } as Record<string, unknown>, {
      get: (target, name) => target[name as string] ?? idle,
    }),
  };
  Object.assign(vi.spyOn(client, "api" as never), api, {
    profile: idleRouter,
    clan: idleRouter,
    war: idleRouter,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("lists other alliance members, villages first, and refreshes alliances after each change", async () => {
  mount("Alliance", {});
  expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual(
    expect.arrayContaining(["Leaf", "Band"]),
  );
  const names = screen
    .getAllByRole("img")
    .map((image) => image.getAttribute("alt"))
    .filter((alt) => ["Home", "Leaf", "Closed", "Band"].includes(alt ?? ""));
  expect(names).toEqual(["Leaf", "Band"]);

  const procedures = [
    "acceptRequest",
    "rejectRequest",
    "cancelRequest",
    "createRequest",
    "leaveAlliance",
    "declareEnemy",
  ];
  for (const name of procedures) {
    await act(() => captured[name]!.onSuccess({ success: false, message: "No" }));
  }
  expect(invalidate).not.toHaveBeenCalled();
  for (const name of procedures) {
    await act(() => captured[name]!.onSuccess({ success: true, message: "Yes" }));
  }
  expect(invalidate).toHaveBeenCalledTimes(procedures.length);
  expect(toast.showMutationToast).toHaveBeenCalledTimes(procedures.length * 2);
});

it("offers senior staff who are not kage to take the kage seat", () => {
  mount("Kage", { role: "CODING-ADMIN" });
  expect(screen.getByRole("button", { name: "Take kage as Staff" })).toBeDefined();
  cleanup();
  mount("Kage", { role: "CODING-ADMIN", village: { kageId: "viewer" } });
  expect(screen.getByLabelText("Staff leadership")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Take kage as Staff" })).toBeNull();
  cleanup();
  mount("Kage", { role: "USER" });
  expect(screen.queryByLabelText("Staff leadership")).toBeNull();
});
