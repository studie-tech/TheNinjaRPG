// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ensureDom } from "../../../../../tests/setup-dom.mjs";
import ShinobiStruggleClient from "./ShinobiStruggleClient";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Shinobi game</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const originalFlag = process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED;
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  if (originalFlag === undefined)
    delete process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED;
  else process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED = originalFlag;
  globalThis.fetch = originalFetch;
});

it("keeps account linking hidden until enabled", () => {
  ensureDom();
  process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED = "false";
  const view = render(<ShinobiStruggleClient />);
  expect(view.queryByRole("button", { name: /Link an existing/ })).toBeNull();
});

it("redeems a code through the same-origin route and keeps a conflict recoverable", async () => {
  ensureDom();
  process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED = "true";
  let status = 409;
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(status === 200 ? { playerId: "p_block" } : { error: "Conflict" }, {
      status,
    }),
  );
  globalThis.fetch = fetcher;
  const view = render(<ShinobiStruggleClient />);
  const form = within(
    view.getByRole("region", { name: "Block Struggle account linking" }),
  );
  fireEvent.click(form.getByRole("button", { name: /Link an existing/ }));
  const input = form.getByRole("textbox", { name: "Block Struggle link code" });
  fireEvent.input(input, { target: { value: "c".repeat(43) } });
  fireEvent.click(form.getByRole("button", { name: "Link accounts" }));
  await waitFor(() =>
    expect(form.getByRole("alert").textContent).toContain("cannot be merged"),
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "/api/minigames/blockstruggle/identity-link/redeem",
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    body: JSON.stringify({ code: "c".repeat(43) }),
  });
  status = 200;
  fireEvent.click(form.getByRole("button", { name: "Link accounts" }));
  await waitFor(() =>
    expect(view.getByText("Accounts linked. Your game is reconnecting.")).toBeTruthy(),
  );
  expect((input as HTMLInputElement).value).toBe("");
});
