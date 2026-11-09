import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { getFilter, useFiltering } from "@/layout/SupportTicketFiltering";
import * as UserContext from "@/utils/UserContext";

// React Query hands back the same data object until the staff list changes.
const staffPage = { data: { data: [{ userId: "mod", username: "Mod" }] } };

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: { getPublicUsers: { useQuery: () => staffPage } },
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () => ({ data: { userId: "viewer", role: "MODERATOR" } }) as never,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requests the open ticket statuses by default", () => {
  const { result } = renderHook(() => useFiltering());
  expect(getFilter(result.current)).toEqual({
    status: ["IN_PROGRESS", "OPEN", "WAITING_FOR_STAFF"],
  });
});

it("sends the viewer's own id for tickets created by me", () => {
  const { result } = renderHook(() => useFiltering());
  act(() => result.current.cf.setters.createdByUserId("me"));
  expect(getFilter(result.current)).toEqual(
    expect.objectContaining({ createdByUserId: "viewer" }),
  );
});

it("sends a chosen assignee and omits the None choices", () => {
  const { result } = renderHook(() => useFiltering());
  act(() => {
    result.current.cf.setters.assignedToUserId("mod");
    result.current.cf.setters.status([]);
  });
  const filter = getFilter(result.current);
  expect(filter).toEqual({ assignedToUserId: "mod" });
  expect("createdByUserId" in filter).toBe(false);
});
