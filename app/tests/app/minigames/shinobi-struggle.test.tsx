import * as clerk from "@clerk/nextjs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as dynamic from "next/dynamic";
import * as navigation from "next/navigation";

const authState = { sessionId: "session-1" };

// Keep the real host, substituting only its dynamically loaded game.
const gameProps: { initialMatchId?: string }[] = [];
const game = vi.spyOn(dynamic, "default").mockReturnValue(((props: {
  initialMatchId?: string;
}) => {
  gameProps.push(props);
  return <div>Shinobi game</div>;
}) as never);
const {
  default: ShinobiStruggleClient,
  fetchAuthenticatedGame,
  ninjaSignInUrl,
  ShinobiStruggleRoute,
} = await import("@/app/[shell]/minigames/shinobi-struggle/ShinobiStruggleClient");
game.mockRestore();

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(clerk, "useAuth").mockImplementation(
    () =>
      ({
        getToken: async () => "clerk-session-token",
        isLoaded: true,
        sessionId: authState.sessionId,
      }) as never,
  );
});

const originalFlag = process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED;
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authState.sessionId = "session-1";
  if (originalFlag === undefined)
    delete process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED;
  else process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED = originalFlag;
  globalThis.fetch = originalFetch;
});

it("returns to the same Ninja match after sign-in", () => {
  const origin = "https://rpg.example";
  const destination = new URL(ninjaSignInUrl("match_7", origin), origin);
  expect(destination.pathname).toBe("/login");
  expect(destination.searchParams.get("redirect_url")).toBe(
    `${origin}/minigames/shinobi-struggle?match=match_7`,
  );
  const lobby = new URL(ninjaSignInUrl(undefined, origin), origin);
  expect(lobby.searchParams.get("redirect_url")).toBe(
    `${origin}/minigames/shinobi-struggle`,
  );
});

it("sends the Clerk session only to the same-origin game bridge", async () => {
  const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ ok: true }),
  );
  await fetchAuthenticatedGame(
    "/api/minigames/blockstruggle/session",
    { method: "GET" },
    async () => "clerk-session-token",
    transport,
  );
  const [url, init] = transport.mock.calls[0] ?? [];
  if (!init) throw new Error("Bridge request missing");
  expect(url).toBe("/api/minigames/blockstruggle/session");
  expect(new Headers(init.headers).get("Authorization")).toBe(
    "Bearer clerk-session-token",
  );
  expect(init.credentials).toBe("same-origin");
  await expect(
    fetchAuthenticatedGame(
      "https://untrusted.example/api/minigames/blockstruggle/session",
      undefined,
      async () => "clerk-session-token",
      transport,
    ),
  ).rejects.toThrow("same-origin bridge");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("keeps account linking hidden until enabled", () => {
  process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED = "false";
  const view = render(<ShinobiStruggleClient />);
  expect(view.queryByRole("button", { name: /Link an existing/ })).toBeNull();
});

it("redeems a code through the same-origin route and keeps a conflict recoverable", async () => {
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
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
    "Bearer clerk-session-token",
  );
  status = 200;
  fireEvent.click(form.getByRole("button", { name: "Link accounts" }));
  await waitFor(() =>
    expect(view.getByText("Accounts linked. Your game is reconnecting.")).toBeTruthy(),
  );
  expect((input as HTMLInputElement).value).toBe("");
});

it("does not submit a link code when the session changes during token acquisition", async () => {
  let current = true;
  let release!: (token: string) => void;
  const token = new Promise<string>((resolve) => {
    release = resolve;
  });
  const transport = vi.fn(async () => Response.json({ ok: true }));
  const result = fetchAuthenticatedGame(
    "/api/minigames/blockstruggle/identity-link/redeem",
    {
      method: "POST",
      body: JSON.stringify({ code: "c".repeat(43) }),
    },
    () => token,
    transport,
    () => current,
  );
  const rejected = result.catch((error: unknown) => error);
  current = false;
  release("new-account-token");
  expect(await rejected).toMatchObject({ name: "AbortError" });
  expect(transport).not.toHaveBeenCalled();
});

it("discards the response body when an in-flight request belongs to a previous session", async () => {
  let current = true;
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const transport = vi.fn(async () => {
    current = false;
    return response;
  });
  await expect(
    fetchAuthenticatedGame(
      "/api/minigames/blockstruggle/session",
      undefined,
      async () => "old-account-token",
      transport,
      () => current,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("clears link input and ignores a previous account's delayed success after switching accounts", async () => {
  process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED = "true";
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetcher = vi.fn(async () => pending);
  globalThis.fetch = fetcher;
  const view = render(<ShinobiStruggleClient />);
  fireEvent.click(view.getByRole("button", { name: /Link an existing/ }));
  fireEvent.input(view.getByRole("textbox", { name: "Block Struggle link code" }), {
    target: { value: "c".repeat(43) },
  });
  fireEvent.click(view.getByRole("button", { name: "Link accounts" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  authState.sessionId = "session-2";
  view.rerender(<ShinobiStruggleClient />);
  expect(view.queryByRole("textbox", { name: "Block Struggle link code" })).toBeNull();
  const currentGame = view.container.lastElementChild;
  expect(currentGame).not.toBeNull();
  await act(async () => {
    release(Response.json({ playerId: "old-account-player" }));
  });
  expect(view.queryByText("Accounts linked. Your game is reconnecting.")).toBeNull();
  expect(view.container.lastElementChild).toBe(currentGame);
  fireEvent.click(view.getByRole("button", { name: /Link an existing/ }));
  expect(
    (
      view.getByRole("textbox", {
        name: "Block Struggle link code",
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(
    within(
      view.getByRole("region", {
        name: "Block Struggle account linking",
      }),
    ).queryByRole("alert"),
  ).toBeNull();
});

it.each([
  ["match=abc", "abc"],
  ["match=abc&match=def", undefined],
  ["", undefined],
])("opens the game for the deep link ?%s", (query, expected) => {
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams(query) as never,
  );
  render(<ShinobiStruggleRoute />);
  expect(gameProps.at(-1)?.initialMatchId).toBe(expected);
});
