import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import { ForumAttachments } from "@/layout/ForumAttachments";
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
