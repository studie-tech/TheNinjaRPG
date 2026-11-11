import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useMutation,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import HuntingEditor from "@/app/[shell]/manual/hunting/page";
import * as ContentBox from "@/layout/ContentBox";
import * as UserContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { huntingHabitatContent } from "../../setup/hunting";

type SaveInput = RouterInputs["hunting"]["save"];
type SaveResult = RouterOutputs["hunting"]["save"];

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
});
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

it("uses server-assigned contract IDs when saving the habitat draft again", async () => {
  const content = { ...huntingHabitatContent(), contracts: [] };
  const refetch = vi.fn(async () => undefined);
  const save = vi.fn(
    async (input: SaveInput): Promise<SaveResult> => ({
      success: true,
      message: "Habitat saved.",
      id: "forest",
      content: {
        ...input.content,
        contracts: input.content.contracts.map((c) => ({ ...c, id: "saved-contract" })),
      },
    }),
  );
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      hunting: {
        getBoard: { invalidate: async () => undefined },
        getSession: { invalidate: async () => undefined },
      },
    }),
    hunting: {
      getAll: { useQuery: () => ({ data: [{ id: "forest", content }], refetch }) },
      save: {
        useMutation: (options: UseMutationOptions<SaveResult, Error, SaveInput>) =>
          useMutation({ ...options, mutationFn: save }),
      },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    profile: {
      getAllAiNames: {
        useQuery: () => ({ data: [{ userId: "enemy", username: "Enemy" }] }),
      },
    },
    item: {
      getAllNames: {
        useQuery: () => ({
          data: [{ id: "hide", name: "Boar hide", canBeHunted: true }],
        }),
      },
    },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { role: "CONTENT-ADMIN" },
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
  );
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HuntingEditor />
    </QueryClientProvider>,
  );
  const habitatPicker = view.getByRole("combobox", { name: "Edit existing habitat" });
  fireEvent.keyDown(habitatPicker, { key: "Enter" });
  await act(async () =>
    fireEvent.click(await view.findByRole("option", { name: content.name })),
  );
  await waitFor(() => expect(document.activeElement).toBe(habitatPicker));
  fireEvent.click(view.getByRole("button", { name: "Add creature contract" }));
  for (const [label, value] of [
    ["Contract name", "Boar"],
    ["Combat difficulty", "Easy"],
  ]) {
    fireEvent.change(view.getByLabelText(label!), { target: { value } });
  }
  for (const [label, search, option] of [
    ["Creature", "enem", "Enemy"],
    ["Material", "hide", "Boar hide"],
  ]) {
    fireEvent.click(view.getByRole("combobox", { name: label }));
    fireEvent.change(
      view.getByRole("combobox", { name: `Search ${label!.toLowerCase()}` }),
      { target: { value: search } },
    );
    const selectedOption = await view.findByRole("option", { name: option });
    await act(async () => fireEvent.click(selectedOption));
    const trigger = view.getByRole("combobox", { name: label });
    expect(trigger.textContent).toContain(option!);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Radix restores focus after closing; finish that before opening the next picker.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  }
  const button = view.getByRole("button", {
    name: "Save habitat",
  }) as HTMLButtonElement;
  fireEvent.click(button);
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(save.mock.calls[0]![0].content.contracts[0]!.id).not.toBe("saved-contract");
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0]).toMatchObject({
    id: "forest",
    content: { contracts: [{ id: "saved-contract" }] },
  });
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));
  queryClient.clear();
});
