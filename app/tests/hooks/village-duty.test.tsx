import { afterEach, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Suspense, startTransition } from "react";
import * as client from "@/app/_trpc/client";
import * as cache from "@/hooks/useQueryCacheUpdate";
import { useVillageDutyPursuit } from "@/hooks/useVillageDuty";
import * as userContext from "@/utils/UserContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps patrol requests bound to committed data while another sector render suspends", async () => {
  const mutate = vi.fn();
  vi.spyOn(userContext, "useUserInfo").mockReturnValue({
    userId: "visitor",
    timeDiff: 0,
  } as never);
  vi.spyOn(cache, "useQueryCacheUpdate").mockReturnValue({} as never);
  const getSectorData = client.api.travel.getSectorData;
  Object.assign(vi.spyOn(client, "api" as never), {
    travel: { getSectorData },
    villageDuty: { patrol: { useMutation: () => ({ mutate, isPending: false }) } },
  });
  let tick = () => {};
  vi.spyOn(window, "setInterval").mockImplementation(((callback: () => void) => {
    tick = callback;
    return 1;
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(() => {});
  let now = 100_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const pending = new Promise<void>(() => {});
  const committed = new Date(0);
  function Probe({ sector }: { sector: number }) {
    useVillageDutyPursuit({
      sector,
      enabled: true,
      protectors: [],
      startedAt: committed,
      revision: sector,
    });
    if (sector === 2) throw pending;
    return <div>{sector}</div>;
  }
  const view = render(
    <Suspense fallback="loading">
      <Probe sector={1} />
    </Suspense>,
  );
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ sector: 1, revision: 1 }),
  );
  await act(async () =>
    startTransition(() =>
      view.rerender(
        <Suspense fallback="loading">
          <Probe sector={2} />
        </Suspense>,
      ),
    ),
  );
  expect(view.container.textContent).toBe("1");
  now += 11_000;
  act(() => tick());
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ sector: 1, revision: 1, startedAt: committed }),
  );
});
