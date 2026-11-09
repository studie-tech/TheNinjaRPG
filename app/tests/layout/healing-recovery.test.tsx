import { afterEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as popover from "@/components/ui/popover";
import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import * as Avatar from "@/layout/Avatar";
import HealingPopover from "@/layout/HealingPopover";
import * as Image from "@/layout/Image";
import type { SectorUser } from "@/libs/sector-map/world-types";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type HealResult = RouterOutputs["hospital"]["userHeal"];

it.each(["ASLEEP", "HOSPITALIZED"] as const)(
  "applies recovered %s pools and the nested healer projection in one cache update",
  async (status) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    const user = {
      userId: "healer",
      status,
      autoWakeUp: true,
      curHealth: 5,
      maxHealth: 100,
      curChakra: 100,
      maxChakra: 100,
      curStamina: 7,
      maxStamina: 100,
      regeneration: 1,
      regenAt: new Date(),
      medicalExperience: 10,
      experience: 50,
      questData: [],
      userQuests: [],
      rank: "JONIN",
    } as unknown as NonNullable<UserWithRelations>;
    const initial = { userData: user, notifications: [] };
    cache.setQueryData(key, initial);
    const read = vi.fn(async () => initial);
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: read,
    });
    const unsubscribe = observer.subscribe(() => {});
    let callbacks!: {
      onMutate: () => number | undefined;
      onSuccess: (
        data: HealResult,
        variables: unknown,
        revision: number | undefined,
      ) => Promise<void>;
    };
    const result: HealResult = {
      success: true,
      message: "Target healed",
      actionNotice: "Recovered",
      userRecovery: {
        userId: "healer",
        userPatch: {
          status: "AWAKE",
          curHealth: 100,
          curChakra: 100,
          curStamina: 100,
          experience: 75,
        },
      },
      healer: {
        curHealth: 100,
        curChakra: 90,
        curStamina: 100,
        curEnergy: 100,
        maxEnergy: 100,
        regenAt: new Date(),
        medicalExperience: 20,
        questData: [],
      },
    };
    const heal = vi.fn(async () =>
      callbacks.onSuccess(result, {}, callbacks.onMutate()),
    );
    const invalidateProfile = vi.fn(async () => undefined);
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({
        profile: { getUser: { invalidate: invalidateProfile } },
        village: { getAll: { invalidate: async () => undefined } },
      }),
      hospital: {
        userHeal: {
          useMutation: (options: typeof callbacks) => {
            callbacks = options;
            return { mutate: heal, isPending: false };
          },
        },
      },
    });
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: user,
      timeDiff: 0,
      prepareUserUpdate: () => prepareUserUpdate(cache, key),
      updateUser: (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
        updateUserCache(cache, key, patch, options),
    } as never);
    vi.spyOn(popover, "Popover").mockImplementation(({ children }) => <>{children}</>);
    vi.spyOn(popover, "PopoverTrigger").mockImplementation((({
      children,
    }: {
      children?: ReactNode;
    }) => <>{children}</>) as never);
    vi.spyOn(popover, "PopoverContent").mockImplementation((({
      children,
    }: {
      children?: ReactNode;
    }) => <div>{children}</div>) as never);
    vi.spyOn(Avatar, "default").mockImplementation(({ alt }) => <img alt={alt} />);
    vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
    vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
    const complete = vi.fn();
    try {
      const target = {
        userId: "target",
        username: "Target",
        avatar: "",
        curHealth: 0,
        maxHealth: 100,
      } as SectorUser;
      const view = render(
        <HealingPopover
          targetUser={target}
          open
          onHealComplete={complete}
          trigger={<button type="button">Heal target</button>}
        />,
      );
      await act(async () => fireEvent.click(view.getByRole("button", { name: "25%" })));
      expect(heal).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
      expect(invalidateProfile).not.toHaveBeenCalled();
      expect(cache.getQueryData(key)).toMatchObject({
        userData: {
          status: "AWAKE",
          curHealth: 100,
          curChakra: 90,
          curStamina: 100,
          medicalExperience: 20,
          experience: 75,
        },
      });
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      cache.clear();
    }
  },
);
