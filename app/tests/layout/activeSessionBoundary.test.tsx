import * as clerk from "@clerk/nextjs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import * as navigation from "next/navigation";
import { StrictMode, useState } from "react";
import { ActiveSessionBoundary } from "@/layout/ActiveSessionBoundary";

const battle = atom("empty");
let client: QueryClient;
const Probe = () => {
  const [value, setValue] = useAtom(battle);
  const [queryClient] = useState(() => new QueryClient());
  client = queryClient;
  return <button onClick={() => setValue("account battle")}>{value}</button>;
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("preserves hydration state, then resets the query client and atoms on account switches and sign-out", () => {
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn(), replace: vi.fn() } as never);
  let auth = { isLoaded: false, session: undefined as { id: string } | null | undefined };
  vi.spyOn(clerk, "useSession").mockImplementation(() => auth as ReturnType<typeof clerk.useSession>);
  const view = render(<StrictMode><ActiveSessionBoundary><Probe /></ActiveSessionBoundary></StrictMode>);
  const initialClient = client!;
  act(() => view.getByRole("button").click());
  expect(view.getByRole("button").textContent).toBe("account battle");
  auth = { isLoaded: true, session: { id: "a" } };
  view.rerender(<StrictMode><ActiveSessionBoundary><Probe /></ActiveSessionBoundary></StrictMode>);
  expect(client!).toBe(initialClient);
  expect(view.getByRole("button").textContent).toBe("account battle");
  for (const session of [{ id: "b" }, { id: "a" }, null]) {
    const previous = client!;
    auth = { isLoaded: true, session };
    view.rerender(<StrictMode><ActiveSessionBoundary><Probe /></ActiveSessionBoundary></StrictMode>);
    expect(client!).not.toBe(previous);
    expect(view.getByRole("button").textContent).toBe("empty");
    act(() => view.getByRole("button").click());
  }
});
