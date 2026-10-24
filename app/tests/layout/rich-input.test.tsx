import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as image from "@/utils/image";
import * as uploadthing from "@/utils/uploadthing";
import * as toast from "@/libs/toast";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import { actualDialog, actualRichInput as RichInput } from "../setup/preload";
import { ensureDom } from "../setup-dom.mjs";

const startUpload = vi.fn();
const submit = vi.fn();
const uploadPending = vi.fn();
let spies: { mockRestore: () => void }[];
const eventDescriptors = ["Event", "CustomEvent"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeEach(() => {
  ensureDom();
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
  });
  vi.clearAllMocks();
  startUpload.mockReset();
  spies = [
    vi.spyOn(uploadthing, "useUploadThing").mockReturnValue({ startUpload } as never),
    vi.spyOn(UserSearchSelect, "default").mockImplementation(({ useFormMethods }: any) => <button type="button" onClick={() => useFormMethods.setValue("users", [{ username: "Alice", userId: "alice" }])}>Choose Alice</button>),
  ];
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, toJSON: () => ({}) });
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(async () => {
  cleanup();
  // Radix restores focus on a deferred turn, using the DOM's Event constructor.
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const spy of spies) spy.mockRestore();
  for (const [key, descriptor] of eventDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const Composer = ({ initial = "", resetValue = "", disabled = false, plainText = false, autoFocus = false, refreshKey = 0, allowClipboardPaste = true }: { initial?: string; resetValue?: string; disabled?: boolean; plainText?: boolean; autoFocus?: boolean; refreshKey?: number; allowClipboardPaste?: boolean }) => {
  const form = useForm({ defaultValues: { comment: initial } });
  return <form onSubmit={form.handleSubmit(submit)}><RichInput id="comment" label="Message" height="120" control={form.control} autoFocus={autoFocus} disabled={disabled} plainText={plainText} refreshKey={refreshKey} enableMentions allowClipboardPaste={allowClipboardPaste} onUploadPendingChange={uploadPending} onSubmit={form.handleSubmit(submit)} /><button type="button" onClick={() => form.reset({ comment: resetValue })}>Reset draft</button><button type="submit">Save</button></form>;
};
const editorFor = async (view: ReturnType<typeof render>) => {
  await waitFor(() => expect(view.getByRole("button", { name: "Bold" }).hasAttribute("disabled")).toBe(false));
  return view.getByRole("textbox", { name: "Message" });
};
const DialogComposer = () => {
  const [open, setOpen] = useState(true);
  return <actualDialog.Dialog open={open} onOpenChange={setOpen}><actualDialog.DialogContent><actualDialog.DialogTitle>Compose message</actualDialog.DialogTitle><Composer initial="Draft" /></actualDialog.DialogContent></actualDialog.Dialog>;
};

describe("rich input composer", () => {
  it("preserves advanced HTML loaded by form reset while the editor is loading", async () => {
    const initial = '<p>Before</p><iframe src="https://www.youtube.com/embed/test"></iframe><p>After</p>';
    const view = render(<Composer resetValue={initial} />);
    expect(view.getByRole("status").textContent).toBe("Loading editor…");
    fireEvent.click(view.getByRole("button", { name: "Reset draft" }));
    await waitFor(() => expect(view.getByRole("textbox", { name: "Message" }).tagName).toBe("TEXTAREA"));
    const editor = view.getByRole("textbox", { name: "Message" });
    expect((editor as HTMLTextAreaElement).value).toBe(initial);
    const edited = initial.replace("After", "Updated after");
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit.mock.calls[0]?.[0]).toEqual({ comment: edited }));
  });

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

  it.each(["ul", "ol"])("preserves nested %s lists after a visual formatting edit", async (list) => {
    const view = render(<Composer initial={`<${list}><li>Parent<${list}><li>Child</li></${list}></li><li>Sibling</li></${list}>`} />);
    const editor = await editorFor(view);
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(view.getByRole("button", { name: "Bold" }));
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]?.[0]).toEqual({ comment: `<${list}><li><strong>Parent</strong><${list}><li><strong>Child</strong></li></${list}></li><li><strong>Sibling</strong></li></${list}>` });
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

  it.each(['<h2 id="custom">Combat</h2>', '<a name="custom"></a><h2>Combat</h2>'])("preserves guide anchors while editing the body (%s)", async (anchor) => {
    const initial = `<a href="#custom">Jump to combat</a>${anchor}<p>Details</p>`;
    const view = render(<Composer initial={initial} />);
    const editor = view.getByRole("textbox", { name: "Message" });
    expect((editor as HTMLTextAreaElement).value).toBe(initial);
    const edited = initial.replace("Details", "Updated details");
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit.mock.calls[0]?.[0]).toEqual({ comment: edited }));
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
      fireEvent.keyDown(url, { key: "Enter", keyCode: 229, isComposing: false });
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

  it.each(["image", "link"] as const)("retains invalid %s URLs and lets the author correct them", async (kind) => {
    const view = render(<Composer initial="Draft" />);
    const editor = await editorFor(view);
    fireEvent.click(view.getByRole("button", { name: kind === "image" ? "Insert image URL" : "Link" }));
    const input = view.getByRole("textbox", { name: kind === "image" ? "Image URL" : "Link URL" });
    const insert = view.getByRole("button", { name: `Insert ${kind}` });
    expect(insert.hasAttribute("disabled")).toBe(true);
    for (const value of ["https://", "https://?", "not a url", "ftp://example.com/file"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect((input as HTMLInputElement).value).toBe(value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(view.getByRole("alert").textContent).toContain("Enter a complete URL");
      expect(insert.hasAttribute("disabled")).toBe(true);
      expect(editor.querySelector("a, img")).toBeNull();
      expect(submit).not.toHaveBeenCalled();
    }
    const url = "http://localhost:3341/favicon.ico";
    fireEvent.change(input, { target: { value: url } });
    expect(view.queryByRole("alert")).toBeNull();
    expect(insert.hasAttribute("disabled")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(editor.querySelector("a, img")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(editor.querySelector("a, img")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor.querySelector(kind === "image" ? "img" : "a")?.getAttribute(kind === "image" ? "src" : "href")).toBe(url);
    expect(view.queryByRole("textbox", { name: /^(Image|Link) URL$/ })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps selected link text through URL correction and returns focus after insertion", async () => {
    const view = render(<Composer initial="Before selected after" />);
    const editor = await editorFor(view);
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.querySelector("p")!.firstChild!, 7);
    range.setEnd(editor.querySelector("p")!.firstChild!, 15);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(view.getByRole("button", { name: "Link" }));
    const input = view.getByRole("textbox", { name: "Link URL" });
    fireEvent.change(input, { target: { value: "https://" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "https://example.com/guide" } });
    fireEvent.click(view.getByRole("button", { name: "Insert link" }));
    expect(editor.textContent).toBe("Before selected after");
    expect(editor.querySelector("a")?.textContent).toBe("selected");
    expect(document.activeElement).toBe(editor);
  });

  it("dismisses URL entry when the author returns to the document", async () => {
    const view = render(<Composer initial="Before selected after" />);
    const editor = await editorFor(view);
    editor.focus();
    fireEvent.click(view.getByRole("button", { name: "Insert image URL" }));
    const input = view.getByRole("textbox", { name: "Image URL" });
    fireEvent.change(input, { target: { value: "https://example.com/image.png" } });
    act(() => editor.focus());
    await waitFor(() => expect(view.queryByRole("textbox", { name: "Image URL" })).toBeNull());
    expect(editor.textContent).toBe("Before selected after");
    expect(editor.querySelector("img")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["Cancel", "Escape"])("preserves the draft and selection when a URL is cancelled with %s", async (method) => {
    const view = render(<Composer initial="Draft" />);
    const editor = await editorFor(view);
    editor.focus();
    const before = editor.innerHTML;
    fireEvent.click(view.getByRole("button", { name: "Link" }));
    const input = view.getByRole("textbox", { name: "Link URL" });
    fireEvent.change(input, { target: { value: "https://" } });
    if (method === "Cancel") fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    else fireEvent.keyDown(input, { key: "Escape" });
    expect(view.queryByRole("textbox", { name: "Link URL" })).toBeNull();
    expect(editor.innerHTML).toBe(before);
    expect(document.activeElement).toBe(editor);
    expect(submit).not.toHaveBeenCalled();
  });

  it("closes only URL entry when Escape is pressed inside a draft dialog", async () => {
    const view = render(<DialogComposer />);
    const editor = await editorFor(view);
    fireEvent.click(view.getByRole("button", { name: "Link" }));
    const input = view.getByRole("textbox", { name: "Link URL" });
    fireEvent.change(input, { target: { value: "https://" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("textbox", { name: "Link URL" })).toBeNull());
    expect(view.getByRole("dialog", { name: "Compose message" })).toBeDefined();
    expect(editor.textContent).toBe("Draft");
    expect(document.activeElement).toBe(editor);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not send on a legacy IME confirmation (plain text: %s)", async (plainText) => {
    const view = render(<Composer initial="Draft" plainText={plainText} />);
    const editor = plainText ? view.getByRole("textbox", { name: "Message" }) : await editorFor(view);
    fireEvent.keyDown(editor, { key: "Enter", keyCode: 229, isComposing: false });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(submit).toHaveBeenCalled());
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

  const advancedHtml = '<h2 id="combat">Combat</h2><p>Replace me</p><iframe src="https://www.youtube.com/embed/test"></iframe>';
  const originalFile = () => new File(["original bytes"], "original.png", { type: "image/png" });
  const pasteImage = (editor: HTMLElement, file = originalFile()) => fireEvent.paste(editor, { clipboardData: { files: [file] } });

  it.each(["paste", "file"])("uploads a source %s at the selection without changing advanced HTML or dimensions", async (method) => {
    let finish: (result: unknown) => void = () => {};
    startUpload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    spies.push(vi.spyOn(image, "getImageDimensions").mockResolvedValue({ width: 1920, height: 1080 }));
    const view = render(<Composer initial={advancedHtml} />);
    const editor = view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    editor.focus();
    const start = advancedHtml.indexOf("Replace me");
    editor.setSelectionRange(start, start + "Replace me".length);
    const file = originalFile();
    if (method === "paste") expect(pasteImage(editor, file)).toBe(false);
    else {
      const chooser = vi.spyOn(view.getByLabelText("Upload image file"), "click");
      fireEvent.click(view.getByRole("button", { name: "Upload image" }));
      expect(chooser).toHaveBeenCalled();
      chooser.mockRestore();
      fireEvent.change(view.getByLabelText("Upload image file"), { target: { files: [file] } });
    }
    await waitFor(() => expect(startUpload).toHaveBeenCalledWith([file]));
    expect(editor.disabled).toBe(true);
    expect(uploadPending).toHaveBeenLastCalledWith(true);
    pasteImage(editor);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(startUpload).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    await act(async () => { finish([{ serverData: { fileUrl: "https://example.com/original.png" } }]); });
    const html = '<img src="https://example.com/original.png" alt="Uploaded image" width="1920" height="1080">';
    const expected = advancedHtml.replace("Replace me", html);
    await waitFor(() => expect(editor.value).toBe(expected));
    await waitFor(() => expect(editor.selectionStart).toBe(start + html.length));
    expect(editor.selectionEnd).toBe(editor.selectionStart);
    expect(editor.disabled).toBe(false);
    expect(uploadPending).toHaveBeenLastCalledWith(false);
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(submit.mock.calls[0]?.[0]).toEqual({ comment: expected }));
  });

  it("keeps a source draft and recovers after a moderated upload rejection", async () => {
    startUpload.mockResolvedValueOnce([{ serverData: { error: "Daily upload allowance reached." } }]).mockResolvedValueOnce([{ serverData: { fileUrl: "https://example.com/retry.png" } }]);
    const showToast = vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
    spies.push(showToast, vi.spyOn(image, "getImageDimensions").mockResolvedValue({ width: 800, height: 600 }));
    const view = render(<Composer initial={advancedHtml} />);
    const editor = view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 0);
    pasteImage(editor);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ success: false, message: "Daily upload allowance reached." }));
    expect(editor.value).toBe(advancedHtml);
    expect(editor.disabled).toBe(false);
    expect(uploadPending).toHaveBeenLastCalledWith(false);
    pasteImage(editor);
    await waitFor(() => expect(editor.value).toContain('src="https://example.com/retry.png"'));
    expect(editor.value.endsWith(advancedHtml)).toBe(true);
  });

  it.each(["reset", "refresh", "disabled", "unmount"])("discards a source upload completed after %s", async (change) => {
    let finish: (result: unknown) => void = () => {};
    startUpload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    spies.push(vi.spyOn(image, "getImageDimensions").mockResolvedValue({ width: 800, height: 600 }));
    const view = render(<Composer initial={advancedHtml} resetValue="New draft" />);
    pasteImage(view.getByRole("textbox", { name: "Message" }));
    await waitFor(() => expect(startUpload).toHaveBeenCalled());
    if (change === "reset") fireEvent.click(view.getByRole("button", { name: "Reset draft" }));
    if (change === "refresh") view.rerender(<Composer initial={advancedHtml} refreshKey={1} />);
    if (change === "disabled") view.rerender(<Composer initial={advancedHtml} disabled />);
    if (change === "unmount") view.unmount();
    await act(async () => { finish([{ serverData: { fileUrl: "https://example.com/stale.png" } }]); });
    expect(uploadPending).toHaveBeenLastCalledWith(false);
    if (change !== "unmount") expect((view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(change === "reset" ? "New draft" : advancedHtml);
  });

  it("does not take focus from another control after a source upload", async () => {
    let finish: (result: unknown) => void = () => {};
    startUpload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    spies.push(vi.spyOn(image, "getImageDimensions").mockResolvedValue({ width: 800, height: 600 }));
    const view = render(<Composer initial={advancedHtml} />);
    const editor = view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);
    pasteImage(editor);
    await waitFor(() => expect(startUpload).toHaveBeenCalled());
    const chosen = view.getByRole("button", { name: "Save" });
    chosen.focus();
    await act(async () => { finish([{ serverData: { fileUrl: "https://example.com/upload.png" } }]); });
    await waitFor(() => expect(editor.selectionStart).toBeGreaterThan(0));
    expect(document.activeElement).toBe(chosen);
  });

  it.each(["plain", "disallowed"])("keeps image attachments unavailable for %s source inputs", (kind) => {
    const view = render(<Composer initial={advancedHtml} plainText={kind === "plain"} allowClipboardPaste={kind !== "disallowed"} />);
    const editor = view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(pasteImage(editor)).toBe(true);
    expect(startUpload).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Upload image" })).toBeNull();
    expect(editor.value).toBe(advancedHtml);
  });
});
