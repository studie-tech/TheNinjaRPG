import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import * as client from "@/app/_trpc/client";
import type { UserStatus } from "@/drizzle/constants";
import { QuestTeams } from "@/layout/QuestTeams";
import * as TeamChatPanel from "@/layout/TeamChatPanel";
import { AUTO_WAKE_MESSAGE, actionStatusMessage } from "@/libs/actionReadiness";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

type Options = {
  onMutate: () => number | undefined;
  onSuccess: (
    result: UserDeltaResponse,
    variables: unknown,
    revision: number | undefined,
  ) => Promise<void>;
};

const previousCustomEvent = globalThis.CustomEvent;

const mutation = () => {
  let respond: (result: UserDeltaResponse) => Promise<void>;
  const mutate = vi.fn();
  return {
    mutate,
    useMutation: (options: Options) => {
      const [isPending, setPending] = useState(false);
      const revision = useRef<number | undefined>(undefined);
      respond = async (result) => {
        await options.onSuccess(result, undefined, revision.current);
        setPending(false);
      };
      return {
        isPending,
        mutate: (input: unknown) => {
          revision.current = options.onMutate();
          mutate(input);
          setPending(true);
        },
      };
    },
    respond: (result: UserDeltaResponse) => respond(result),
  };
};
const create = mutation();
const join = mutation();
const start = mutation();
const updateUser = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);
const encounterLocation = { sector: 50, longitude: 12, latitude: 13 };
const encounterTeam = () => ({
  id: "team",
  questId: "quest",
  name: "Team",
  leaderId: "ninja",
  maxPlayers: 3,
  members: [
    {
      userId: "ninja",
      username: "Leader",
      status: "AWAKE" as UserStatus,
      ...encounterLocation,
    },
    {
      userId: "helper",
      username: "Helper",
      status: "AWAKE" as UserStatus,
      ...encounterLocation,
    },
  ],
  encounterLocation: { ...encounterLocation },
  hasEncounter: true,
  completed: false,
  failed: false,
  battleId: null,
  version: 1,
  isPublic: true,
});
let current: ReturnType<typeof encounterTeam> | null;
let actor: {
  userId: string;
  status: UserStatus;
  autoWakeUp: boolean;
} & typeof encounterLocation;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.CustomEvent = window.CustomEvent;
  current = null;
  actor = {
    userId: "ninja",
    status: "HOSPITALIZED",
    autoWakeUp: true,
    ...encounterLocation,
  };
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: actor,
    prepareUserUpdate: () => 7,
    updateUser,
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(TeamChatPanel, "TeamChatPanel").mockImplementation(() => null);
  const inactive = { useMutation: () => ({ isPending: false }) };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      coop: { quest: { overview: { invalidate } } },
      quests: {
        specificQuests: { invalidate },
        getPendingRewardChoices: { invalidate },
      },
    }),
    coop: {
      quest: {
        overview: {
          useQuery: () => ({
            data: {
              current,
              teams: [
                {
                  id: "team",
                  questId: "quest",
                  name: "Team",
                  maxPlayers: 3,
                  members: [],
                  invited: false,
                },
              ],
            },
            isPending: false,
          }),
        },
        create,
        join,
        leave: inactive,
        invite: inactive,
        remove: inactive,
        disband: inactive,
        startEncounter: start,
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.CustomEvent = previousCustomEvent;
});

for (const questId of [undefined, "quest"]) {
  it(`explains the active team's captured capacity ${questId ? "within its quest" : "on the team page"}`, async () => {
    current = { ...encounterTeam(), maxPlayers: 8 };
    const view = render(<QuestTeams questId={questId} maxPlayers={4} />);
    expect(view.getByText("2/8 members · Public team")).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "How quest teams work" }));
    });
    expect(
      view.getByText(
        "Up to 8 players share every objective, even when joining mid-quest.",
      ),
    ).toBeTruthy();
  });
}

it("explains a specific quest's configured capacity before forming a team", async () => {
  const view = render(<QuestTeams questId="quest" maxPlayers={6} />);
  expect(view.getByText("Share quest progress with up to 6 players.")).toBeTruthy();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "How quest teams work" }));
  });
  expect(
    view.getByText(
      "Up to 6 players share every objective, even when joining mid-quest.",
    ),
  ).toBeTruthy();
});

it("keeps general team discovery guidance independent of quest capacity", async () => {
  const view = render(<QuestTeams />);
  expect(view.getByText("Find a team to share quest progress.")).toBeTruthy();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "How quest teams work" }));
  });
  expect(
    view.getByText("Teammates share every objective, even when joining mid-quest."),
  ).toBeTruthy();
  expect(view.queryByText(/Up to 3 players/)).toBeNull();
});

for (const status of ["ASLEEP", "HOSPITALIZED"] as const) {
  it(`offers an encounter attempt to the recoverable ${status} leader without changing roster status`, () => {
    current = encounterTeam();
    actor.status = status;
    current.members[0]!.status = status;
    const view = render(<QuestTeams questId="quest" />);
    expect(view.getByRole("status").textContent).toContain(
      "Ready to attempt the team encounter.",
    );
    expect(view.getByRole("list", { name: "Party members" }).textContent).toContain(
      status === "ASLEEP" ? "Asleep" : "Hospitalized",
    );
    fireEvent.click(view.getByRole("button", { name: "Start Team Encounter" }));
    expect(start.mutate).toHaveBeenCalledWith({ partyId: "team" });
  });
}

