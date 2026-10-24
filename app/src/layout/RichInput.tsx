"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bold,
  Code2,
  Eraser,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Quote,
  SendHorizontal,
  SmilePlus,
  Strikethrough,
  Underline,
  Upload,
} from "lucide-react";
import type Quill from "quill";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useController, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { TAVERN_IMAGE_MAX_SIZE_MB } from "@/drizzle/constants";
import EmojiPicker from "@/layout/EmojiPicker";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { getImageDimensions } from "@/utils/image";
import { needsHtmlSource, richTextInput } from "@/utils/richText";
import { useUploadThing } from "@/utils/uploadthing";
import { getSearchValidator } from "@/validators/register";
import "quill/dist/quill.core.css";
import "./RichInput.css";

/** Shared HTML composer with source preservation and an explicit plain-text opt-out. */
export const RichInput = (props: RichInputProps) => {
  const { field } = useController({ name: props.id, control: props.control });
  const value = (field.value as string) || "";
  const [sourceMode, setSourceMode] = useState(() => needsHtmlSource(value));
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlEntry, setUrlEntry] = useState<{
    kind: "link" | "image";
    value: string;
    range: { index: number; length: number };
  } | null>(null);
  const [mention, setMention] = useState<{ start: number; end: number } | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Distinguish external draft resets from the editor's own serialized updates.
  const lastValueRef = useRef(value);
  // Reject rapid duplicate events before React renders the pending state.
  const uploadInFlightRef = useRef(false);
  const uploadErrorRef = useRef<string | null>(null);
  // Release the containing form's upload lock exactly once, including on unmount.
  const uploadPendingRef = useRef(false);
  const generationRef = useRef(0);
  const blocked = !!props.disabled || uploading;
  const isSource = props.plainText || sourceMode;
  const userSearchSchema = getSearchValidator({ max: 1 });
  const mentionForm = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const selectedUsers = useWatch({
    control: mentionForm.control,
    name: "users",
    defaultValue: [],
  });
  const { startUpload } = useUploadThing("tavernUploader", {
    onUploadError: (error) => {
      uploadErrorRef.current = error.message;
    },
  });

  /** Search plain text while keeping replacement offsets in Quill's embed-aware coordinates. */
  const checkMention = (text: string, end: number, position = end) => {
    if (!props.enableMentions) return;
    const match = /(?:^|\s)@([^\s@]+)$/.exec(text.slice(0, end));
    const query = match?.[1];
    setMention(query ? { start: position - query.length - 1, end: position } : null);
    if (query) mentionForm.setValue("username", query);
  };

  /** Publish semantic HTML without clearing drafts that contain only an image. */
  const onEditorChange = useEffectEvent(() => {
    const editor = quillRef.current;
    if (!editor) return;
    const hasImage = editor
      .getContents()
      .ops.some((op) => typeof op.insert === "object");
    // Quill escapes ordinary spaces; retain a break point after each run while
    // preserving repeated spaces in the authored text.
    const html =
      editor.getText().trim() || hasImage
        ? editor.getSemanticHTML().replace(/((?:&nbsp;)*)&nbsp;/g, "$1 ")
        : "";
    lastValueRef.current = html;
    field.onChange(html);
  });
  const onSelectionChange = useEffectEvent(() => {
    const editor = quillRef.current;
    const range = editor?.getSelection();
    if (range && editor) {
      const before = editor.getText(0, range.index);
      checkMention(before, before.length, range.index);
    }
  });
  /** Read current options after lazy loading without restarting the editor on each edit. */
  const initialOptions = useEffectEvent(() => ({
    value,
    disabled: blocked,
    autoFocus: props.autoFocus ?? true,
  }));

  useEffect(() => {
    if (isSource)
      return () => {
        generationRef.current++;
      };
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const focusedBeforeLoad = document.activeElement;
    setReady(false);
    setLoadError(false);
    void import("quill")
      .then(({ default: Editor, Delta }) => {
        if (disposed) return;
        const container = document.createElement("div");
        host.replaceChildren(container);
        const options = initialOptions();
        const editor = new Editor(container, {
          formats: [
            "bold",
            "italic",
            "underline",
            "strike",
            "header",
            "list",
            "indent",
            "blockquote",
            "link",
            "image",
          ],
          modules: {
            toolbar: {
              container: toolbarRef.current,
              handlers: {
                // Keep block-format clearing at a collapsed caret.
                clean: () => {
                  const target = quillRef.current;
                  const range = target?.getSelection(true);
                  if (target && range)
                    target.removeFormat(range.index, range.length, "user");
                },
              },
            },
            // Files must use the moderated upload path, never Quill's data URLs.
            uploader: false,
            history: { userOnly: true },
          },
          readOnly: options.disabled,
        });
        quillRef.current = editor;
        editor.root.id = props.id;
        editor.root.setAttribute("role", "textbox");
        editor.root.setAttribute("aria-multiline", "true");
        editor.root.setAttribute(
          "aria-label",
          props.label || props.placeholder || "Message",
        );
        editor.root.dataset.placeholder = props.placeholder || "Write your message…";
        editor.clipboard.addMatcher("IMG", (node, delta) =>
          node instanceof Element &&
          /^(https?:\/\/|\/(?!\/))/i.test(node.getAttribute("src") || "")
            ? delta
            : new Delta(),
        );
        editor.setContents(
          editor.clipboard.convert(richTextInput(options.value)),
          "silent",
        );
        editor.history.clear();
        lastValueRef.current = options.value;
        editor.on("text-change", onEditorChange);
        // editor-change also reports silent selection updates used by mentions.
        editor.on("editor-change", onSelectionChange);
        editor.root.addEventListener("blur", field.onBlur);
        setReady(true);
        // Lazy loading must not steal focus from a control chosen in the meantime.
        if (
          options.autoFocus &&
          !options.disabled &&
          document.activeElement === focusedBeforeLoad
        )
          editor.focus({ preventScroll: true });
      })
      .catch(() => {
        if (!disposed) setLoadError(true);
      });
    return () => {
      disposed = true;
      generationRef.current++;
      const editor = quillRef.current;
      editor?.off("text-change", onEditorChange);
      editor?.off("editor-change", onSelectionChange);
      editor?.root.removeEventListener("blur", field.onBlur);
      quillRef.current = null;
      host.replaceChildren();
    };
  }, [isSource, props.refreshKey, props.id]);

  useEffect(() => {
    if (value === lastValueRef.current) return;
    generationRef.current++;
    lastValueRef.current = value;
    if (needsHtmlSource(value)) setSourceMode(true);
    const editor = quillRef.current;
    if (!editor) return;
    editor.setContents(editor.clipboard.convert(richTextInput(value)), "silent");
    editor.history.clear();
  }, [value]);

  useEffect(() => {
    quillRef.current?.enable(!blocked);
    if (blocked) {
      setEmojiOpen(false);
      setMention(null);
    }
  }, [blocked, ready]);

  useEffect(() => {
    const user = selectedUsers[0];
    if (!user || !mention || blocked) return;
    const editor = quillRef.current;
    const text = `@${user.username} `;
    if (editor && !isSource) {
      editor.deleteText(mention.start, mention.end - mention.start, "user");
      editor.insertText(mention.start, text, "user");
      editor.setSelection(mention.start + text.length, 0, "silent");
    } else {
      field.onChange(value.slice(0, mention.start) + text + value.slice(mention.end));
      textareaRef.current?.focus();
    }
    setMention(null);
    mentionForm.setValue("users", []);
    mentionForm.setValue("username", "");
  }, [selectedUsers]);

  /** Insert at the current or saved selection; background uploads preserve the author's focus. */
  const insertImage = (
    url: string,
    dimensions?: { width: number; height: number },
    target?: { index: number; restoreSelection: boolean },
  ) => {
    const editor = quillRef.current;
    if (!editor || isSource || props.disabled) return;
    const index = target?.index ?? editor.getSelection(true).index;
    editor.insertEmbed(index, "image", url, "user");
    if (dimensions)
      editor.formatText(index, 1, { alt: "Uploaded image", ...dimensions }, "user");
    if (!target || target.restoreSelection) editor.setSelection(index + 1, 0, "silent");
  };

  /** Upload original bytes and insert the result only into the same draft generation. */
  const uploadImage = async (file: File) => {
    if (
      blocked ||
      uploadInFlightRef.current ||
      !props.allowClipboardPaste ||
      props.plainText ||
      (!isSource && !quillRef.current)
    )
      return;
    if (
      !file.type.startsWith("image/") ||
      file.size > TAVERN_IMAGE_MAX_SIZE_MB * 1024 * 1024
    ) {
      showMutationToast({
        success: false,
        message: `Choose an image up to ${TAVERN_IMAGE_MAX_SIZE_MB} MB.`,
      });
      return;
    }
    uploadInFlightRef.current = true;
    uploadErrorRef.current = null;
    setUploading(true);
    uploadPendingRef.current = true;
    props.onUploadPendingChange?.(true);
    const generation = generationRef.current;
    const editor = quillRef.current;
    const source = isSource ? textareaRef.current : null;
    const selection = source
      ? { start: source.selectionStart, end: source.selectionEnd, value }
      : null;
    const visualRange = source ? null : editor?.getSelection(true);
    const focusedBeforeUpload = document.activeElement;
    try {
      const dimensions = await getImageDimensions(file);
      const result = (await startUpload([file]))?.[0]?.serverData;
      if (!result?.fileUrl || result.error)
        throw new Error(
          result?.error ||
            uploadErrorRef.current ||
            "Image upload failed. Please try again.",
        );
      // A reset, closed composer or account change must not receive an old upload.
      if (generation === generationRef.current && editor === quillRef.current) {
        if (source && selection && source === textareaRef.current) {
          const image = document.createElement("img");
          image.src = result.fileUrl;
          image.alt = "Uploaded image";
          image.width = dimensions.width;
          image.height = dimensions.height;
          const html = image.outerHTML;
          const nextValue =
            selection.value.slice(0, selection.start) +
            html +
            selection.value.slice(selection.end);
          lastValueRef.current = nextValue;
          field.onChange(nextValue);
          // Restore the caret after React enables the textarea, without taking
          // focus from another control chosen while the upload was pending.
          requestAnimationFrame(() => {
            if (generation !== generationRef.current || source !== textareaRef.current)
              return;
            const caret = selection.start + html.length;
            source.setSelectionRange(caret, caret);
            if (
              document.activeElement === document.body ||
              document.activeElement === focusedBeforeUpload
            )
              source.focus({ preventScroll: true });
          });
        } else if (editor && visualRange) {
          editor.enable(true);
          insertImage(result.fileUrl, dimensions, {
            index: visualRange.index,
            restoreSelection:
              document.activeElement === document.body ||
              document.activeElement === focusedBeforeUpload,
          });
        }
      }
    } catch (error) {
      showMutationToast({
        success: false,
        message: error instanceof Error ? error.message : "Image upload failed.",
      });
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
      if (uploadPendingRef.current) {
        uploadPendingRef.current = false;
        props.onUploadPendingChange?.(false);
      }
    }
  };

  useEffect(
    () => () => {
      if (uploadPendingRef.current) {
        uploadPendingRef.current = false;
        props.onUploadPendingChange?.(false);
      }
    },
    [],
  );

  useEffect(() => {
    const form = (hostRef.current || textareaRef.current)?.closest("form");
    if (!form || !uploading) return;
    const stopSubmit = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    form.addEventListener("submit", stopSubmit, true);
    return () => form.removeEventListener("submit", stopSubmit, true);
  }, [uploading]);

  useEffect(() => {
    if (props.disabled) generationRef.current++;
  }, [props.disabled]);

  const submit = () => {
    if (!blocked && !uploadInFlightRef.current) props.onSubmit?.();
  };
  /** Share send policy across textarea bubbling and Quill capture without blocking other newlines. */
  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (
      event.key === "Enter" &&
      props.onSubmit &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !isComposingKey(event.nativeEvent) &&
      !mention
    ) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  };
  const canEdit = !blocked && (isSource || ready);
  const height = /^\d+$/.test(props.height) ? `${props.height}px` : props.height;
  const isUrlValid = !!urlEntry && isCompleteWebUrl(urlEntry.value);
  /** Preserve the selected range while the URL popover temporarily owns focus. */
  const openUrlEntry = (kind: "link" | "image") => {
    const editor = quillRef.current;
    if (!editor || !canEdit) return;
    setUrlEntry({ kind, value: "", range: editor.getSelection(true) });
  };
  const closeUrlEntry = () => {
    if (urlEntry) {
      quillRef.current?.setSelection(urlEntry.range, "silent");
    }
    setUrlEntry(null);
  };
  const insertUrl = () => {
    const editor = quillRef.current;
    if (!canEdit || !editor || !urlEntry || !isUrlValid) return;
    const { kind, range } = urlEntry;
    const url = urlEntry.value.trim();
    editor.setSelection(range, "silent");
    if (kind === "image") insertImage(url);
    else {
      if (range.length)
        editor.formatText(range.index, range.length, "link", url, "user");
      else editor.insertText(range.index, url, { link: url }, "user");
      editor.setSelection(range.index + (range.length || url.length), 0, "silent");
    }
    setUrlEntry(null);
  };

  // Keep common actions visible while formatting controls scroll within narrow fields.
  const editorActions = (
    <>
      {uploading && (
        <span role="status" className="px-2">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          <span className="sr-only">Uploading image…</span>
        </span>
      )}
      {!props.plainText && props.allowClipboardPaste && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="Upload image"
          title="Upload image"
          disabled={!canEdit}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
        </Button>
      )}
      {!props.plainText && (
        <Button
          type="button"
          size="icon"
          variant={sourceMode ? "secondary" : "ghost"}
          className="h-8 w-8"
          aria-label={sourceMode ? "Visual editor" : "HTML"}
          aria-pressed={sourceMode}
          title={sourceMode ? "Visual editor" : "HTML source"}
          disabled={blocked}
          onClick={() => {
            setSourceMode(!sourceMode);
            setMention(null);
            setUrlEntry(null);
          }}
        >
          <Code2 className="h-4 w-4" />
        </Button>
      )}
      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Insert emoji"
            aria-label="Insert emoji"
            disabled={!canEdit}
          >
            <SmilePlus className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          collisionPadding={8}
          className="max-h-[var(--radix-popover-content-available-height)] w-[300px] overflow-y-auto border-0 p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (isSource) textareaRef.current?.focus();
            else quillRef.current?.focus({ preventScroll: true });
          }}
        >
          <EmojiPicker
            onSelect={(emoji) => {
              const editor = quillRef.current;
              if (editor && !isSource) {
                const range = editor.getSelection(true);
                editor.insertText(range.index, emoji, "user");
                editor.setSelection(range.index + emoji.length, 0, "silent");
              } else field.onChange(value + emoji);
              setEmojiOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {props.onSubmit && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Send message"
          aria-label="Send message"
          disabled={!canEdit}
          onClick={submit}
        >
          <SendHorizontal className="h-5 w-5" />
        </Button>
      )}
    </>
  );

  return (
    <div aria-disabled={blocked} className="min-w-0">
      {props.label && (
        <label htmlFor={props.id} className="mb-2 block text-sm font-medium">
          {props.label}
        </label>
      )}
      <div
        className="border-input bg-background text-foreground rounded-md border"
        data-rich-input
      >
        {!props.plainText && (
          <div className="flex min-w-0 items-center border-b">
            {!isSource && (
              // Quill's native toolbar listeners require new controls when the editor is recreated.
              <div
                key={`${props.id}:${props.refreshKey}`}
                ref={toolbarRef}
                className="rich-input-toolbar flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto p-1 [&>*]:shrink-0"
                role="toolbar"
                aria-label="Text formatting"
              >
                <select
                  className="ql-header bg-background rounded text-sm"
                  aria-label="Paragraph style"
                  disabled={!canEdit}
                  defaultValue=""
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.stopPropagation();
                  }}
                >
                  <option value="">Paragraph</option>
                  <option value="2">Heading</option>
                  <option value="3">Subheading</option>
                </select>
                {formatButtons.map(
                  ({ format, label, icon: Icon, value: buttonValue }) => (
                    <button
                      key={label}
                      className={`ql-${format}`}
                      type="button"
                      value={buttonValue}
                      title={label}
                      aria-label={label}
                      disabled={!canEdit}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ),
                )}
                <button
                  className="rich-input-link"
                  type="button"
                  title="Link"
                  aria-label="Link"
                  disabled={!canEdit}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openUrlEntry("link")}
                >
                  <Link2 className="h-4 w-4" />
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  title="Insert image URL"
                  aria-label="Insert image URL"
                  className="h-8 w-8"
                  disabled={!canEdit}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openUrlEntry("image")}
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1 p-1">
              {editorActions}
            </div>
          </div>
        )}
        <Popover
          open={!!urlEntry && !isSource}
          onOpenChange={(open) => {
            if (!open) closeUrlEntry();
          }}
        >
          <PopoverAnchor asChild>
            <div />
          </PopoverAnchor>
          {urlEntry && !isSource && (
            <PopoverContent
              align="start"
              aria-label={urlEntry.kind === "image" ? "Image URL" : "Link URL"}
              className="flex w-80 max-w-[calc(100vw-2rem)] flex-wrap gap-2 p-2"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <Input
                autoFocus
                aria-label={urlEntry.kind === "image" ? "Image URL" : "Link URL"}
                aria-invalid={!!urlEntry.value && !isUrlValid}
                aria-describedby={
                  urlEntry.value && !isUrlValid ? `${props.id}-url-error` : undefined
                }
                placeholder="https://…"
                value={urlEntry.value}
                disabled={!canEdit}
                onChange={(event) =>
                  setUrlEntry({ ...urlEntry, value: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    if (!isComposingKey(event.nativeEvent)) {
                      event.preventDefault();
                      insertUrl();
                    }
                  }
                }}
              />
              {urlEntry.value && !isUrlValid && (
                <p
                  id={`${props.id}-url-error`}
                  role="alert"
                  className="text-destructive w-full text-sm"
                >
                  Enter a complete URL beginning with http:// or https://.
                </p>
              )}
              <Button
                type="button"
                size="sm"
                disabled={!canEdit || !isUrlValid}
                onClick={insertUrl}
              >
                {urlEntry.kind === "image" ? "Insert image" : "Insert link"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeUrlEntry}>
                Cancel
              </Button>
            </PopoverContent>
          )}
        </Popover>
        {isSource ? (
          <Textarea
            ref={textareaRef}
            id={props.id}
            name={field.name}
            aria-label={props.label || "Message"}
            value={value}
            onBlur={field.onBlur}
            disabled={blocked}
            autoFocus={props.autoFocus ?? true}
            placeholder={props.placeholder}
            isDirty={props.isDirty}
            style={{ minHeight: height }}
            onPaste={(event) => {
              if (props.plainText || !props.allowClipboardPaste) return;
              const file = Array.from(event.clipboardData.files).find((item) =>
                item.type.startsWith("image/"),
              );
              if (file) {
                event.preventDefault();
                void uploadImage(file);
              }
            }}
            onChange={(event) => {
              field.onChange(event);
              checkMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.stopPropagation();
              submitOnEnter(event);
            }}
          />
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: delegates input events to Quill's accessible contenteditable textbox.
          <div
            className="rich-input-editor"
            ref={hostRef}
            style={{ minHeight: height }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.stopPropagation();
            }}
            onKeyDownCapture={submitOnEnter}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) event.preventDefault();
            }}
            onDropCapture={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              event.stopPropagation();
              const file = Array.from(event.dataTransfer.files).find((item) =>
                item.type.startsWith("image/"),
              );
              if (file) void uploadImage(file);
            }}
            onPasteCapture={(event) => {
              if (!props.allowClipboardPaste || !quillRef.current) return;
              const file = Array.from(event.clipboardData.files).find((item) =>
                item.type.startsWith("image/"),
              );
              if (file) {
                event.preventDefault();
                event.stopPropagation();
                void uploadImage(file);
              }
            }}
          />
        )}
        {!isSource && !ready && (
          <p role="status" className="p-2 text-sm">
            {loadError
              ? "Editor could not load. Use HTML mode to keep writing."
              : "Loading editor…"}
          </p>
        )}
        {props.plainText && (
          <div className="flex items-center justify-end gap-1 border-t p-1">
            {editorActions}
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Upload image file"
        disabled={!canEdit || props.plainText || !props.allowClipboardPaste}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadImage(file);
          event.target.value = "";
        }}
      />
      {mention && props.enableMentions && !blocked && (
        <UserSearchSelect
          useFormMethods={mentionForm}
          showYourself
          inline
          maxUsers={1}
          showAi
        />
      )}
      {!props.plainText && sourceMode && (
        <p className="text-muted-foreground mt-1 text-xs">
          HTML mode preserves advanced markup and embeds. Switching to visual editing
          supports basic formatting, links and images.
        </p>
      )}
      {props.error && (
        <div role="alert" className="text-xs text-red-500 italic">
          {props.error}
        </div>
      )}
    </div>
  );
};

