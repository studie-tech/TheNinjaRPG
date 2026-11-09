import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as navigation from "@/hooks/navigation";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as Modal from "@/layout/Modal";
import Tournament from "@/layout/Tournament";
import type { UserWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";
import * as uploadthing from "@/utils/uploadthing";

const createTournament = vi.fn();

beforeEach(() => {
  createTournament.mockClear();
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ tournament: { getTournament: { invalidate: vi.fn() } } }),
    tournament: {
      getTournament: { useQuery: () => ({ data: undefined }) },
      createTournament: {
        useMutation: () => ({ mutate: createTournament, isPending: false }),
      },
      joinTournament: { useMutation: mutation },
      joinMatch: { useMutation: mutation },
    },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ timeDiff: 0 } as never);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({} as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ topRightContent, children }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  vi.spyOn(Avatar, "default").mockImplementation(() => null);
  vi.spyOn(uploadthing, "UploadButton").mockImplementation((() => null) as never);
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, onAccept, children }) =>
    isOpen ? (
      <div role="dialog">
        <button type="button" onClick={onAccept}>
          Proceed
        </button>
        {children}
      </div>
    ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    <Tournament
      userData={{ userId: "me" } as NonNullable<UserWithRelations>}
      tournamentId="clan-1"
      rewards={{} as never}
      canCreate
      title="Clan Tournament"
      subtitle="Fight for glory"
      type="CLAN"
    />,
  );

it("validates the create dialog and shows field errors instead of sending bad input", async () => {
  const view = mount();
  fireEvent.click(view.container.querySelector("#create-tournament")!);
  fireEvent.change(screen.getByPlaceholderText("Name of the new tournament"), {
    target: { value: "ab" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
  await waitFor(() =>
    expect(
      [...view.container.querySelectorAll('[data-slot="form-message"]')].map(
        (message) => message.textContent,
      ),
    ).toEqual([expect.stringContaining("3"), expect.stringContaining("3")]),
  );
  expect(createTournament).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText("Name of the new tournament"), {
    target: { value: "Spring Cup" },
  });
  fireEvent.change(screen.getByPlaceholderText("Description of tournament"), {
    target: { value: "Clan brawl" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
  await waitFor(() => expect(createTournament).toHaveBeenCalledTimes(1));
  expect(createTournament.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ name: "Spring Cup", description: "Clan brawl" }),
  );
});