for (const status of ["ASLEEP", "BATTLE", "TRAVEL", "QUEUED"] as const) {
  it(`keeps the ${status} leader in the waiting hint when recovery is unavailable`, () => {
    current = encounterTeam();
    actor.status = status;
    actor.autoWakeUp = false;
    current.members[0]!.status = status;
    const view = render(<QuestTeams questId="quest" />);
    expect(view.getByRole("status").textContent).toContain("Waiting for: Leader.");
  });
}

for (const status of ["ASLEEP", "HOSPITALIZED"] as const) {
  it(`keeps ${status} teammates in the leader's waiting hint`, () => {
    current = encounterTeam();
    actor.status = "ASLEEP";
    current.members[0]!.status = "ASLEEP";
    current.members[1]!.status = status;
    const view = render(<QuestTeams questId="quest" />);
    expect(view.getByRole("status").textContent).toContain(
      "Waiting for: Helper. They must be awake at the encounter location.",
    );
  });

  it(`does not project recovery for the ${status} viewer who is not the leader`, () => {
    current = encounterTeam();
    actor.userId = "helper";
    actor.status = status;
    current.members[1]!.status = status;
    const view = render(<QuestTeams questId="quest" />);
    expect(view.getByRole("status").textContent).toContain("Waiting for: Helper.");
    expect(view.queryByRole("button", { name: "Start Team Encounter" })).toBeNull();
  });
}

for (const memberIndex of [0, 1]) {
  for (const coordinate of ["sector", "longitude", "latitude"] as const) {
    it(`keeps member ${memberIndex} waiting when their ${coordinate} differs from the encounter`, () => {
      current = encounterTeam();
      actor.status = "ASLEEP";
      current.members[0]!.status = "ASLEEP";
      const member = current.members[memberIndex]!;
      member[coordinate] += 1;
      if (memberIndex === 0) actor[coordinate] += 1;
      const view = render(<QuestTeams questId="quest" />);
      expect(view.getByRole("status").textContent).toContain(
        `Waiting for: ${member.username}.`,
      );
    });
  }
}

for (const [label, action] of [
  ["Form Quest Team", create],
  ["Join Team", join],
] as const) {
  it(`offers recovery beside a rejected ${label} and allows retry`, async () => {
    const view = render(<QuestTeams questId="quest" />);
    fireEvent.click(view.getByRole("button", { name: label }));
    expect(
      (
        view.getByRole("button", {
          name: label === "Form Quest Team" ? "Forming..." : label,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(() =>
      action.respond({ success: false, message: actionStatusMessage("HOSPITALIZED") }),
    );
    expect(view.getByRole("alert").textContent).toContain(
      actionStatusMessage("HOSPITALIZED"),
    );
    expect(
      view.getByRole("link", { name: "Go to hospital" }).getAttribute("href"),
    ).toBe("/hospital");
    expect(
      (view.getByRole("button", { name: label }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(toast.showMutationToast).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: label }));
    await act(() =>
      action.respond({ success: false, message: "Quest is unavailable" }),
    );
    expect(view.getByRole("alert").textContent).toBe("Quest is unavailable");
    expect(view.queryByRole("link", { name: "Go to hospital" })).toBeNull();
  });

  it(`retains one merged recovery notice after a rejected ${label}`, async () => {
    const view = render(<QuestTeams questId="quest" />);
    fireEvent.click(view.getByRole("button", { name: label }));
    await act(() =>
      action.respond({
        success: false,
        message: `Quest is unavailable ${AUTO_WAKE_MESSAGE}`,
        actionNotice: AUTO_WAKE_MESSAGE,
      }),
    );
    expect(view.getByRole("alert").textContent).toBe(
      `Quest is unavailable ${AUTO_WAKE_MESSAGE}`,
    );
    expect(view.queryByRole("link", { name: "Go to hospital" })).toBeNull();
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ actionNotice: AUTO_WAKE_MESSAGE }),
      { revision: 7, refetch: false },
    );
    expect(toast.showMutationToast).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
}

it("keeps available quest team setup behind its action and submits the chosen privacy", () => {
  const view = render(<QuestTeams questId="quest" asAction />);
  expect(view.queryByRole("button", { name: "Form Quest Team" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Play with a team" }));
  fireEvent.click(view.getByRole("switch", { name: "Public team" }));
  fireEvent.click(view.getByRole("button", { name: "Form Quest Team" }));
  expect(create.mutate).toHaveBeenCalledWith({ questId: "quest", isPublic: true });
});

it("keeps joining available teams accessible from the quest action", () => {
  const view = render(<QuestTeams questId="quest" asAction />);
  fireEvent.click(view.getByRole("button", { name: "Play with a team" }));
  fireEvent.click(view.getByRole("button", { name: "Join Team" }));
  expect(join.mutate).toHaveBeenCalledWith({ partyId: "team" });
});
