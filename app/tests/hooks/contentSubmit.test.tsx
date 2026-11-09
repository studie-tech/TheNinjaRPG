import { afterEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { Bloodline } from "@/drizzle/schema";
import { useBloodlineEditForm } from "@/hooks/bloodline";
import { useContentSubmit } from "@/hooks/contentSubmit";
import * as toast from "@/libs/toast";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useContentSubmit", () => {
  it("skips a save that changes nothing", async () => {
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() => useContentSubmit());
    await result.current({ name: "Same" }, { name: "Same" }, save);
    expect(save).not.toHaveBeenCalled();
  });

  it("admits one save at a time and releases the claim after a rejection", async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectSave) => {
          reject = rejectSave;
        }),
    );
    const { result } = renderHook(() => useContentSubmit());
    const first = result.current({ name: "Old" }, { name: "New" }, save);
    await result.current({ name: "Old" }, { name: "New" }, save);
    expect(save).toHaveBeenCalledTimes(1);

    reject(new Error("Network unavailable"));
    await first;
    const retry = vi.fn(async () => undefined);
    await result.current({ name: "Old" }, { name: "New" }, retry);
    expect(retry).toHaveBeenCalledWith({ name: "New" });
  });
});

describe("content editor rejected saves", () => {
  it("keeps the draft by refetching only after a confirmed update", async () => {
    type Result = { success: boolean; message: string };
    const refetch = vi.fn(async () => undefined);
    const save = vi.fn(
      async (): Promise<Result> => ({ success: false, message: "Rejected" }),
    );
    Object.assign(vi.spyOn(client, "api" as never), {
      village: { getAllNames: { useQuery: () => ({ data: [], isPending: false }) } },
      bloodline: {
        update: {
          useMutation: ({ onSuccess }: { onSuccess: (data: Result) => void }) => ({
            isPending: false,
            mutateAsync: async () => {
              const result = await save();
              onSuccess(result);
              return result;
            },
          }),
        },
      },
    });
    vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
    const bloodline = {
      id: "bloodline",
      name: "Sharingan",
      image: "https://example.com/b.webp",
      description: "Eyes",
      regenIncrease: 0,
      villageId: null,
      hidden: false,
      rank: "D",
      effects: [],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as Bloodline;
    const { result } = renderHook(() => useBloodlineEditForm(bloodline, refetch));

    await act(async () => {
      result.current.form.setValue("name", "Edited", { shouldValidate: true });
      await result.current.handleBloodlineSubmit();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();

    save.mockResolvedValueOnce({ success: true, message: "Saved" });
    await act(async () => {
      await result.current.handleBloodlineSubmit();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
