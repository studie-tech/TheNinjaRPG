import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { renderHook } from "@testing-library/react";
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

  it("refreshes and opens a created row", async () => {
    await setup().onCreated({ success: true, message: "new-id" });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/manual/jutsu/edit/new-id");
  });

  it("stays on the list when creation is rejected", async () => {
    await setup().onCreated({ success: false, message: "You are banned" });
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
