import { afterEach, expect, it, vi } from "bun:test";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { useSceneMutation } from "@/hooks/useSceneMutation";

afterEach(cleanup);

it("retains guarded optimistic lifecycle callbacks without subscribing the scene to action status", async () => {
  const events: string[] = [];
  let allowed = true;
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onMutate: (_input, mutation) => {
        expect(mutation.options.mutationKey).toEqual([["travel", "moveInSector"]]);
        if (!allowed) throw new Error("Session changed");
        events.push("guard");
      },
    }),
  });
  const errors = vi.fn(),
    rendered = vi.fn();
  let execute: ((tile: number) => Promise<number>) | undefined;
  const Scene = ({ name }: { name: string }) => {
    execute = useSceneMutation({
      mutationKey: [["travel", "moveInSector"]],
      mutationFn: async (tile: number) => {
        events.push("request");
        return tile;
      },
      onMutate: () => {
        events.push("walk");
        return { origin: 2 };
      },
      onSuccess: (tile, _input, context) => {
        events.push(`${name}:${context?.origin}:${tile}`);
      },
      onError: errors,
      onSettled: () => {
        events.push("settled");
      },
    });
    return null;
  };
  const view = render(
    <QueryClientProvider client={client}>
      <Profiler id="scene" onRender={rendered}>
        <Scene name="first" />
      </Profiler>
    </QueryClientProvider>,
  );
  const action = execute!;
  rendered.mockClear();
  await act(async () => {
    expect(await action(5)).toBe(5);
  });
  expect(events).toEqual(["guard", "walk", "request", "first:2:5", "settled"]);
  expect(rendered).not.toHaveBeenCalled();
  view.rerender(
    <QueryClientProvider client={client}>
      <Profiler id="scene" onRender={rendered}>
        <Scene name="latest" />
      </Profiler>
    </QueryClientProvider>,
  );
  expect(execute).toBe(action);
  events.length = 0;
  await act(async () => {
    await action(6);
  });
  expect(events).toContain("latest:2:6");
  allowed = false;
  events.length = 0;
  await act(async () => {
    await expect(action(7)).rejects.toThrow("Session changed");
  });
  expect(events).toEqual(["settled"]);
  expect(errors).toHaveBeenCalledTimes(1);
  client.clear();
});
