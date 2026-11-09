import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { EmojiPicker } from "@/layout/EmojiPicker";

vi.mock("@/layout/EmojiPickerImpl", () => ({
  EmojiPickerImpl: () => <section data-testid="emoji-mart" />,
}));

afterEach(cleanup);

it("gives the picker a fixed width so hovering a long emoji name cannot resize it", async () => {
  render(<EmojiPicker onSelect={() => {}} />);
  const picker = await screen.findByTestId("emoji-mart");
  expect(picker.parentElement?.style.width).toBe("300px");
});
