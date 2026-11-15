import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import * as sanitizerLoader from "@/hooks/useHtmlSanitizer";
import { ForumAttachments } from "@/layout/ForumAttachments";
import * as sanitizeModule from "@/utils/sanitize";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const draft =
  '<p>Intro</p><p><img src="https://example.com/a.png"></p><p><img src="https://example.com/b.png"></p>';
let latest = "";

beforeEach(() => {
  installBrowserGlobals();
  Object.assign(vi.spyOn(client, "api" as never), {
    forum: { uploads: { useQuery: () => ({ data: undefined, isPending: false }) } },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const Harness = () => {
  const [content, setContent] = useState(draft);
  latest = content;
  return <ForumAttachments content={content} onChange={setContent} disabled={false} />;
};

it("removes several images from the current draft once the sanitizer has loaded", async () => {
  const view = render(<Harness />);
  const buttons = () =>
    view.getAllByRole("button", { name: "Remove from draft" }) as HTMLButtonElement[];
  await waitFor(() => expect(buttons().every((button) => !button.disabled)).toBe(true));
  fireEvent.click(buttons()[0]!);
  fireEvent.click(buttons()[0]!);
  await waitFor(() =>
    expect(view.queryAllByRole("button", { name: "Remove from draft" })).toHaveLength(
      0,
    ),
  );
  expect(latest).toContain("Intro");
  expect(latest).not.toContain("a.png");
  expect(latest).not.toContain("b.png");
});

it("offers a retry when the sanitizer fails to load and enables removal once it loads", async () => {
  let attempts = 0;
  const store = sanitizerLoader.createLazyModule(async () => {
    attempts++;
    if (attempts === 1) throw new Error("chunk failed");
    return sanitizeModule;
  });
  vi.spyOn(sanitizerLoader, "useHtmlSanitizer").mockImplementation((enabled) => {
    const { module, failed } = sanitizerLoader.useLazyModule(store, enabled);
    return { sanitizer: module, failed };
  });
  vi.spyOn(sanitizerLoader, "loadHtmlSanitizer").mockImplementation(() => store.load());
  const view = render(<Harness />);
  const alert = await view.findByText(/Removing images is unavailable right now/);
  const buttons = () =>
    view.getAllByRole("button", { name: "Remove from draft" }) as HTMLButtonElement[];
  expect(buttons().every((button) => button.disabled)).toBe(true);
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(buttons().every((button) => !button.disabled)).toBe(true));
  expect(view.queryByText(/Removing images is unavailable right now/)).toBeNull();
  expect(attempts).toBe(2);
  fireEvent.click(buttons()[0]!);
  await waitFor(() => expect(latest).not.toContain("a.png"));
});
