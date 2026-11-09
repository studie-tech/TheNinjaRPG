import { afterEach, expect, it } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { EmojiPicker } from "@/layout/EmojiPicker";
import { installEmojiPickerBrowserGlobals } from "../setup/emojiPicker";

afterEach(cleanup);

it("gives the picker a fixed width without moving focus unless requested", async () => {
  const restorePickerGlobals = installEmojiPickerBrowserGlobals();
  const view = render(<EmojiPicker onSelect={() => {}} />);
  try {
    await waitFor(() => {
      const picker = view.container.querySelector("em-emoji-picker");
      expect(picker?.shadowRoot?.querySelector("input")).toBeTruthy();
      expect(picker?.shadowRoot?.activeElement).toBeNull();
    });
    expect((view.container.firstElementChild as HTMLElement).style.width).toBe("300px");
  } finally {
    view.unmount();
    restorePickerGlobals();
  }
});