/** Older WebKit can clear isComposing before the IME-confirming Enter. */
const isComposingKey = (event: KeyboardEvent) =>
  event.isComposing || event.keyCode === 229;

/** Require a complete HTTP(S) destination before closing the URL-entry popover. */
const isCompleteWebUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value.trim())) return false;
  try {
    return !!new URL(value.trim()).hostname;
  } catch {
    return false;
  }
};

const formatButtons = [
  { format: "bold", label: "Bold", icon: Bold },
  { format: "italic", label: "Italic", icon: Italic },
  { format: "underline", label: "Underline", icon: Underline },
  { format: "strike", label: "Strikethrough", icon: Strikethrough },
  { format: "list", value: "bullet", label: "Bullet list", icon: List },
  { format: "list", value: "ordered", label: "Numbered list", icon: ListOrdered },
  { format: "blockquote", label: "Quote", icon: Quote },
  { format: "clean", label: "Clear formatting", icon: Eraser },
];

interface RichInputProps {
  id: string;
  refreshKey?: number;
  label?: string;
  height: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  control: any;
  onSubmit?: (event?: any) => void;
  isDirty?: boolean;
  enableMentions?: boolean;
  /** Opt into moderated image paste, drop and file uploads. */
  allowClipboardPaste?: boolean;
  autoFocus?: boolean;
  /** Retain literal text for consumers that do not accept HTML. */
  plainText?: boolean;
  /** Let containing forms block submission until image insertion finishes. */
  onUploadPendingChange?: (pending: boolean) => void;
}

export default RichInput;
