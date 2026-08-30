import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Awaiting cache invalidations one after another costs one HTTP round-trip each, because the
 * refetch each one triggers only starts once the previous has landed. Fired together they leave
 * in the same tick and the tRPC httpBatchLink folds them into a single request, so a three-call
 * handler goes from three round-trips to one. This walks the client source and fails on any run
 * of awaited cache calls that should have been a single `await Promise.all([...])`.
 *
 * `cancel()` is deliberately not one of the verbs: it issues no request, and it is usually
 * followed by an invalidate or setData on the same key that must not race it. A pair that is
 * genuinely ordered can opt out with a `serial-invalidation-ok` comment saying why.
 */
const REPO_ROOT = join(import.meta.dirname, "../../..");
const SOURCE_ROOT = join(REPO_ROOT, "app/src");

/** Any receiver, since `api.useUtils()` is stored as both `utils` and `util` across the app. */
const CACHE_CALL =
  /^await\s+[\w$]+(?:\.[\w$]+)+\.(?:invalidate|refetch|prefetch|reset|fetch|ensureData)\(/;
const IGNORABLE = /^\s*(\/\/|\/\*|\*|$)/;
const OPT_OUT = "serial-invalidation-ok";
/** Enough for any real call; a bracket inside a string literal must not swallow the file. */
const MAX_STATEMENT_LINES = 15;

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

/**
 * Strings first, then comments, so a `//` inside a string is not mistaken for one. Enough to
 * keep a bracket or a semicolon written inside either of them out of the counting below; a
 * literal that itself spans lines is left to the statement-length bound.
 */
const code = (line: string) =>
  line
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
    .replace(/\/\*.*?\*\//g, " ")
    .replace(/\/\/.*$/, "")
    .trim();

/**
 * Awaited statements as single logical lines, so neither a wrapped argument list nor a member
 * chain broken across lines can hide a call.
 */
const awaitedStatements = (lines: string[]) => {
  const statements: { start: number; end: number; text: string }[] = [];
  let start = -1;
  let depth = 0;
  let text = "";
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (start < 0) {
      if (!trimmed.startsWith("await ")) return;
      start = index;
      text = "";
    }
    // Without this a statement trailed by a comment would never look finished
    const bare = code(trimmed);
    text += bare;
    depth += (bare.match(/[([]/g)?.length ?? 0) - (bare.match(/[)\]]/g)?.length ?? 0);
    if ((depth <= 0 && text.endsWith(";")) || index - start >= MAX_STATEMENT_LINES) {
      statements.push({ start, end: index, text });
      start = -1;
      depth = 0;
    }
  });
  return statements;
};

const serialRuns = (lines: string[], label: string) => {
  const calls = awaitedStatements(lines).filter((one) => CACHE_CALL.test(one.text));
  const runs: string[] = [];
  let runStart = 0;
  for (let call = 1; call <= calls.length; call++) {
    // A blank line or a comment between two awaits does not make them any less serial
    const previous = calls[call - 1];
    const next = calls[call];
    const continues =
      next !== undefined &&
      previous !== undefined &&
      lines.slice(previous.end + 1, next.start).every((line) => IGNORABLE.test(line));
    if (continues) continue;
    const first = calls[runStart];
    if (call - runStart >= 2 && first !== undefined && previous !== undefined) {
      const excused = lines
        .slice(Math.max(first.start - 1, 0), previous.end + 1)
        .some((line) => line.includes(OPT_OUT));
      if (!excused) {
        runs.push(`${label}:${first.start + 1} (${call - runStart} awaits in a row)`);
      }
    }
    runStart = call;
  }
  return runs;
};

describe("client cache invalidation", () => {
  it("never awaits invalidations one at a time", () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) =>
      serialRuns(readFileSync(path, "utf8").split("\n"), relative(REPO_ROOT, path)),
    );
    expect(
      offenders,
      `Batch these into one await Promise.all([...]) so the refetches share a request:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  // The scan above is only worth as much as what it can see, so pin down every shape it must
  // catch — and every one it must not, since a guard that cries wolf gets deleted
  const found = (source: string) => serialRuns(source.split("\n"), "fixture").length;
  const user = "await utils.profile.getUser.invalidate();";
  const clan = "await utils.clan.get.invalidate();";

  it.each([
    ["back to back", `${user}\n${clan}`],
    ["under the `util` alias", `await util.profile.getUser.invalidate();\n${clan}`],
    ["with a blank line between", `${user}\n\n${clan}`],
    ["with a comment between", `${user}\n// why\n${clan}`],
    ["with a wrapped argument list", `await utils.clan.get.invalidate({\n  id,\n});\n${clan}`],
    ["with a wrapped member chain", `await utils.profile.getUser\n.invalidate();\n${clan}`],
    ["with trailing comments", `${user} // the user\n${clan} // the clan`],
    ["with a trailing block comment", `${user} /* the user */\n${clan}`],
    ["with a bracket inside a string", `await utils.clan.get.invalidate("[");\n${clan}`],
  ])("catches two invalidations %s", (_shape, source) => {
    expect(found(source)).toBe(1);
  });

  it.each([
    ["one invalidation on its own", user],
    ["a statement between them", `${user}\nrouter.push("/");\n${clan}`],
    ["a cancel before an invalidate", `await utils.profile.getUser.cancel();\n${user}`],
    ["an opt-out", `// ${OPT_OUT}: the second reads what the first wrote\n${user}\n${clan}`],
  ])("leaves %s alone", (_shape, source) => {
    expect(found(source)).toBe(0);
  });
});
