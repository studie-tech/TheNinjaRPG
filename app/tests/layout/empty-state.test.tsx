import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/layout/EmptyState";

describe("EmptyState", () => {
  afterEach(cleanup);

  it("says what is missing and offers the way forward", () => {
    const view = render(
      <EmptyState
        icon={Inbox}
        title="No conversations yet"
        description="Private conversations appear here."
        action={<button type="button">Start a conversation</button>}
      />,
    );
    expect(view.getByText("No conversations yet")).toBeTruthy();
    expect(view.getByText("Private conversations appear here.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Start a conversation" })).toBeTruthy();
  });

  it("leaves out the description and actions it was not given", () => {
    const view = render(<EmptyState title="No threads yet" />);
    expect(view.container.querySelectorAll("button")).toHaveLength(0);
    expect(view.container.textContent).toBe("No threads yet");
  });
});
