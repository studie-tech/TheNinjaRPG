import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useForm } from "react-hook-form";
import * as image from "@/utils/image";
import * as uploadthing from "@/utils/uploadthing";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import { actualRichInput as RichInput } from "../setup/preload";
import { ensureDom } from "../setup-dom.mjs";

const startUpload = vi.fn();
const submit = vi.fn();
let spies: { mockRestore: () => void }[];
beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  spies = [
    vi.spyOn(uploadthing, "useUploadThing").mockReturnValue({ startUpload } as never),
    vi.spyOn(UserSearchSelect, "default").mockImplementation(({ useFormMethods }: any) => <button type="button" onClick={() => useFormMethods.setValue("users", [{ username: "Alice", userId: "alice" }])}>Choose Alice</button>),
  ];
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, toJSON: () => ({}) });
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(() => { cleanup(); for (const spy of spies) spy.mockRestore(); });

const Composer = ({ initial = "", disabled = false, plainText = false, autoFocus = false }: { initial?: string; disabled?: boolean; plainText?: boolean; autoFocus?: boolean }) => {
  const form = useForm({ defaultValues: { comment: initial } });
  return <form onSubmit={form.handleSubmit(submit)}><RichInput id="comment" label="Message" height="120" control={form.control} autoFocus={autoFocus} disabled={disabled} plainText={plainText} enableMentions allowClipboardPaste onSubmit={form.handleSubmit(submit)} /><button type="button" onClick={() => form.reset({ comment: "" })}>Reset draft</button><button type="submit">Save</button></form>;
};
const editorFor = async (view: ReturnType<typeof render>) => {
  await waitFor(() => expect(view.getByRole("button", { name: "Bold" }).hasAttribute("disabled")).toBe(false));
  return view.getByRole("textbox", { name: "Message" });
};

describe("rich input composer", () => {
  it("does not steal focus chosen while the editor loads", async () => {
    const view = render(<Composer autoFocus />);
    const chosen = view.getByRole("button", { name: "Reset draft" });
    chosen.focus();
    await editorFor(view);
    expect(document.activeElement).toBe(chosen);
  });

  it("preserves existing HTML until an explicit edit and honors form reset", async () => {
    const initial = '<p><strong>Saved</strong> text</p>';
    const view = render(<Composer initial={initial} />);
    const editor = await editorFor(view);
    expect(editor.innerHTML).toContain("<strong>Saved</strong>");
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]?.[0]).toEqual({ comment: initial });
    fireEvent.click(view.getByRole("button", { name: "Reset draft" }));
    await waitFor(() => expect(editor.textContent).toBe(""));
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit.mock.calls.at(-1)?.[0]).toEqual({ comment: "" }));
  });

  it.each(["two words", "two  words"])("submits breakable spaces after editing visual text (%s)", async (text) => {
    const view = render(<Composer initial={text} />);
    const editor = await editorFor(view);
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(view.getByRole("button", { name: "Bold" }));
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]?.[0]).toEqual({ comment: `<p><strong>${text === "two words" ? "two words" : "two&nbsp; words"}</strong></p>` });
  });

  it("keeps source edits when switching back to visual mode", async () => {
    const view = render(<Composer />);
    await editorFor(view);
    fireEvent.click(view.getByRole("button", { name: "HTML" }));
    fireEvent.change(view.getByRole("textbox", { name: "Message" }), { target: { value: "<p><strong>Source draft</strong></p>" } });
    fireEvent.click(view.getByRole("button", { name: "Visual editor" }));
    const editor = await editorFor(view);
    expect(editor.innerHTML).toContain("<strong>Source draft</strong>");
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]?.[0]).toEqual({ comment: "<p><strong>Source draft</strong></p>" });
  });

  it("keeps legacy embeds editable as source and leaves plain-text consumers unformatted", () => {
    const legacy = '<iframe src="https://www.youtube.com/embed/test"></iframe>';
    const view = render(<Composer initial={legacy} />);
    expect((view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(legacy);
    expect(view.queryByRole("button", { name: "Bold" })).toBeNull();
    view.unmount();
    const plain = render(<Composer plainText initial="plain < text" />);
    expect((plain.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("plain < text");
    expect(plain.queryByRole("button", { name: "HTML" })).toBeNull();
  });

  it("disables editing and sending while a mutation is pending", async () => {
    const view = render(<Composer initial="Draft" />);
    await editorFor(view);
    view.rerender(<Composer initial="Draft" disabled />);
    await waitFor(() => expect(view.getByRole("textbox", { name: "Message" }).getAttribute("contenteditable")).toBe("false"));
    expect(view.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "HTML" }).hasAttribute("disabled")).toBe(true);
  });

  it("toggles collapsed formatting without requiring a text change", async () => {
    const view = render(<Composer />);
    const editor = await editorFor(view);
    editor.focus();
    fireEvent.click(view.getByRole("button", { name: "Bold" }));
    expect(view.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Bold" }));
    expect(view.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps formatting and image-URL Enter keys out of parent dialogs", async () => {
    const view = render(<Composer initial="Draft" />);
    const editor = await editorFor(view);
    const documentKey = vi.fn();
    document.addEventListener("keydown", documentKey);
    try {
      fireEvent.keyDown(view.getByRole("combobox", { name: "Paragraph style" }), { key: "Enter" });
      expect(documentKey).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole("button", { name: "Insert image URL" }));
      const url = view.getByRole("textbox", { name: "Image URL" });
      fireEvent.change(url, { target: { value: "https://example.com/image.png" } });
      fireEvent.keyDown(url, { key: "Enter", isComposing: true });
      expect(view.getByRole("textbox", { name: "Image URL" })).toBe(url);
      expect(editor.querySelector("img")).toBeNull();
      fireEvent.keyDown(url, { key: "Enter" });
      expect(editor.querySelector("img")?.getAttribute("src")).toBe("https://example.com/image.png");
      expect(view.queryByRole("textbox", { name: "Image URL" })).toBeNull();
      expect(documentKey).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", documentKey);
    }
  });

  it("blocks a parent form during upload and preserves original file bytes", async () => {
    let finish: (result: unknown) => void = () => {};
    startUpload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    spies.push(vi.spyOn(image, "getImageDimensions").mockResolvedValue({ width: 1920, height: 1080 }));
    const view = render(<Composer initial="Draft" />);
    await editorFor(view);
    const file = new File(["original bytes"], "original.png", { type: "image/png" });
    fireEvent.change(view.getByLabelText("Upload image file"), { target: { files: [file] } });
    await waitFor(() => expect(startUpload).toHaveBeenCalledWith([file]));
    expect(view.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(submit).not.toHaveBeenCalled();
    await act(async () => { finish([{ serverData: { fileUrl: "https://example.com/original.png" } }]); });
    await waitFor(() => expect(view.getByRole("textbox", { name: "Message" }).querySelector("img")?.getAttribute("width")).toBe("1920"));
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]?.[0].comment).toContain('height="1080"');
  });
});
