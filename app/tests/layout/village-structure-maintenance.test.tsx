import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import { getStructureMaintenanceUserUpdate } from "@/deltas/kage";
import * as ContentBox from "@/layout/ContentBox";
import { VillageStructureMaintenance } from "@/layout/VillageStructureMaintenance";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const api = createTRPCReact<AppRouter>();
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  Object.assign(vi.spyOn(appClient, "api" as never), {
    village: api.village,
    kage: api.kage,
    useUtils: api.useUtils,
  });
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <section>{children}</section>
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it.each(["confirmed", "changed bill", "dropped response"])(
  "shows recoverable maintenance feedback after %s",
  async (outcome) => {
    const village = {
      id: "home",
      kageId: "owner",
      tokens: 500,
      structureMaintenanceDue: 200,
      structures: [],
    };
    const user = {
      userId: "owner",
      villageId: "home",
      village,
      status: "AWAKE",
      rank: "JONIN",
      level: 50,
      experience: 100,
      earnedExperience: 100,
      isOutlaw: false,
    };
    const profileKey = getQueryKey(api.profile.getUser, undefined, "query");
    client.setQueryData(profileKey, { userData: user });
    vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
      () =>
        ({
          data: user,
          prepareUserUpdate: () => prepareUserUpdate(client, profileKey),
          updateUser: (
            patch: Parameters<typeof updateUserCache>[2],
            options: Parameters<typeof updateUserCache>[3],
          ) => updateUserCache(client, profileKey, patch, options),
        }) as never,
    );
    const getVillage = vi.fn(() => ({ villageData: village, sectorCount: 3 }));
    const getProfile = vi.fn(() => ({ userData: user }));
    let settle!: () => void;
    const pay = vi.fn(async (_input: unknown) => {
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      if (outcome === "dropped response")
        throw new Error("Connection lost; please retry.");
      if (outcome === "changed bill") {
        village.structureMaintenanceDue = 300;
        return { success: false, message: "The bill changed. Refresh and try again." };
      }
      return {
        success: true,
        message: "Structure maintenance paid",
        ...getStructureMaintenanceUserUpdate("home", 200),
      };
    });
    const trpc = api.createClient({
      links: [
        () =>
          ({ op }) =>
            observable((observer) => {
              const respond = async () => {
                if (op.path === "village.get") return getVillage();
                if (op.path === "profile.getUser") return getProfile();
                if (op.path === "kage.payStructureMaintenance") return pay(op.input);
                throw new Error(`Unexpected procedure ${op.path}`);
              };
              void respond().then(
                (value) => {
                  observer.next({ result: { data: value } });
                  observer.complete();
                },
                (error) => observer.error(error),
              );
            }),
      ],
    });
    const view = render(
      <api.Provider client={trpc} queryClient={client}>
        <QueryClientProvider client={client}>
          <VillageStructureMaintenance villageId="home" />
        </QueryClientProvider>
      </api.Provider>,
    );
    // The profile observer records recovery requested by UserContext's cache API.
    const stop = new QueryObserver(client, {
      queryKey: profileKey,
      queryFn: getProfile,
    }).subscribe(() => {});
    try {
      fireEvent.click(await view.findByRole("button", { name: "Pay maintenance" }));
      await view.findByRole("button", { name: "Paying..." });
      expect(pay).toHaveBeenCalledWith({ villageId: "home", expectedDue: 200 });
      await act(async () => settle());
      if (outcome === "confirmed") {
        await view.findByText("Maintenance is up to date");
        expect(view.getByRole("status").textContent).toBe("Structure maintenance paid");
        expect(getVillage).toHaveBeenCalledTimes(1);
        expect(getProfile).not.toHaveBeenCalled();
        expect(client.getQueryData(profileKey)).toMatchObject({
          userData: { village: { tokens: 300, structureMaintenanceDue: 0 } },
        });
      } else {
        await waitFor(() =>
          expect(
            (view.getByRole("button", { name: "Pay maintenance" }) as HTMLButtonElement)
              .disabled,
          ).toBe(false),
        );
        expect(view.getByRole("status").textContent).toContain(
          outcome === "changed bill" ? "bill changed" : "Connection lost",
        );
        expect(getVillage).toHaveBeenCalledTimes(2);
        expect(getProfile).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(profileKey)).toMatchObject({
          userData: { village: { tokens: 500 } },
        });
      }
    } finally {
      stop();
    }
  },
);
