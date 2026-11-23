import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { StoryOffer } from "@/hooks/useStoryOffer";
import { StoryAnswers } from "@/layout/StoryAnswers";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => installBrowserGlobals());
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

const dialog = (...texts: string[]) => {
  const chosen = vi.fn();
  return {
    chosen,
    offer: {
      questId: "quest",
      isPending: false,
      dialog: {
        id: "objective",
        description: "Where to?",
        answers: texts.map((text) => ({ text, choose: () => chosen(text) })),
      },
    } satisfies StoryOffer,
  };
};

describe("StoryAnswers", () => {
  it("gives a conversation's only answer where its words are", () => {
    const { offer, chosen } = dialog("Choose my village");
    const talk = vi.fn();
    const view = render(<StoryAnswers offer={offer} onTalk={talk} />);
    fireEvent.click(view.getByRole("button", { name: "Choose my village" }));
    expect(chosen).toHaveBeenCalledWith("Choose my village");
    expect(talk).not.toHaveBeenCalled();
    view.unmount();
  });

  it("opens the conversation for several answers, or lists them without one", () => {
    const { offer, chosen } = dialog("Akikaze", "Hyorin");
    const talk = vi.fn();
    const view = render(
      <StoryAnswers offer={offer} onTalk={talk} talkLabel="Choose" />,
    );
    expect(view.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: "Choose" }));
    expect(talk).toHaveBeenCalledTimes(1);
    view.rerender(<StoryAnswers offer={offer} />);
    fireEvent.click(view.getByRole("button", { name: "Hyorin" }));
    expect(chosen).toHaveBeenCalledWith("Hyorin");
    view.unmount();
  });

  it("holds out a reward, once while it is being claimed", () => {
    const claim = vi.fn();
    const offer = {
      questId: "quest",
      isPending: false,
      claim: { label: "Claim 5 XP", claim },
    };
    const view = render(<StoryAnswers offer={offer} />);
    fireEvent.click(view.getByRole("button", { name: "Claim 5 XP" }));
    expect(claim).toHaveBeenCalledTimes(1);
    view.rerender(<StoryAnswers offer={{ ...offer, isPending: true }} />);
    expect(view.getByRole("button").hasAttribute("disabled")).toBe(true);
    view.unmount();
  });
});
