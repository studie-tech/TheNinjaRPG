import {
  applyBloodrightChanges,
  normalizeBloodrightTag,
} from "@/libs/bloodrightEffects";
import type { BloodrightChange } from "@/validators/bloodright";
import type { ZodAllTags } from "@/validators/combat";

/** Show the precise tag field, increase and resulting value for each configured change. */
export const BloodrightChanges = ({
  changes,
  effects,
}: {
  changes: BloodrightChange[];
  effects: ZodAllTags[];
}) => {
  const modified = applyBloodrightChanges(effects, changes);
  const valueAt = (tag: unknown, field: string): unknown =>
    field
      .split(".")
      .reduce<unknown>(
        (value, key) =>
          value && typeof value === "object"
            ? (value as Record<string, unknown>)[key]
            : undefined,
        tag,
      );
  return (
    <ul className="space-y-1 text-sm">
      {changes.map((change, index) => (
        <li key={`${change.tagIndex}-${change.field}-${index}`}>
          <span className="font-semibold">
            Tag {change.tagIndex + 1}: {change.tag.type} · {change.field}
          </span>{" "}
          +{change.value}
          {change.mode === "PERCENT" ? "%" : ""}
          {modified && (
            <>
              {" "}
              (
              {String(
                valueAt(normalizeBloodrightTag(effects[change.tagIndex]), change.field),
              )}{" "}
              → {String(valueAt(modified[change.tagIndex], change.field))})
            </>
          )}
        </li>
      ))}
    </ul>
  );
};
