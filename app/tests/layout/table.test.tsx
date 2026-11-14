import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as Avatar from "@/layout/Avatar";
import Table, { type ColumnDefinitionType } from "@/layout/Table";

type Row = { id: string; username: string; avatar: string; level: number };

const rows: Row[] = [
  { id: "a", username: "Kakashi", avatar: "a.png", level: 50 },
  { id: "b", username: "Hidden", avatar: "b.png", level: 12 },
];
const columns: ColumnDefinitionType<Row, keyof Row>[] = [
  { key: "avatar", header: "", type: "avatar" },
  { key: "username", header: "Name", type: "string" },
  { key: "level", header: "Level", type: "number" },
];

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(Avatar, "default").mockImplementation(() => <span>Avatar</span>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders each linked row as a real link named by its text column", () => {
  const onAction = vi.fn();
  const view = render(
    <Table
      data={rows}
      columns={columns}
      linkColumn="username"
      linkPrefix="/username/"
      linkDisabled={(row) => row.username === "Hidden"}
      buttons={[{ label: "Kick", onClick: onAction }]}
    />,
  );
  const link = view.getByRole("link", { name: "Kakashi" });
  expect(link.getAttribute("href")).toBe("/username/Kakashi");
  expect(view.queryByRole("link", { name: "Hidden" })).toBeNull();
  const [, firstRow] = view.getAllByRole("row");
  fireEvent.click(within(firstRow!).getByRole("button", { name: "Kick" }));
  expect(onAction).toHaveBeenCalledWith(rows[0]);
});

it("reads headers from the theme's primary foreground", () => {
  const view = render(<Table data={rows} columns={columns} />);
  const header = view.container.querySelector("thead");
  expect(header?.className).toContain("text-primary-foreground");
  expect(header?.className).not.toContain("text-white");
});

it("shows a loader while loading and the empty text only for a loaded empty list", () => {
  const view = render(
    <Table data={undefined} columns={columns} isLoading emptyText="No players" />,
  );
  expect(view.queryByText("No players")).toBeNull();
  view.rerender(<Table data={[]} columns={columns} emptyText="No players" />);
  expect(view.getByText("No players")).toBeTruthy();
  view.rerender(<Table data={undefined} columns={columns} emptyText="No players" />);
  expect(view.queryByText("No players")).toBeNull();
});
