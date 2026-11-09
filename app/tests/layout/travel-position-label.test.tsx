import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as trpc from "@trpc/react-query";
import { afterEach, expect, it, vi } from "bun:test";
import { Profiler } from "react";
import * as clientApi from "@/app/_trpc/client";
import NavTabs from "@/layout/NavTabs";
import { TravelPositionLabel } from "@/layout/TravelPositionLabel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("updates confirmed coordinates without rendering or changing tab identity, and releases its cache listener", async () => {
  const key: ReturnType<typeof trpc.getQueryKey> = [
    ["profile", "getUser"],
    { type: "query" },
  ];
  Object.assign(vi.spyOn(clientApi, "api" as never), { profile: { getUser: {} } });
  vi.spyOn(trpc, "getQueryKey").mockReturnValue(key);
  const client = new QueryClient();
  const setPosition = (longitude: number) =>
    client.setQueryData(key, { userData: { longitude, latitude: 9 } });
  setPosition(10);
  const rendered = vi.fn(),
    selected = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <Profiler id="tabs" onRender={rendered}>
        <NavTabs
          current="You"
          options={["You", "Global"]}
          labels={{ You: <TravelPositionLabel /> }}
          onChange={selected}
        />
      </Profiler>
    </QueryClientProvider>,
  );
  const button = view.getByRole("button", { name: "You (10, 9)" });
  rendered.mockClear();
  await act(async () => {
    setPosition(12);
  });
  expect(view.getByRole("button", { name: "You (12, 9)" })).toBe(button);
  expect(rendered).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(selected).toHaveBeenCalledWith("You");
  view.unmount();
  await act(async () => {
    setPosition(13);
  });
  expect(button.textContent).toBe("You (12, 9)");
  client.clear();
});
