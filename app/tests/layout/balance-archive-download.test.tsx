import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as filtering from "@/layout/BalanceFiltering";
import { BalanceOverview } from "@/layout/BalanceOverview";
import * as ContentBox from "@/layout/ContentBox";
import * as dom from "@/utils/dom";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

type ArchivePage = RouterOutputs["data"]["getBalanceArchivePage"];
const periodStart = 1_762_732_800;
let queryClient: QueryClient;
const onQueryError = vi.fn();
const downloadBlob = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  setSystemTime(new Date("2026-11-17T12:00:00Z"));
  onQueryError.mockClear();
  downloadBlob.mockClear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    queryCache: new QueryCache({ onError: onQueryError }),
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: testApi.useUtils,
    data: testApi.data,
  });
  vi.spyOn(filtering, "useBalanceFiltering").mockReturnValue({
    isReady: false,
  } as never);
  vi.spyOn(filtering, "getBalanceFilter").mockReturnValue({});
  vi.spyOn(filtering, "BalanceFiltering").mockImplementation(() => <></>);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(dom, "downloadBlob").mockImplementation(downloadBlob);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("finishes an archive exceeding 60 pages after retrying the same cursor for a full minute", async () => {
  const cursors: number[] = [];
  let limited = false;
  const view = await mountArchive((cursor) => {
    cursors.push(cursor);
    if (cursor === 60_000 && !limited) {
      limited = true;
      throw trpcError("TOO_MANY_REQUESTS");
    }
    return page(cursor, 61_000);
  });
  fireEvent.click(view.getByRole("button", { name: "Download JSON" }));
  await flush();
  expect(cursors).toHaveLength(61);
  expect(cursors.at(-1)).toBe(60_000);
  expect(
    (view.getByRole("button", { name: "Downloading…" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((view.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  expect(
    view.getByText("Large archives may pause briefly for request limits.").textContent,
  ).toContain("pause briefly");
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(onQueryError).not.toHaveBeenCalled();

  await advance(59_000);
  expect(cursors).toHaveLength(61);
  await advance(1000);
  expect(cursors.slice(-3)).toEqual([60_000, 60_000, 61_000]);
  expect(downloadBlob).toHaveBeenCalledTimes(1);
  const [blob, filename] = downloadBlob.mock.calls[0]!;
  const file = JSON.parse(await (blob as Blob).text());
  expect(filename).toBe("balance-2025-11-10.json");
  expect(file).toMatchObject({ version: 1, periodStart });
  expect(file.rows).toHaveLength(61_000);
  expect(new Set(file.rows.map((row: { id: number }) => row.id)).size).toBe(61_000);
  expect(file.rows[0].id).toBe(1);
  expect(file.rows.at(-1).id).toBe(61_000);
  expect(
    view.queryByText("Large archives may pause briefly for request limits."),
  ).toBeNull();
  expect(view.queryByRole("alert")).toBeNull();
  expect(
    (view.getByRole("button", { name: "Download JSON" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it("fails a non-rate-limit error immediately and allows a fresh download", async () => {
  let fail = true;
  const cursors: number[] = [];
  const view = await mountArchive((cursor) => {
    cursors.push(cursor);
    if (fail && cursor === 1000) throw trpcError("BAD_REQUEST");
    return page(cursor, 1001);
  });
  fireEvent.click(view.getByRole("button", { name: "Download JSON" }));
  await flush();
  expect(cursors).toEqual([0, 1000]);
  expect(view.getByRole("alert").textContent).toContain("Please try again");
  expect(
    view.queryByText("Large archives may pause briefly for request limits."),
  ).toBeNull();
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(onQueryError).toHaveBeenCalledTimes(1);
  fail = false;
  fireEvent.click(view.getByRole("button", { name: "Download JSON" }));
  await flush();
  expect(cursors.slice(-2)).toEqual([0, 1000]);
  expect(view.queryByRole("alert")).toBeNull();
  expect(downloadBlob).toHaveBeenCalledTimes(1);
  const file = JSON.parse(await (downloadBlob.mock.calls[0]![0] as Blob).text());
  expect(file.rows).toHaveLength(1001);
});

it("stops after two rate-limit retries and restores the download controls", async () => {
  const fetchPage = vi.fn(() => {
    throw trpcError("TOO_MANY_REQUESTS");
  });
  const view = await mountArchive(fetchPage);
  fireEvent.click(view.getByRole("button", { name: "Download JSON" }));
  await flush();
  expect(fetchPage).toHaveBeenCalledTimes(1);
  await advance(60_000);
  expect(fetchPage).toHaveBeenCalledTimes(2);
  expect(onQueryError).not.toHaveBeenCalled();
  await advance(60_000);
  expect(fetchPage).toHaveBeenCalledTimes(3);
  expect(view.getByRole("alert").textContent).toContain("Please try again");
  expect(
    (view.getByRole("button", { name: "Download JSON" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect((view.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(onQueryError).toHaveBeenCalledTimes(1);
  await advance(60_000);
  expect(fetchPage).toHaveBeenCalledTimes(3);
});

const mountArchive = async (fetchPage: (cursor: number) => ArchivePage) => {
  const trpcClient = fakeTrpcClient((path, input) => {
    if (path === "data.getBalanceArchives") return [{ periodStart }];
    if (path === "data.getBalanceArchivePage") {
      expect((input as { periodStart: number }).periodStart).toBe(periodStart);
      return fetchPage((input as { cursor: number }).cursor);
    }
    throw new Error(`Unexpected query: ${path}`);
  });
  const view = render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <BalanceOverview tab="Archives" />
    </TrpcTestProviders>,
  );
  await flush();
  return view;
};

const page = (cursor: number, total: number): ArchivePage => {
  const rows = Array.from({ length: Math.min(1000, total - cursor) }, (_, offset) => ({
    id: cursor + offset + 1,
    periodStart,
    type: "jutsu" as const,
    contentId: "fire",
    relatedBloodlineId: null,
    createdAt: new Date("2025-11-10T00:00:00Z"),
    updatedAt: new Date("2025-11-10T00:00:00Z"),
    battleType: "COMBAT" as const,
    battleWon: 1,
    userLevel: 50,
    userRank: "JONIN" as const,
    turnOrder: 0,
    count: 1,
  }));
  return { rows, nextCursor: rows.length === 1000 ? rows.at(-1)?.id : undefined };
};

const trpcError = (code: "TOO_MANY_REQUESTS" | "BAD_REQUEST") =>
  TRPCClientError.from({
    error: {
      message: code,
      code: code === "TOO_MANY_REQUESTS" ? -32029 : -32600,
      data: { code, httpStatus: code === "TOO_MANY_REQUESTS" ? 429 : 400 },
    },
  });

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 2000; i++) await Promise.resolve();
    vi.advanceTimersByTime(0);
  });
};

const advance = async (milliseconds: number) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
  await flush();
};
