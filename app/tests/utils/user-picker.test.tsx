import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRecipientPicker, useUserPicker } from "@/utils/search";
import type { UserSearchResult } from "@/validators/register";

const player = (userId: string) =>
  ({
    userId,
    username: userId,
    avatar: null,
    level: 1,
    rank: "GENIN",
  }) as UserSearchResult;

describe("useUserPicker", () => {
  it("starts empty and exposes the selection", () => {
    const { result } = renderHook(() => useUserPicker());
    expect(result.current.users).toEqual([]);
    expect(result.current.user).toBeUndefined();

    act(() => result.current.methods.setValue("users", [player("a"), player("b")]));
    expect(result.current.users.map((user) => user.userId)).toEqual(["a", "b"]);
    expect(result.current.user?.userId).toBe("a");
  });

  it("seeds a preselected list", () => {
    const seeded = [player("a")];
    const { result } = renderHook(() => useUserPicker(50, seeded));
    expect(result.current.users).toEqual(seeded);
    expect(result.current.methods.getValues("users")).toEqual(seeded);
  });

  it("validates the selection against max", async () => {
    const { result } = renderHook(() => useUserPicker(1));
    await act(async () => {
      result.current.methods.setValue("users", [player("a"), player("b")]);
      expect(await result.current.methods.trigger("users")).toBe(false);
    });
  });
});

describe("useRecipientPicker", () => {
  const self = player("self");

  it("defaults to self once the user loads", async () => {
    const { result, rerender } = renderHook(({ user }) => useRecipientPicker(user), {
      initialProps: { user: undefined as UserSearchResult | undefined },
    });
    expect(result.current.user).toBeUndefined();
    rerender({ user: self });
    await waitFor(() => expect(result.current.user?.userId).toBe("self"));
  });

  it("keeps another recipient and falls back to self when cleared", async () => {
    const { result } = renderHook(() => useRecipientPicker(self));
    await waitFor(() => expect(result.current.user?.userId).toBe("self"));

    act(() => result.current.methods.setValue("users", [player("friend")]));
    expect(result.current.user?.userId).toBe("friend");

    act(() => result.current.methods.setValue("users", []));
    await waitFor(() => expect(result.current.user?.userId).toBe("self"));
  });
});
