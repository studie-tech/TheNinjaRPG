import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import { useAssetEditForm } from "@/hooks/asset";
import * as toast from "@/libs/toast";

type Result = { success: boolean; message: string };
type Callbacks = {
  onSuccess: (result: Result, variables: { data: { type: string } }) => Promise<void>;
  onError: (error: Error) => void;
};
const asset: GameAsset = {
  lpcConfig: null,
  id: "asset",
  name: "Forest",
  type: "STATIC",
  image: "https://example.com/forest.webp",
  url: "https://example.com/forest.webp",
  folder: "Scenes",
  frames: 1,
  speed: 50,
  hidden: false,
  licenseDetails: "TNR",
  onInitialBattleField: false,
  createdByUserId: "creator",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const save = vi.fn(
  async (_input: unknown): Promise<Result> => ({ success: true, message: "Saved" }),
);
const refetch = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ success: true, message: "Saved" });
  refetch.mockClear();
  invalidate.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      gameAsset: Object.fromEntries(
        ["getAll", "getAllFolders", "getAllNames", "getNameTags"].map((key) => [
          key,
          { invalidate },
        ]),
      ),
      misc: { getAllGameAssetNames: { invalidate } },
    }),
    // Stub the tRPC boundary while retaining real React pending state and form validation.
    gameAsset: {
      update: {
        useMutation: function useUpdateMutation(callbacks: Callbacks) {
          const [isPending, setPending] = useState(false);
          return {
            isPending,
            mutateAsync: async (input: unknown) => {
              setPending(true);
              try {
                const result = await save(input);
                await callbacks.onSuccess(result, input as { data: { type: string } });
                return result;
              } catch (error) {
                callbacks.onError(error as Error);
                throw error;
              } finally {
                setPending(false);
              }
            },
          };
        },
      },
    },
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(toast, "showFormErrorsToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("asset editor save recovery", () => {
  it("retains edits and a visible rejection until a successful retry refreshes the library", async () => {
    save.mockResolvedValueOnce({
      success: false,
      message: "Your content role changed. Try again.",
    });
    const { result } = renderHook(() => useAssetEditForm(asset, refetch));
    await act(async () => {
      result.current.form.setValue("name", "Edited forest");
      await result.current.handleAssetSubmit();
    });
    expect(result.current.saveError).toBe("Your content role changed. Try again.");
    expect(result.current.form.getValues("name")).toBe("Edited forest");
    expect(result.current.isUpdating).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      result.current.form.setValue("name", "");
      await result.current.handleAssetSubmit();
    });
    expect(result.current.saveError).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.form.setValue("name", "Edited forest again");
    });
    await act(async () => {
      await result.current.handleAssetSubmit();
    });
    expect(result.current.saveError).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(5);
  });

  it("keeps transport failures recoverable without losing form values", async () => {
    save.mockRejectedValueOnce(new Error("Network unavailable. Try again."));
    const { result } = renderHook(() => useAssetEditForm(asset, refetch));
    await act(async () => {
      result.current.form.setValue("folder", "NewScenes");
      await result.current.handleAssetSubmit();
    });
    expect(result.current.saveError).toBe("Network unavailable. Try again.");
    expect(result.current.form.getValues("folder")).toBe("NewScenes");
    expect(result.current.isUpdating).toBe(false);
    await act(async () => {
      await result.current.handleAssetSubmit();
    });
    expect(result.current.saveError).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("admits only one save while an earlier validated submission is pending", async () => {
    let finish!: (value: Result) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useAssetEditForm(asset, refetch));
    let submissions: Promise<void>[] = [];
    await act(async () => {
      result.current.form.setValue("name", "Edited forest");
      submissions = [
        result.current.handleAssetSubmit(),
        result.current.handleAssetSubmit(),
      ];
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.isUpdating).toBe(true);
    await act(async () => {
      finish({ success: true, message: "Saved" });
      await Promise.all(submissions);
    });
    expect(result.current.isUpdating).toBe(false);
  });
});
