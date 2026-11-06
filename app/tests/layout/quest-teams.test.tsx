import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { useRef, useState } from "react";
import * as client from "@/app/_trpc/client";
import { QuestTeams } from "@/layout/QuestTeams";
import { actionStatusMessage, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

type Options = {
  onMutate: () => number | undefined;
  onSuccess: (result: UserDeltaResponse, variables: unknown, revision: number | undefined) => Promise<void>;
};

const mutation = () => {
  let respond: (result: UserDeltaResponse) => Promise<void>;
  const mutate = vi.fn();
  return {
    mutate,
    useMutation: (options: Options) => {
      const [isPending, setPending] = useState(false);
      const revision = useRef<number | undefined>(undefined);
      respond = async (result) => { await options.onSuccess(result, undefined, revision.current); setPending(false); };
      return { isPending, mutate: (input: unknown) => { revision.current = options.onMutate(); mutate(input); setPending(true); } };
    },
    respond: (result: UserDeltaResponse) => respond(result),
  };
};
const create = mutation();
const join = mutation();
const updateUser = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "ninja", status: "HOSPITALIZED" },
    prepareUserUpdate: () => 7,
    updateUser,
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  const inactive = { useMutation: () => ({ isPending: false }) };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ coop: { quest: { overview: { invalidate } } }, quests: { specificQuests: { invalidate }, getPendingRewardChoices: { invalidate } } }),
    coop: { quest: {
      overview: { useQuery: () => ({ data: { current: null, teams: [{ id: "team", questId: "quest", name: "Team", members: [], invited: false }] }, isPending: false }) },
      create, join, leave: inactive, invite: inactive, remove: inactive, disband: inactive, startEncounter: inactive,
    } },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const [label, action] of [["Form Quest Team", create], ["Join Team", join]] as const) {
  it(`offers recovery beside a rejected ${label} and allows retry`, async () => {
    const view = render(<QuestTeams questId="quest" />);
    fireEvent.click(view.getByRole("button", { name: label }));
    expect((view.getByRole("button", { name: label === "Form Quest Team" ? "Forming..." : label }) as HTMLButtonElement).disabled).toBe(true);
    await act(() => action.respond({ success: false, message: actionStatusMessage("HOSPITALIZED") }));
    expect(view.getByRole("alert").textContent).toContain(actionStatusMessage("HOSPITALIZED"));
    expect(view.getByRole("link", { name: "Go to hospital" }).getAttribute("href")).toBe("/hospital");
    expect((view.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(toast.showMutationToast).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: label }));
    await act(() => action.respond({ success: false, message: "Quest is unavailable" }));
    expect(view.getByRole("alert").textContent).toBe("Quest is unavailable");
    expect(view.queryByRole("link", { name: "Go to hospital" })).toBeNull();
  });

  it(`retains one merged recovery notice after a rejected ${label}`, async () => {
    const view = render(<QuestTeams questId="quest" />);
    fireEvent.click(view.getByRole("button", { name: label }));
    await act(() => action.respond({ success: false, message: `Quest is unavailable ${AUTO_WAKE_MESSAGE}`, actionNotice: AUTO_WAKE_MESSAGE }));
    expect(view.getByRole("alert").textContent).toBe(`Quest is unavailable ${AUTO_WAKE_MESSAGE}`);
    expect(view.queryByRole("link", { name: "Go to hospital" })).toBeNull();
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ actionNotice: AUTO_WAKE_MESSAGE }), { revision: 7, refetch: false });
    expect(toast.showMutationToast).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
}
