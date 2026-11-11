import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import * as navigation from "next/navigation";
import { useContentListActions } from "@/hooks/useContentListActions";
import * as toast from "@/libs/toast";

const push = vi.fn();
const refetch = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useContentListActions", () => {
  const setup = () =>
    renderHook(() => useContentListActions(refetch, "/manual/jutsu/edit")).result
      .current;

  it("opens a created row without waiting for the list refresh", () => {
    refetch.mockImplementationOnce(() => new Promise(() => undefined));
    const { onCreated } = setup();
    act(() => onCreated({ success: true, message: "new-id" }));
    expect(push).toHaveBeenCalledWith("/manual/jutsu/edit/new-id");
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("stays on the list when creation is rejected", () => {
    setup().onCreated({ success: false, message: "You are banned" });
    expect(toast.showMutationToast).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("refreshes after a delete attempt", async () => {
    await setup().onDeleted({ success: false, message: "Not allowed" });
    expect(toast.showMutationToast).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
