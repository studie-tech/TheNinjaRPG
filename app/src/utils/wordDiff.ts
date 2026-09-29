export type DiffPart = { op: "same" | "removed" | "added"; text: string };

/** Words, whitespace, punctuation and combat placeholders such as %user as separate tokens. */
const tokenize = (text: string) =>
  text.match(/%[a-z_]+|[\p{L}\p{N}']+|\s+|[^\s\p{L}\p{N}']/gu) ?? [];

/**
 * Word-level diff of two texts: longest common subsequence over tokens, with each run of
 * changes reported as its removed text followed by its added text so edits read as phrases.
 * Texts are capped so a pathological input cannot stall the page.
 */
export const wordDiff = (before: string, after: string): DiffPart[] => {
  const a = tokenize(before.slice(0, 5000));
  const b = tokenize(after.slice(0, 5000));
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as Uint16Array;
      row[j] =
        a[i] === b[j]
          ? ((table[i + 1] as Uint16Array)[j + 1] as number) + 1
          : Math.max((table[i + 1] as Uint16Array)[j] as number, row[j + 1] as number);
    }
  }
  const steps: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      steps.push({ op: "same", text: a[i] as string });
      i++;
      j++;
    } else if (
      ((table[i + 1] as Uint16Array)[j] as number) >=
      ((table[i] as Uint16Array)[j + 1] as number)
    ) {
      steps.push({ op: "removed", text: a[i] as string });
      i++;
    } else {
      steps.push({ op: "added", text: b[j] as string });
      j++;
    }
  }
  while (i < a.length) steps.push({ op: "removed", text: a[i++] as string });
  while (j < b.length) steps.push({ op: "added", text: b[j++] as string });
  // Whitespace between two changes belongs to the change, so "a b" -> "c d" reads as one edit.
  for (let k = 1; k < steps.length - 1; k++) {
    const step = steps[k] as DiffPart;
    if (
      step.op === "same" &&
      /^\s+$/.test(step.text) &&
      steps[k - 1]?.op !== "same" &&
      steps[k + 1]?.op !== "same"
    ) {
      steps.splice(
        k,
        1,
        { op: "removed", text: step.text },
        { op: "added", text: step.text },
      );
      k++;
    }
  }
  const parts: DiffPart[] = [];
  for (let k = 0; k < steps.length; k++) {
    if (steps[k]?.op === "same") {
      const last = parts[parts.length - 1];
      if (last?.op === "same") last.text += steps[k]?.text ?? "";
      else parts.push({ op: "same", text: steps[k]?.text ?? "" });
      continue;
    }
    let removed = "";
    let added = "";
    while (k < steps.length && steps[k]?.op !== "same") {
      if (steps[k]?.op === "removed") removed += steps[k]?.text ?? "";
      else added += steps[k]?.text ?? "";
      k++;
    }
    k--;
    if (removed) parts.push({ op: "removed", text: removed });
    if (added) parts.push({ op: "added", text: added });
  }
  return parts;
};

/**
 * Leaf values of a nested value keyed by dotted path ("0.power"), for showing which parts of
 * an effect list or quest content a change touches.
 */
export const flattenLeaves = (value: unknown, prefix = ""): Map<string, unknown> => {
  const leaves = new Map<string, unknown>();
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      if (node.length === 0) leaves.set(path, []);
      node.forEach((entry, index) => {
        walk(entry, path ? `${path}.${index}` : String(index));
      });
    } else if (node && typeof node === "object") {
      const entries = Object.entries(node);
      if (entries.length === 0) leaves.set(path, {});
      for (const [key, entry] of entries) walk(entry, path ? `${path}.${key}` : key);
    } else {
      leaves.set(path, node);
    }
  };
  walk(value, prefix);
  return leaves;
};
