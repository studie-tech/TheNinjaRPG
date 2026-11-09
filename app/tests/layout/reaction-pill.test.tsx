import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "bun:test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReactionPill } from "@/layout/ReactionPill";

afterEach(cleanup);

it("names the first three who reacted and counts the rest", () => {
  const view = render(
    <TooltipProvider>
      <ReactionPill
        emoji="👍"
        usernames={["Ana", "Ben", "Cy", "Dee", "Eli", "Fay"]}
        isMine={false}
      />
    </TooltipProvider>,
  );
  expect(
    view.getByRole("button", { name: "👍 6, reacted by Ana, Ben, Cy and 3 others" }),
  ).toBeDefined();
});
