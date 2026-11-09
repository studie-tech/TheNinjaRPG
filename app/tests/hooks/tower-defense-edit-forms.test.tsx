import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import type { TowerDefenseCharacterDb, TowerDefenseUpgrade } from "@/drizzle/schema";
import { useTowerDefenseCharacterEditForm } from "@/hooks/towerDefenseCharacter";
import { useTowerDefenseUpgradeEditForm } from "@/hooks/towerDefenseUpgrade";
import * as toast from "@/libs/toast";
import { type CharacterAssetConfig, spriteDirections } from "@/validators/towerDefense";

type Result = { success: boolean; message: string };
type Callbacks = { onSuccess: (result: Result) => Promise<void> };

const byDirection = <T,>(value: (direction: string) => T) =>
  Object.fromEntries(
    spriteDirections.map((direction) => [direction, value(direction)]),
  ) as Record<(typeof spriteDirections)[number], T>;
const assetConfig: CharacterAssetConfig = {
  rotations: byDirection((direction) => `https://example.com/${direction}.png`),
  animations: [
    {
      name: "walk",
      state: "moving",
      frames: byDirection(() => ["a.png"]),
      frameDurationMs: 100,
      loop: true,
    },
    {
      name: "jab",
      state: "punch",
      frames: byDirection(() => ["b.png"]),
      frameDurationMs: 80,
      loop: false,
    },
  ],
};
const character: TowerDefenseCharacterDb = {
  id: "character",
  name: "Bandit",
  isPlayer: false,
  baseHealth: 10,
  baseSpeed: 0.4,
  baseDamage: 10,
  attackCooldown: 1,
  healthScaling: 0.15,
  speedScaling: 0.02,
  damageScaling: 2,
  firstAppearWave: 1,
  baseCount: 3,
  countScaling: 1.5,
  scaleFactor: 2.8,
  assetConfig,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const upgrade = {
  id: "upgrade",
  name: "Sharper kunai",
  description: "More damage",
  upgradeType: "DAMAGE",
  maxLevel: 5,
  baseCost: 10,
  costMultiplier: 1.5,
  effectValue: 2,
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as unknown as TowerDefenseUpgrade;

const save = vi.fn(
  async (_input: unknown): Promise<Result> => ({ success: true, message: "Saved" }),
);
let finishRefresh: () => void = () => undefined;
const invalidate = vi.fn(
  (_input: unknown) =>
    new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }),
);

const stubMutation = (procedure: string) => ({
  [procedure]: {
    useMutation: function useStubMutation(callbacks: Callbacks) {
      const [isPending, setPending] = useState(false);
      return {
        isPending,
        mutate: (input: unknown) => {
          setPending(true);
          void (async () => {
            try {
              await callbacks.onSuccess(await save(input));
            } finally {
              setPending(false);
            }
          })();
        },
      };
    },
  },
});

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ success: true, message: "Saved" });
  invalidate.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      towerDefense: { getCharacter: { invalidate }, getUpgrade: { invalidate } },
    }),
    towerDefense: {
      ...stubMutation("updateCharacter"),
      ...stubMutation("updateUpgrade"),
    },
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(toast, "showFormErrorsToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("tower defense character editor", () => {
  it("patches one animation's state or timing and leaves the rest untouched", async () => {
    const { result } = renderHook(() => useTowerDefenseCharacterEditForm(character));
    await act(async () => {
      result.current.updateAnimation(1, { state: "throw" });
    });
    expect<unknown>(result.current.assetConfig?.animations).toEqual([
      assetConfig.animations[0],
      { ...assetConfig.animations[1], state: "throw" },
    ]);
    await act(async () => {
      result.current.updateAnimation(0, { frameDurationMs: 60 });
    });
    await act(async () => {
      result.current.updateAnimation(0, { loop: false });
    });
    expect<unknown>(result.current.assetConfig?.animations[0]).toEqual({
      ...assetConfig.animations[0],
      frameDurationMs: 60,
      loop: false,
    });
    expect(result.current.assetConfig?.rotations).toEqual(assetConfig.rotations);
    expect(result.current.form.getValues("assetConfig")).toEqual(
      result.current.assetConfig,
    );
    expect(character.assetConfig).toBe(assetConfig);
  });

  it("ignores updates for a missing animation or an empty asset config", async () => {
    const { result } = renderHook(() => useTowerDefenseCharacterEditForm(character));
    await act(async () => {
      result.current.updateAnimation(5, { state: "idle" });
    });
    await act(async () => {
      result.current.updateAnimation(5, { loop: false });
    });
    expect(result.current.assetConfig).toEqual(assetConfig);
    const empty = renderHook(() =>
      useTowerDefenseCharacterEditForm({ ...character, assetConfig: null }),
    );
    await act(async () => {
      empty.result.current.updateAnimation(0, { state: "idle" });
    });
    await act(async () => {
      empty.result.current.updateAnimation(0, { loop: false });
    });
    expect(empty.result.current.assetConfig).toBeNull();
  });

  it("hides enemy-only fields for players", () => {
    const { result } = renderHook(() =>
      useTowerDefenseCharacterEditForm({ ...character, isPlayer: true }),
    );
    expect(result.current.formData.map((entry) => entry.id)).toEqual([
      "name",
      "isPlayer",
      "scaleFactor",
    ]);
  });

  it("stays pending until the edited character has been refreshed", async () => {
    const { result } = renderHook(() => useTowerDefenseCharacterEditForm(character));
    await act(async () => {
      result.current.form.setValue("name", "Rogue");
    });
    await act(async () => {
      await result.current.handleCharacterSubmit();
      await flush();
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "character" }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ id: "character" });
    expect(result.current.isUpdating).toBe(true);
    await act(async () => {
      finishRefresh();
      await flush();
    });
    expect(result.current.isUpdating).toBe(false);
  });

  it("refreshes nothing after a rejection", async () => {
    const { result } = renderHook(() => useTowerDefenseCharacterEditForm(character));
    save.mockResolvedValueOnce({ success: false, message: "No access" });
    await act(async () => {
      result.current.form.setValue("name", "Rogue");
    });
    await act(async () => {
      await result.current.handleCharacterSubmit();
      await flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.isUpdating).toBe(false);
  });
});

describe("tower defense upgrade editor", () => {
  it("stays pending until the edited upgrade has been refreshed", async () => {
    const { result } = renderHook(() => useTowerDefenseUpgradeEditForm(upgrade));
    await act(async () => {
      result.current.form.setValue("name", "Sharpest kunai");
    });
    await act(async () => {
      await result.current.handleUpgradeSubmit();
      await flush();
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ id: "upgrade" });
    expect(result.current.isUpdating).toBe(true);
    await act(async () => {
      finishRefresh();
      await flush();
    });
    expect(result.current.isUpdating).toBe(false);
  });

  it("refreshes nothing after a rejection", async () => {
    save.mockResolvedValueOnce({ success: false, message: "No access" });
    const { result } = renderHook(() => useTowerDefenseUpgradeEditForm(upgrade));
    await act(async () => {
      result.current.form.setValue("name", "Sharpest kunai");
    });
    await act(async () => {
      await result.current.handleUpgradeSubmit();
      await flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
