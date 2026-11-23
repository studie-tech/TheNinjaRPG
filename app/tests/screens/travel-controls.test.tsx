import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import * as navigation from "@/hooks/navigation";
import type { TravelSession } from "@/hooks/useTravelSession";
import * as hunting from "@/layout/HuntingArrival";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import * as position from "@/layout/TravelPositionLabel";
import * as war from "@/layout/WarFieldActions";
import type { UserWithRelations } from "@/routers/profile";
import { TravelNavigationContext } from "@/screens/travel/TravelNavigationContext";
import { TravelView } from "@/screens/travel/TravelView";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { fakeTrpcClient } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

const ApiProvider = client.api.Provider;
const queryClient = new QueryClient();
const transport = fakeTrpcClient((path, input) => {
  if (path === "stealth.useSensory") scan(input);
  return { success: false, message: "Not available in fixture" };
});
const activate = vi.fn();
const scan = vi.fn();
const setShowActive = vi.fn();
const setShowSorrounding = vi.fn();
const setActiveTab = vi.fn();
const setQuickTravelOpen = vi.fn();
const user = {
  userId: "traveller",
  username: "Traveller",
  villageId: "home",
  sector: 1,
  status: "AWAKE",
  rank: "JONIN",
  stealth: 0,
  sensory: 0,
  anbuId: "anbu",
} as NonNullable<UserWithRelations>;
const originalClientWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "clientWidth",
);

beforeEach(() => {
  vi.clearAllMocks();
  installBrowserGlobals({ resizeObserver: true });
  mockUserContextValue(() => ({
    data: user,
    timeDiff: 0,
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  }));
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    back: vi.fn(),
    push: vi.fn(),
  } as never);
  vi.spyOn(hunting, "HuntingArrival").mockReturnValue(null);
  vi.spyOn(position, "TravelPositionLabel").mockReturnValue(<span>0, 0</span>);
  vi.spyOn(jutsuLoadout, "default").mockReturnValue(null);
  vi.spyOn(itemLoadout, "default").mockReturnValue(null);
  vi.spyOn(war, "WarFieldActions").mockReturnValue(null);
  Object.assign(vi.spyOn(client, "api" as never), {
    stealth: {
      activateStealth: { useMutation: () => ({ mutate: activate, isPending: false }) },
      deactivateStealth: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      useSensory: { useMutation: () => ({ mutate: scan, isPending: false }) },
    },
  });
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get: () => 1200,
  });
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  queryClient.clear();
  vi.restoreAllMocks();
  if (originalClientWidth)
    Object.defineProperty(Element.prototype, "clientWidth", originalClientWidth);
  restoreBrowserGlobals();
});

function TravelFixture({
  global = false,
  tutorial = false,
  immersive = false,
}: {
  global?: boolean;
  tutorial?: boolean;
  immersive?: boolean;
}) {
  const quickTravelForm = useForm({ defaultValues: { sector: 1 } });
  const session = {
    userData: user,
    userRef: { current: user },
    villages: [],
    activeTab: global ? "Global" : "You",
    sectorLink: "You",
    globalLink: "Global",
    isGlobal: global,
    showSector: !global,
    showOtherUsers: true,
    currentSector: 1,
    hasCurrentSector: true,
    sectorNames: new Map(),
    pins: [],
    pinLabel: "",
    revealedPlayers: [],
    quickTravelForm,
    travelDestinations: [],
    canTravelTo: () => true,
    setShowActive,
    setShowSorrounding,
    setActiveTab,
    setQuickTravelOpen,
    setCameraFocusRevision: vi.fn(),
    tutorialRunning: tutorial,
  } as unknown as TravelSession;
  return (
    <ApiProvider client={transport} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TravelView session={session} immersive={immersive} />
      </QueryClientProvider>
    </ApiProvider>
  );
}

it("exposes direct sector actions and runs each action on its first click", async () => {
  const view = render(<TravelFixture />);
  expect(view.queryByRole("button", { name: "Map controls" })).toBeNull();
  for (const [name, action] of [
    ["Activate stealth", activate],
    ["Scan sector", scan],
    ["Show other players on the map", setShowActive],
    ["Scout surrounding sectors", setShowSorrounding],
    ["Quick Travel", setQuickTravelOpen],
  ] as const) {
    fireEvent.click(view.getByRole("button", { name }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  }
  expect(scan).toHaveBeenCalledWith({ sector: 1 });
  expect(view.getByRole("button", { name: "Caravans" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Start auto-attack" })).toBeTruthy();
});

it("exposes global tools directly and retains the guided Global tab", () => {
  const view = render(<TravelFixture global />);
  expect(view.getByRole("button", { name: "Find a sector" })).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Show sector ownerships and factions" }),
  ).toBeTruthy();
  expect(view.queryByRole("button", { name: "Scan sector" })).toBeNull();
  view.rerender(<TravelFixture tutorial />);
  expect(view.queryByRole("button", { name: "Caravans" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Global" }));
  expect(setActiveTab).toHaveBeenCalledWith("Global");
});

it("keeps labeled map actions behind the experimental layout's own bottom-menu trigger", () => {
  const controls = document.createElement("div");
  document.body.append(controls);
  try {
    const view = render(
      <TravelNavigationContext value={{ controls, view: null }}>
        <TravelFixture immersive />
      </TravelNavigationContext>,
    );
    expect(view.queryByRole("button", { name: "Scan sector" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Map controls" }));
    expect(view.getByRole("button", { name: "Scan sector" })).toBeTruthy();
    expect(view.getByText("Sensory scan")).toBeTruthy();
    expect(view.getByRole("button", { name: "Activate stealth" })).toBeTruthy();
    expect(view.getByText("Scout surrounding sectors")).toBeTruthy();
  } finally {
    controls.remove();
  }
});
