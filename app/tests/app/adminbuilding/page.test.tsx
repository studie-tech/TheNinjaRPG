import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import AdministrationBuilding from "@/app/[shell]/adminbuilding/page";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as Logbook from "@/layout/Logbook";
import * as Modal from "@/layout/Modal";
import * as QuestTeams from "@/layout/QuestTeams";
import * as UserContext from "@/utils/UserContext";

const startQuest = vi.fn();
const namesQuery = vi.fn();
const hallQuery = vi.fn();

const event = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id,
  questType: "event",
  teamEnabled: false,
  content: { objectives: [], reward: {} },
  entryRequirements: [] as {
    itemId: string;
    name: string;
    quantity: number;
    owned: number;
  }[],
  ...overrides,
});

const paidEvent = (owned: number) =>
  event("Paid Event", {
    content: {
      objectives: [],
      reward: {},
      entryItems: [{ ids: ["ticket"], number: 2 }],
    },
    entryRequirements: [{ itemId: "ticket", name: "ticket", quantity: 2, owned }],
  });

const setup = (hallData: ReturnType<typeof event>[], userQuests: unknown[] = []) => {
  hallQuery.mockReturnValue({ data: hallData });
  namesQuery.mockImplementation((_input: unknown, options: { enabled: boolean }) => ({
    data: options.enabled ? [{ id: "ticket", name: "Event Ticket" }] : undefined,
  }));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ quests: { allianceBuilding: { invalidate: vi.fn() } } }),
    item: { getAllNames: { useQuery: namesQuery } },
    quests: {
      allianceBuilding: { useQuery: hallQuery },
      startQuest: { useMutation: () => ({ mutate: startQuest, isPending: false }) },
    },
  });
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: {
      sector: 3,
      level: 10,
      rank: "GENIN",
      villageId: "home",
      userQuests,
      questData: [],
    },
    access: true,
    updateUser: vi.fn(),
    prepareUserUpdate: vi.fn(),
  } as never);
  return render(<AdministrationBuilding />);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(Logbook, "LogbookEntry").mockImplementation(() => null);
  vi.spyOn(ItemWithEffects, "default").mockImplementation(
    ({ footer }: { footer?: ReactNode }) => <div>{footer}</div>,
  );
  vi.spyOn(QuestTeams, "QuestTeams").mockImplementation(({ teamEnabled }) =>
    teamEnabled ? <p>Quest team controls</p> : null,
  );
  vi.spyOn(Modal, "default").mockImplementation(
    ({ isOpen, title, children, onAccept }) =>
      isOpen ? (
        <div>
          <h2>{title}</h2>
          {children}
          <button type="button" onClick={(e) => onAccept?.(e)}>
            Proceed
          </button>
        </div>
      ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

describe("Administration Building", () => {
  it("confirms the entry cost before starting an event with entry items", () => {
    setup([paidEvent(2)]);
    open("Paid Event");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Take Quest" }).at(-1) as HTMLElement,
    );
    expect(startQuest).not.toHaveBeenCalled();
    expect(screen.getByText("Start Paid Event?")).toBeTruthy();
    expect(screen.getByText("2× Event Ticket")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
    expect(startQuest).toHaveBeenCalledWith({
      questId: "Paid Event",
      userSector: 3,
      supportsAnnouncements: true,
    });
  });

  it("shows the carried count and blocks an entry the player cannot pay for", () => {
    setup([paidEvent(1)]);
    open("Paid Event");
    expect(
      screen.getByText("Event Ticket: 1 / 2 owned. Consumed on entry."),
    ).toBeTruthy();
    const take = screen
      .getAllByRole("button", { name: "Take Quest" })
      .at(-1) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    fireEvent.click(take);
    expect(startQuest).not.toHaveBeenCalled();
    expect(screen.queryByText("Start Paid Event?")).toBeNull();
  });

  it("rereads owned counts each visit, since other pages change the inventory", () => {
    setup([paidEvent(1)]);
    expect(hallQuery.mock.lastCall?.[1]).toMatchObject({ refetchOnMount: "always" });
  });

  it("starts free events directly without loading item names", () => {
    setup([event("Free Event")]);
    open("Free Event");
    fireEvent.click(screen.getByRole("button", { name: "Take Quest" }));
    expect(startQuest).toHaveBeenCalledTimes(1);
    expect(namesQuery).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });

  it("offers quest teams on team-enabled events only", () => {
    setup([event("Solo Event"), event("Team Event", { teamEnabled: true })]);
    open("Solo Event");
    expect(screen.queryByText("Quest team controls")).toBeNull();
    open("Team Event");
    expect(screen.getByText("Quest team controls")).toBeTruthy();
  });

  it("opens the running event rather than a finished one by default", () => {
    const finished = {
      quest: { name: "Old Event", questType: "event" },
      endAt: new Date(0),
    };
    const running = { quest: { name: "New Event", questType: "event" }, endAt: null };
    setup([event("Old Event"), event("New Event")], [finished, running]);
    expect(
      screen.getByRole("button", { name: /Old Event/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /New Event/ }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("opens nothing by default when every event has finished", () => {
    const finished = {
      quest: { name: "Old Event", questType: "event" },
      endAt: new Date(0),
    };
    setup([event("Old Event")], [finished]);
    expect(
      screen.getByRole("button", { name: /Old Event/ }).getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
