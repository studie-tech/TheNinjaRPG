import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useMutation,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import * as client from "@/app/_trpc/client";
import Simulator from "@/app/[shell]/manual/damage_calcs/[[...damageSimulationId]]/page";
import * as ContentBox from "@/layout/ContentBox";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

type Result = { success: boolean; message: string };

let queryClient: QueryClient;
let resolveSave: (result: Result) => void;
const save = vi.fn(
  (_input: unknown) =>
    new Promise<Result>((resolve) => {
      resolveSave = resolve;
    }),
);
const refetch = vi.fn(async () => undefined);
const noMutation = () => ({ mutate: vi.fn(), isPending: false });

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { userId: "u", role: "USER" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    misc: { getDmgConfig: { useQuery: () => ({ data: undefined }) } },
    simulator: {
      getDamageSimulations: { useQuery: () => ({ data: [], refetch }) },
      getDamageSimulation: { useQuery: () => ({ data: undefined }) },
      createDamageSimulation: {
        useMutation: (options: UseMutationOptions<Result, Error, unknown>) =>
          useMutation({ ...options, mutationFn: save }),
      },
      updateDamageSimulation: { useMutation: noMutation },
      deleteDamageSimulation: { useMutation: noMutation },
    },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("reports the outcome of saving a calculation and refreshes the history on success", async () => {
  const params = Promise.resolve({});
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <Simulator params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  fireEvent.click(view!.getByRole("button", { name: "Save Calculation" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = { success: true, message: "Damage simulation saved" };
  await act(async () => {
    resolveSave(saved);
  });
  await waitFor(() => expect(toast.showMutationToast).toHaveBeenCalledWith(saved));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it("recalculates the damage when formula parameters change, including a damage of 0", async () => {
  const params = Promise.resolve({});
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <Simulator params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  const damage = () => view!.queryByText(/^Damage: /)?.textContent;
  const initial = damage();
  expect(initial).not.toBe("Damage: 0");
  fireEvent.input(view!.getByLabelText("base_hits"), { target: { value: "1" } });
  await waitFor(() => expect(damage()).not.toBe(initial));
  fireEvent.input(view!.getByLabelText("ep_normalization"), {
    target: { value: "1000000000" },
  });
  await waitFor(() => expect(damage()).toBe("Damage: 0"));
});
