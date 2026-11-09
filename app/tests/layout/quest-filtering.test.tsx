import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as useSize from "@radix-ui/react-use-size";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { QUEST_FILTERING_SCHEMA } from "@/layout/QuestFiltering";
import { questFilteringSchema } from "@/validators/quest";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const schema = QUEST_FILTERING_SCHEMA;
let state: ReturnType<typeof useContentFiltering<typeof schema.fields>>;

const Harness = () => {
  state = useContentFiltering(schema);
  return (
    <ContentFiltering schema={schema} state={state} triggerButtonId="filter-quests" />
  );
};

/** Opens the filter popover and returns the User Level spinbutton. */
const openUserLevel = () => {
  render(<Harness />);
  const trigger = document.getElementById("filter-quests");
  if (!trigger) throw new Error("Filter trigger not found");
  fireEvent.click(trigger);
  return screen.getByPlaceholderText("User Level") as HTMLInputElement;
};

/** Debounced filter values are what reach `quests.getAll`. */
const settledFilter = async (input: HTMLInputElement, value: string) => {
  act(() => {
    fireEvent.input(input, { target: { value } });
  });
  await waitFor(
    () => expect(state.debounced.userLevel).toEqual(state.values.userLevel),
    { timeout: 1500 },
  );
  return buildFilter(state, schema);
};

describe("quest user level filter", () => {
  beforeEach(() => {
    installBrowserGlobals();
    // ContentFiltering always calls its built-in option queries.
    const options = { useQuery: () => ({ data: [] }) };
    Object.assign(vi.spyOn(client, "api" as never), {
      bloodline: { getAllNames: options },
      misc: { getAllGameAssetNames: options },
      village: { getAllNames: options },
      data: { getReferralSources: options, getVisitorUtmSources: options },
    });
    vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreBrowserGlobals();
  });

  it("stops the native stepper at the server's bounds, so it can't go below zero", () => {
    const input = openUserLevel();
    expect(input.min).toBe("0");
    expect(input.max).toBe("150");
  });

  it("defaults other number filters to a minimum of zero", () => {
    const shared = defineFilteringSchema({
      fields: [
        { id: "cost", label: "Cost", type: "number", defaultValue: undefined },
      ] as const,
    });
    const Shared = () => (
      <ContentFiltering
        schema={shared}
        state={useContentFiltering(shared)}
        triggerButtonId="filter-shared"
      />
    );
    render(<Shared />);
    fireEvent.click(document.getElementById("filter-shared") as HTMLElement);
    const input = screen.getByPlaceholderText("Cost") as HTMLInputElement;
    expect(input.min).toBe("0");
    expect(input.max).toBe("");
  });

  it("does not send a negative level to the server", async () => {
    const input = openUserLevel();
    const filter = await settledFilter(input, "-1");
    expect(filter).not.toHaveProperty("userLevel");
    expect(questFilteringSchema.safeParse(filter).success).toBe(true);
  });

  it("does not send a level above the server's maximum", async () => {
    const input = openUserLevel();
    const filter = await settledFilter(input, "151");
    expect(filter).not.toHaveProperty("userLevel");
    expect(questFilteringSchema.safeParse(filter).success).toBe(true);
  });

  it("still sends levels inside the range", async () => {
    const input = openUserLevel();
    const filter = await settledFilter(input, "25");
    expect(filter).toMatchObject({ userLevel: 25 });
    expect(questFilteringSchema.safeParse(filter).success).toBe(true);
  });
});
