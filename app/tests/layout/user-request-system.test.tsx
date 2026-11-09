import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ComponentProps } from "react";
import { UserRequestStates } from "@/drizzle/constants";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { testRouter } from "../setup/router";

afterEach(cleanup);

type Request = ComponentProps<typeof UserRequestSystem>["requests"][number];
const person = (username: string) => ({
  username,
  level: 20,
  rank: "CHUNIN" as const,
  village: { name: "Konoki" },
});
const request = (id: string, status: Request["status"], senderId: string): Request =>
  ({
    id,
    status,
    type: "SPAR",
    senderId,
    receiverId: senderId === "me" ? "other" : "me",
    createdAt: new Date("2031-03-15T12:00:00Z"),
    value: 0,
    useRankedRules: false,
    spectatable: false,
    sender: person(senderId),
    receiver: person(senderId === "me" ? "other" : "me"),
  }) as unknown as Request;

const statusBoxes: Record<string, string | null> = {
  PENDING:
    '<div class="rounded-md border-2 border-amber-400 bg-amber-300 p-2 font-bold text-amber-600">Pending</div>',
  ACCEPTED:
    '<div class="rounded-md border-2 border-green-400 bg-green-300 p-2 font-bold text-green-600">Accepted</div>',
  REJECTED:
    '<div class="rounded-md border-2 border-red-400 bg-red-300 p-2 font-bold text-red-600">Rejected</div>',
  CANCELLED:
    '<div class="rounded-md border-2 border-slate-400 bg-slate-300 p-2 font-bold text-slate-600">Cancelled</div>',
  EXPIRED: null,
};

const router = testRouter("user-request-system");
const mount = (requests: Request[]) =>
  render(
    <AppRouterContext.Provider value={router}>
      <UserRequestSystem
        requests={requests}
        userId="me"
        isLoading={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onCancel={vi.fn()}
      />
    </AppRouterContext.Provider>,
  );

describe("user request status", () => {
  it.each([...UserRequestStates])("renders the %s status box", (status) => {
    const view = mount([request("sent", status, "me")]);
    const rows = view.container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    const statusCell = [...rows[0]!.querySelectorAll("td")].find((cell) =>
      statusBoxes[status] ? cell.innerHTML.includes(statusBoxes[status]) : false,
    );
    if (statusBoxes[status]) expect(statusCell?.innerHTML).toBe(statusBoxes[status]);
    else expect(view.container.innerHTML).not.toMatch(/Expired|border-2 border-/);
  });

  it("renders only the tables that have requests", () => {
    expect(mount([]).container.querySelectorAll("table")).toHaveLength(0);
    cleanup();
    expect(
      mount([request("sent", "PENDING", "me")]).container.querySelectorAll("table"),
    ).toHaveLength(1);
    cleanup();
    expect(
      mount([
        request("sent", "PENDING", "me"),
        request("received", "PENDING", "other"),
      ]).container.querySelectorAll("table"),
    ).toHaveLength(2);
  });
});
