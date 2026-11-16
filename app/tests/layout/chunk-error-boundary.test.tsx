import { afterEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as htmlParser from "htmlparser2";
// The App Router's next/dynamic, which wraps a component without a loading state in a
// Fragment rather than a Suspense boundary; plain "next/dynamic" resolves to the Pages
// Router loader under Bun.
import dynamic from "next/dist/shared/lib/app-dynamic";
import { Suspense } from "react";
import { ChunkErrorBoundary } from "@/layout/ChunkErrorBoundary";
import { htmlToText, LazyParsedHtml } from "@/layout/LazyParsedHtml";
import { deferred } from "../setup/deferred";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the rest of the app when on-demand code fails to download", async () => {
  vi.spyOn(Sentry, "captureException").mockImplementation(() => "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let attempts = 0;
  const Frame = dynamic<{ label: string }>(() => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error("Failed to load chunk"))
      : Promise.resolve(({ label }: { label: string }) => <p>{label}</p>);
  });
  const view = render(
    <>
      <main>game page</main>
      <ChunkErrorBoundary
        fallback={(retry) => (
          <button type="button" onClick={retry}>
            Try again
          </button>
        )}
      >
        <Suspense fallback={null}>
          <Frame label="loaded" />
        </Suspense>
      </ChunkErrorBoundary>
    </>,
  );
  await view.findByRole("button", { name: "Try again" });
  expect(view.getByText("game page")).toBeTruthy();
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});

it("retries children that can load again", async () => {
  vi.spyOn(Sentry, "captureException").mockImplementation(() => "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let shouldFail = true;
  const Flaky = () => {
    if (shouldFail) throw new Error("Failed to load chunk");
    return <p>profile</p>;
  };
  const view = render(
    <ChunkErrorBoundary
      fallback={(retry) => (
        <button type="button" onClick={retry}>
          Try again
        </button>
      )}
    >
      <Flaky />
    </ChunkErrorBoundary>,
  );
  shouldFail = false;
  act(() => fireEvent.click(view.getByRole("button", { name: "Try again" })));
  expect(view.getByText("profile")).toBeTruthy();
});

it("renders stored HTML once the parser has loaded", async () => {
  const view = render(<LazyParsedHtml html="An <strong>event</strong> starts." />);
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe("event"),
  );
});

it("keeps feedback readable while the parser is pending, then renders its markup", async () => {
  const pending = deferred();
  const parseDocument = htmlParser.parseDocument;
  let isReady = false;
  // Suspend parsing so the wrapper stays pending even if another test loaded its chunk.
  vi.spyOn(htmlParser, "parseDocument").mockImplementation((...args) => {
    if (!isReady) throw pending.promise;
    return parseDocument(...args);
  });
  const view = render(<LazyParsedHtml html="An <strong>event</strong> starts." />);
  expect(view.getByText("An event starts.")).toBeTruthy();
  expect(view.container.querySelector("strong")).toBeNull();
  await act(async () => {
    isReady = true;
    pending.resolve();
  });
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe("event"),
  );
});

it("reads the text of stored HTML without markup or scripts for the parser fallback", () => {
  expect(
    htmlToText(
      'An <strong>event</strong> <script>alert(1)</script><img src=x onerror="alert(2)">starts.',
    ),
  ).toBe("An event starts.");
});
