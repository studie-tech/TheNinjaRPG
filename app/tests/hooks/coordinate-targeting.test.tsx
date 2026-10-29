import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { SetValueConfig } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import type { Item, Jutsu } from "@/drizzle/schema";
import { useItemEditForm } from "@/hooks/item";
import { useJutsuEditForm } from "@/hooks/jutsu";
import { ItemValidator, JutsuValidator, type ZodJutsuInput } from "@/validators/combat";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();

const coordinateTargeting = {
  origin: "BATTLEFIELD" as const,
  selection: "ALL" as const,
  randomCount: 1,
  coordinates: [
    { longitude: 1, latitude: 1 },
    { longitude: 2, latitude: 1 },
  ],
};
const base = {
  name: "Pattern",
  image: "pattern.webp",
  description: "Pattern",
  battleDescription: "",
  method: "COORDINATES",
  coordinateTargeting,
  target: "GROUND",
  range: 1,
  healthCost: 0,
  chakraCost: 0,
  staminaCost: 0,
  healthCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  actionCostPerc: 100,
  cooldown: 0,
  bloodlineId: null,
  effects: [],
};
const jutsu = {
  ...JutsuValidator.parse({
    ...base,
    extraBaseCost: 0,
    jutsuWeapon: "NONE",
    jutsuType: "AI",
    jutsuRank: "D",
    requiredRank: "JONIN",
    requiredLevel: 1,
    villageId: null,
    requiredBloodlineItemId: null,
  }),
  id: "coordinate-jutsu",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Jutsu;
const item = {
  ...ItemValidator.parse({
    ...base,
    stackSize: 10,
    maxImbueNumber: 1,
    maxDurability: 100,
    hidden: false,
    cost: 1,
    repsCost: 0,
    seichiSilverCost: 0,
    maxEquips: 0,
    itemType: "WEAPON",
    weaponType: "NONE",
    rarity: "COMMON",
    slot: "NONE",
    expireFromStoreAt: null,
    farmYieldItemId: null,
    farmExtractSeedItemId: null,
    crystalTargetTypes: null,
  }),
  id: "coordinate-item",
  createdAt: new Date(),
  updatedAt: new Date(),
  craftingRequirements: [],
} as Item & { craftingRequirements: [] };

const save = vi.fn(async (_input: { id: string; data: unknown }) => ({
  success: true,
  message: "Saved",
}));
const names = { useQuery: () => ({ data: [] }) };
const update = {
  useMutation: () => ({ mutate: save, mutateAsync: save, isPending: false }),
};
const refetch = async () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ item: { getAllNames: { invalidate: async () => undefined }, getVariantNames: { invalidate: async () => undefined } } }),
    item: { getVariantNames: names, getAllNames: names, getBloodlineItemNames: names, update },
    jutsu: {
      getAllNames: names,
      getReskinParents: names,
      get: { useQuery: () => ({ data: undefined }) },
      update,
    },
    bloodline: { getAllNames: names, getReskinsForBloodline: names },
    village: { getAllNames: names },
    skillTree: { getAllNames: names },
    petSpecies: { getAll: { useQuery: () => ({ data: [], isPending: false }) } },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const editors: {
  kind: string;
  useEditor: () => {
    form: {
      setValue: {
        (name: "coordinateTargeting", value: ZodJutsuInput["coordinateTargeting"], options?: SetValueConfig): void;
        (name: "method", value: "SINGLE" | "ALL" | "COORDINATES", options?: SetValueConfig): void;
        (name: "methodSize", value: ZodJutsuInput["methodSize"], options?: SetValueConfig): void;
      };
      getValues: { (name: "coordinateTargeting"): ZodJutsuInput["coordinateTargeting"]; (name: "methodSize"): ZodJutsuInput["methodSize"]; };
      getFieldState: (name: "coordinateTargeting" | "methodSize") => { error?: unknown; isDirty: boolean };
      formState: { isDirty: boolean };
      trigger: () => Promise<boolean>;
    };
    formData: { id: string }[];
    submit: () => Promise<void>;
  };
}[] = [
  {
    kind: "jutsu",
    useEditor: () => {
      const editor = useJutsuEditForm(jutsu, refetch);
      return {
        form: editor.form,
        formData: editor.formData,
        submit: editor.handleJutsuSubmit,
      };
    },
  },
  {
    kind: "item",
    useEditor: () => {
      const editor = useItemEditForm(item, refetch);
      return {
        form: editor.form,
        formData: editor.formData,
        submit: editor.handleItemSubmit,
      };
    },
  },
];

