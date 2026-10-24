"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bold,
  Eraser,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  SendHorizontal,
  SmilePlus,
  Strikethrough,
  Underline,
} from "lucide-react";
import type Quill from "quill";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useController, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Shared HTML composer. Plain text consumers explicitly opt out of formatting. */
export const RichInput = (props: RichInputProps) => {
  const { field } = useController({ name: props.id, control: props.control });
  const value = (field.value as string) || "";
  const [sourceMode, setSourceMode] = useState(() => needsHtmlSource(value));
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageUrlOpen, setImageUrlOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [mention, setMention] = useState<{ start: number; end: number } | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef(value);
  const uploadInFlightRef = useRef(false);
  const uploadErrorRef = useRef<string | null>(null);
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

  const checkMention = (text: string, end: number, position = end) => {
    if (!props.enableMentions) return;
    const match = /(?:^|\s)@([^\s@]+)$/.exec(text.slice(0, end));
    const query = match?.[1];
    setMention(query ? { start: position - query.length - 1, end: position } : null);
    if (query) mentionForm.setValue("username", query);
  };

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
    setFormats(editor.getFormat());
  });
  const onSelectionChange = useEffectEvent(() => {
    const editor = quillRef.current;
    const range = editor?.getSelection();
    if (range && editor) {
      const before = editor.getText(0, range.index);
      checkMention(before, before.length, range.index);
      setFormats(editor.getFormat(range));
    }
  });
  const initialOptions = useEffectEvent(() => ({
    value,
    disabled: blocked,
    autoFocus: props.autoFocus ?? true,
  }));

  useEffect(() => {
    if (isSource) return;
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
          modules: { toolbar: false, uploader: false, history: { userOnly: true } },
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
    if (needsHtmlSource(value)) setSourceMode(true);
    const editor = quillRef.current;
    if (!editor) return;
    generationRef.current++;
    editor.setContents(editor.clipboard.convert(richTextInput(value)), "silent");
    editor.history.clear();
    lastValueRef.current = value;
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

  const insertImage = (url: string, dimensions?: { width: number; height: number }) => {
    const editor = quillRef.current;
    if (!editor || isSource || props.disabled) return;
    const range = editor.getSelection(true);
    editor.insertEmbed(range.index, "image", url, "user");
    const [leaf] = editor.getLeaf(range.index + 1);
    if (dimensions && leaf?.domNode instanceof HTMLImageElement) {
      leaf.domNode.alt = "Uploaded image";
      leaf.domNode.width = dimensions.width;
      leaf.domNode.height = dimensions.height;
      editor.update("user");
    }
    editor.setSelection(range.index + 1, 0, "silent");
  };

  const uploadImage = async (file: File) => {
    if (blocked || uploadInFlightRef.current || !props.allowClipboardPaste) return;
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
        editor?.enable(true);
        insertImage(result.fileUrl, dimensions);
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
  const canEdit = !blocked && (isSource || ready);
  const height = /^\d+$/.test(props.height) ? `${props.height}px` : props.height;
  const addImageUrl = () => {
    if (!canEdit || !/^https?:\/\//i.test(imageUrl)) return;
    insertImage(imageUrl);
    setImageUrl("");
    setImageUrlOpen(false);
  };

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
          <div className="flex flex-wrap items-center justify-between gap-1 border-b px-2 py-1">
            <span className="text-muted-foreground text-xs">
              {sourceMode ? "HTML source" : "Rich text"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => {
                setSourceMode(!sourceMode);
                setMention(null);
                setImageUrlOpen(false);
              }}
            >
              {sourceMode ? "Visual editor" : "HTML"}
            </Button>
          </div>
        )}
        {!isSource && (
          <div
            className="rich-input-toolbar flex flex-wrap gap-1 border-b p-1"
            role="toolbar"
            aria-label="Text formatting"
          >
            <select
              className="ql-header bg-background rounded text-sm"
              aria-label="Paragraph style"
              disabled={!canEdit}
              value={String(formats.header || "")}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.stopPropagation();
              }}
              onChange={(event) => {
                const editor = quillRef.current;
                editor?.format("header", Number(event.target.value) || false, "user");
                if (editor) setFormats(editor.getFormat());
              }}
            >
              <option value="">Paragraph</option>
              <option value="2">Heading</option>
              <option value="3">Subheading</option>
            </select>
            {formatButtons.map(({ format, label, icon: Icon, value: buttonValue }) => (
              <button
                key={label}
                className={`ql-${format}`}
                type="button"
                value={buttonValue}
                title={label}
                aria-label={label}
                disabled={!canEdit}
                aria-pressed={
                  format !== "clean"
                    ? Boolean(
                        buttonValue ? formats[format] === buttonValue : formats[format],
                      )
                    : undefined
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const editor = quillRef.current;
                  if (!editor) return;
                  const range = editor.getSelection(true);
                  if (format === "clean")
                    editor.removeFormat(range.index, range.length, "user");
                  else
                    editor.format(
                      format,
                      buttonValue
                        ? formats[format] === buttonValue
                          ? false
                          : buttonValue
                        : !formats[format],
                      "user",
                    );
                  setFormats(editor.getFormat());
                }}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
            <button
              className="rich-input-link"
              type="button"
              title="Link"
              aria-label="Link"
              disabled={!canEdit}
              onClick={() => {
                const editor = quillRef.current;
                if (!editor) return;
                const range = editor.getSelection(true);
                const url = window.prompt("Link URL (https://…)", "https://");
                if (url && /^https?:\/\//i.test(url)) {
                  if (range.length)
                    editor.formatText(range.index, range.length, "link", url, "user");
                  else editor.insertText(range.index, url, { link: url }, "user");
                }
              }}
            >
              <Link2 className="h-4 w-4" />
            </button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title="Insert image URL"
              aria-label="Insert image URL"
              disabled={!canEdit}
              onClick={() => setImageUrlOpen(!imageUrlOpen)}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            {props.allowClipboardPaste && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => fileRef.current?.click()}
              >
                Upload image
              </Button>
            )}
          </div>
        )}
        {imageUrlOpen && !isSource && (
          <div className="flex flex-wrap gap-2 border-b p-2">
            <Input
              aria-label="Image URL"
              placeholder="https://…"
              value={imageUrl}
              disabled={!canEdit}
              onChange={(event) => setImageUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.stopPropagation();
                  if (!isComposingKey(event.nativeEvent)) {
                    event.preventDefault();
                    addImageUrl();
                  }
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || !/^https?:\/\//i.test(imageUrl)}
              onClick={addImageUrl}
            >
              Insert image
            </Button>
          </div>
        )}
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
            onChange={(event) => {
              field.onChange(event);
              checkMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.stopPropagation();
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
            onKeyDownCapture={(event) => {
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
            }}
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
              const file = Array.from(event.clipboardData.files).find((item) =>
                item.type.startsWith("image/"),
              );
              if (file) {
                event.preventDefault();
                event.stopPropagation();
                if (props.allowClipboardPaste !== false) void uploadImage(file);
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
        <div className="relative flex items-center justify-end gap-1 border-t p-1">
          {uploading && (
            <span role="status" className="mr-auto text-sm">
              Uploading image…
            </span>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Insert emoji"
            disabled={!canEdit}
            onClick={() => setEmojiOpen(!emojiOpen)}
          >
            <SmilePlus className="h-5 w-5" />
          </Button>
          {props.onSubmit && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Send message"
              disabled={!canEdit}
              onClick={submit}
            >
              <SendHorizontal className="h-5 w-5" />
            </Button>
          )}
          {emojiOpen && (
            <div className="absolute right-0 bottom-full z-50">
              <EmojiPicker
                onClickOutside={() => setEmojiOpen(false)}
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
            </div>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Upload image file"
        disabled={!canEdit}
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
  allowClipboardPaste?: boolean;
  autoFocus?: boolean;
  plainText?: boolean;
  onUploadPendingChange?: (pending: boolean) => void;
}

export default RichInput;
