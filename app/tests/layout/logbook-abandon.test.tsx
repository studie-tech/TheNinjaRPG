import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import type { QuestType, UserRole } from "@/drizzle/constants";
import { QuestTypes } from "@/drizzle/constants";
import * as logbook from "@/layout/Logbook";
import * as Modal from "@/layout/Modal";
import { canAbandonQuestType } from "@/utils/permissions";
import * as UserContext from "@/utils/UserContext";

type EntryProps = ComponentProps<typeof logbook.LogbookEntry>;

const abandon = vi.fn(async () => ({ success: true, message: "Quest abandoned" }));
const procedure = {
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: abandon, isPending: false }),
};
/** Router whose procedures are idle, so the entry renders without a server. */
const router = (): unknown =>
  new Proxy(procedure, {
    get: (target, name) => target[name as keyof typeof procedure] ?? router(),
  });

let attempts = 0;
/** Render one quest attempt, each under its own identity since abandoning is remembered. */
const renderEntry = (
  questType: QuestType,
  role: UserRole = "USER",
  props: Partial<EntryProps> = {},
  startedAt: Date | null = new Date(0),
) => {
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "viewer", role, status: "AWAKE", dailyMissions: 0 },
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  } as never);
  attempts += 1;
  const id = `attempt-${attempts}`;
  const quest = {
    id,
    name: "Contract",
    questType,
    description: "",
    content: { objectives: [], reward: {} },
  };
  return render(
    <logbook.LogbookEntry
      userQuest={{ id, questId: id, quest, startedAt, completed: 0 } as never}
      tracker={{ id, goals: [] } as never}
      hideTitle
      {...props}
    />,
  );
};
const abandonButton = () => screen.queryByRole("button", { name: "Abandon Contract" });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => router(),
    gameAsset: router(),
    quests: router(),
  });
  vi.spyOn(logbook, "useCheckRewards").mockReturnValue({
    checkRewards: vi.fn(),
    isCheckingRewards: false,
  } as never);
  vi.spyOn(Modal, "default").mockImplementation((({
    isOpen,
    onAccept,
    proceed_label,
    children,
  }: {
    isOpen: boolean;
    onAccept?: (event: { preventDefault: () => void }) => void;
    proceed_label?: string;
    children: ReactNode;
  }) =>
    isOpen ? (
      <section>
        {children}
        <button type="button" onClick={(event) => onAccept?.(event)}>
          {proceed_label}
        </button>
      </section>
    ) : null) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("logbook abandon control", () => {
  it.each(QuestTypes)(
    "offers a regular player abandon on %s per the shared rule",
    (questType) => {
      renderEntry(questType);
      expect(!!abandonButton()).toBe(canAbandonQuestType("USER", questType));
    },
  );

  it("keeps ANBU quests locked for regular players and open to staff", () => {
    const view = renderEntry("anbu");
    expect(abandonButton()).toBeNull();
    view.unmount();
    renderEntry("anbu", "CONTENT");
    expect(abandonButton()).toBeTruthy();
  });

  it("hides the control in the compact panel and without a recorded start", () => {
    const view = renderEntry("mission", "USER", { compact: true });
    expect(abandonButton()).toBeNull();
    view.unmount();
    renderEntry("mission", "USER", {}, null);
    expect(abandonButton()).toBeNull();
  });

  it("confirms before abandoning, then removes the control", async () => {
    renderEntry("mission");
    fireEvent.click(abandonButton() as HTMLElement);
    expect(abandon).not.toHaveBeenCalled();
    expect(
      screen.getByText("This attempt still counts toward your daily limit."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abandon quest" }));
    await waitFor(() => expect(abandon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(abandonButton()).toBeNull());
  });
});