describe("coordinate method drafts", () => {
  for (const { kind, useEditor } of editors) {
    it.each(["ALL", "COORDINATES"] as const)(`clears hidden invalid ${kind} method sizes when changing to %s`, async (method) => {
      const { result } = renderHook(() => useEditor());
      await act(async () => { result.current.form.setValue("method", "SINGLE"); });
      await act(async () => { result.current.form.setValue("methodSize", { x: Number.NaN, y: 1 }); });
      await act(async () => { expect(await result.current.form.trigger()).toBe(false); });
      await act(async () => {
        result.current.form.setValue("method", method);
        if (method === "COORDINATES") result.current.form.setValue("coordinateTargeting", coordinateTargeting);
      });
      expect(result.current.form.getValues("methodSize")).toBeNull();
      expect(result.current.formData.some((field) => field.id === "methodSize")).toBe(false);
      await act(async () => { expect(await result.current.form.trigger()).toBe(true); });
    });
    it(`clears invalid ${kind} coordinates when changing to SINGLE`, async () => {
      const { result } = renderHook(() => useEditor());
      await act(async () => {
        expect(await result.current.form.trigger()).toBe(true);
        result.current.form.setValue("coordinateTargeting", {
          ...coordinateTargeting,
          coordinates: [coordinateTargeting.coordinates[0]!, coordinateTargeting.coordinates[0]!],
        });
        await result.current.submit();
      });
      expect(save).not.toHaveBeenCalled();
      expect(result.current.form.getFieldState("coordinateTargeting").error).toBeDefined();

      await act(async () => {
        result.current.form.setValue("method", "SINGLE", { shouldDirty: true });
      });
      expect(result.current.formData.some((field) => field.id === "coordinateTargeting")).toBe(false);
      expect(result.current.form.getValues("coordinateTargeting")).toBeNull();
      expect(result.current.form.getFieldState("coordinateTargeting").isDirty).toBe(true);
      expect(result.current.form.getFieldState("coordinateTargeting").error).toBeUndefined();
      await act(async () => {
        await result.current.submit();
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]?.[0]).toMatchObject({
        data: { method: "SINGLE", coordinateTargeting: null },
      });
    });

    it(`keeps ${kind} targeting dirty until the original pattern is restored`, async () => {
      const { result } = renderHook(() => {
        const editor = useEditor();
        return { ...editor, isDirty: editor.form.formState.isDirty };
      });
      expect(result.current.isDirty).toBe(false);
      await act(async () => {
        result.current.form.setValue("method", "SINGLE", { shouldDirty: true });
      });
      expect(result.current.form.getValues("coordinateTargeting")).toBeNull();
      expect(result.current.form.getFieldState("coordinateTargeting").isDirty).toBe(true);
      expect(result.current.isDirty).toBe(true);
      await act(async () => {
        result.current.form.setValue("method", "COORDINATES", { shouldDirty: true });
        result.current.form.setValue("coordinateTargeting", coordinateTargeting, { shouldDirty: true });
      });
      expect(result.current.form.getFieldState("coordinateTargeting").isDirty).toBe(false);
      expect(result.current.isDirty).toBe(false);
      await act(async () => { await result.current.submit(); });
      expect(save).not.toHaveBeenCalled();
    });

    it(`blocks active invalid ${kind} coordinates and saves a corrected draft`, async () => {
      const { result } = renderHook(() => useEditor());
      await act(async () => {
        result.current.form.setValue("coordinateTargeting", {
          ...coordinateTargeting,
          coordinates: [{ longitude: Number.NaN, latitude: 1 }],
        });
        await result.current.submit();
      });
      expect(save).not.toHaveBeenCalled();
      expect(result.current.formData.some((field) => field.id === "coordinateTargeting")).toBe(true);
      expect(result.current.form.getFieldState("coordinateTargeting").error).toBeDefined();
      await act(async () => {
        result.current.form.setValue("coordinateTargeting", {
          ...coordinateTargeting,
          coordinates: [{ longitude: 3, latitude: 1 }],
        });
        await result.current.submit();
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]?.[0]).toMatchObject({
        data: {
          method: "COORDINATES",
          coordinateTargeting: { coordinates: [{ longitude: 3, latitude: 1 }] },
        },
      });
    });
  }
});
