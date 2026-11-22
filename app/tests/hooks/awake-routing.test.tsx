import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { UserStatus } from "@/drizzle/constants";
import * as router from "@/hooks/navigation";
import type { UserWithRelations } from "@/routers/profile";
import * as routing from "@/utils/routing";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ActivityGuard({
  status,
  autoWakeUp,
  allowActionRecovery,
  onUnavailable,
}: {
  status: UserStatus;
  autoWakeUp: boolean;
  allowActionRecovery: boolean;
  onUnavailable?: () => void;
}) {
  const awake = routing.useAwake({ status, autoWakeUp } as UserWithRelations, {
    allowActionRecovery,
    onUnavailable,
  });
  return <p>{awake ? "Awake" : "Unavailable"}</p>;
}

it.each([
  ["ASLEEP", true, true, null],
  ["HOSPITALIZED", false, true, null],
  ["ASLEEP", false, true, "/home"],
  ["ASLEEP", true, false, "/home"],
  ["HOSPITALIZED", true, false, "/hospital"],
  ["BATTLE", true, true, "/combat"],
  ["TRAVEL", true, true, null],
  ["QUEUED", true, true, null],
] as const)(
  "preserves activity routing for %s (auto-wake %s, recovery %s)",
  (status, autoWakeUp, allowActionRecovery, destination) => {
    const replace = vi.fn();
    vi.spyOn(router, "useNavigationRouter").mockReturnValue({ replace } as never);
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
    const view = render(
      <ActivityGuard
        status={status}
        autoWakeUp={autoWakeUp}
        allowActionRecovery={allowActionRecovery}
      />,
    );
    expect(replace.mock.calls).toEqual(destination ? [[destination]] : []);
    expect(view.getByText("Unavailable")).toBeTruthy();
  },
);

it.each(["ASLEEP", "HOSPITALIZED", "BATTLE", "TRAVEL", "QUEUED"] as const)(
  "lets the host close an unavailable %s screen without navigating",
  (status) => {
    const replace = vi.fn();
    const close = vi.fn();
    vi.spyOn(router, "useNavigationRouter").mockReturnValue({ replace } as never);
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
    const view = render(
      <ActivityGuard
        status={status}
        autoWakeUp={false}
        allowActionRecovery={false}
        onUnavailable={close}
      />,
    );
    expect(view.getByText("Unavailable")).toBeTruthy();
    expect(close).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  },
);

it("keeps an awake hosted screen open", () => {
  const replace = vi.fn();
  const close = vi.fn();
  vi.spyOn(router, "useNavigationRouter").mockReturnValue({ replace } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
  const view = render(
    <ActivityGuard
      status="AWAKE"
      autoWakeUp={false}
      allowActionRecovery={false}
      onUnavailable={close}
    />,
  );
  expect(view.getByText("Awake")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
