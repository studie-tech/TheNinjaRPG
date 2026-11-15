import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import { createPortal } from "react-dom";
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

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
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

it("opens the clicked row's own page from anywhere on that row", () => {
  const many: Row[] = [
    { id: "a", username: "Kakashi", avatar: "a.png", level: 50 },
    { id: "b", username: "Guy", avatar: "b.png", level: 48 },
    { id: "c", username: "Asuma", avatar: "c.png", level: 45 },
  ];
  const view = render(
    <Table
      data={many}
      columns={columns}
      linkColumn="username"
      linkPrefix="/username/"
    />,
  );
  const [, first, second] = view.getAllByRole("row");
  fireEvent.click(within(second!).getByText("48"));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith("/username/Guy");
  fireEvent.click(within(first!).getByText("50"));
  expect(push).toHaveBeenLastCalledWith("/username/Kakashi");
});

it("does not stretch a link overlay across the table", () => {
  const view = render(
    <Table
      data={rows}
      columns={columns}
      linkColumn="username"
      linkPrefix="/username/"
    />,
  );
  for (const link of view.container.querySelectorAll("a[data-row-link]")) {
    expect(link.className).not.toContain("after:absolute");
    expect(link.className).not.toContain("after:inset-0");
  }
});

it("leaves clicks on the name link and cell controls to them", () => {
  const onAction = vi.fn();
  const view = render(
    <Table
      data={rows}
      columns={columns}
      linkColumn="username"
      linkPrefix="/username/"
      buttons={[{ label: "Kick", onClick: onAction }]}
    />,
  );
  const [, firstRow] = view.getAllByRole("row");
  fireEvent.click(within(firstRow!).getByRole("button", { name: "Kick" }));
  expect(onAction).toHaveBeenCalledWith(rows[0]);
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(within(firstRow!).getByRole("link", { name: "Kakashi" }), {
    button: 0,
  });
  // The link navigates itself; the row does not navigate a second time.
  expect(push).not.toHaveBeenCalled();
});

it("opens a row in a new tab on a modified or middle click and ignores masked rows", () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const view = render(
    <Table
      data={rows}
      columns={columns}
      linkColumn="username"
      linkPrefix="/username/"
      linkDisabled={(row) => row.username === "Hidden"}
    />,
  );
  const [, first, second] = view.getAllByRole("row");
  fireEvent.click(within(first!).getByText("50"), { ctrlKey: true });
  expect(open).toHaveBeenCalledWith("/username/Kakashi", "_blank", "noopener");
  fireEvent(
    within(first!).getByText("50"),
    new MouseEvent("auxclick", { bubbles: true, button: 1 }),
  );
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.click(within(second!).getByText("12"));
  expect(push).not.toHaveBeenCalled();
});

it("ignores clicks bubbling from a dialog portalled out of a cell", () => {
  type PortalRow = Row & { info: React.ReactNode };
  const portalRows: PortalRow[] = [
    {
      ...rows[0]!,
      info: createPortal(<button type="button">Inside dialog</button>, document.body),
    },
  ];
  const view = render(
    <Table
      data={portalRows}
      columns={[
        { key: "username", header: "Name", type: "string" },
        { key: "info", header: "Info", type: "jsx" },
      ]}
      linkColumn="username"
      linkPrefix="/username/"
    />,
  );
  fireEvent.click(view.getByText("Inside dialog"));
  expect(push).not.toHaveBeenCalled();
});
