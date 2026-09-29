/**
 * Applies the content audit's verdicts on the battlefield renders of its own suggestions
 * before they are submitted: drops the suggestions it rejected or left without a verdict,
 * removes candidate assets that looked wrong in battle, and drops a suggestion that still
 * names a rejected asset anywhere in its values or is left with a media request that has no
 * candidate, search or generation. Every drop and trim is logged and added to the step
 * summary.
 *
 * Env vars consumed:
 *   PROPOSALS_FILE    the audit's output ({ proposals })
 *   VERDICTS_FILE     the visual check's output ({ verdicts }); may be absent when nothing
 *                     needed a render
 *   RENDERED_INDICES  JSON array of the proposal indices that were drawn; only those need,
 *                     and are changed by, a verdict
 *   OUT_FILE          where to write the proposals to submit
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

/** Parsed contents of `file`, or `fallback` when the path is unset or the file is missing. */
const readJson = async (file, fallback) => {
  if (!file) return fallback;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
};

/** The value a set operation writes, or undefined when its JSON is malformed. */
const parsed = (valueJson) => {
  try {
    return JSON.parse(valueJson);
  } catch {
    return undefined;
  }
};

/** Whether `value`, or anything nested in it such as an effect list, names one of `ids`. */
const namesAny = (value, ids) =>
  typeof value === "string"
    ? ids.has(value)
    : value !== null &&
      typeof value === "object" &&
      Object.values(value).some((entry) => namesAny(entry, ids));

const output = await readJson(required("PROPOSALS_FILE"));
const { verdicts } = await readJson(process.env.VERDICTS_FILE, { verdicts: [] });
const rendered = new Set(parsed(process.env.RENDERED_INDICES || "[]") ?? []);
const notes = [];

const proposals = output.proposals.flatMap((proposal, index) => {
  if (!rendered.has(index)) return [proposal];
  const label = `Suggestion ${index} (${proposal.title})`;
  const verdict = verdicts.find((entry) => entry.index === index);
  if (!verdict) {
    notes.push(`Dropped ${label}: its battlefield render got no verdict`);
    return [];
  }
  if (!verdict.keep) {
    notes.push(`Dropped ${label} after its battlefield render: ${verdict.reason}`);
    return [];
  }
  const rejected = new Set(verdict.rejectedAssetIds);
  if (rejected.size === 0) return [proposal];
  const hasRejectedValue = proposal.changes.some((change) =>
    change.set.some((op) => namesAny(parsed(op.valueJson), rejected)),
  );
  const changes = proposal.changes.map((change) => ({
    ...change,
    media: change.media.map((request) => ({
      ...request,
      catalogIds: request.catalogIds.filter((id) => !rejected.has(id)),
    })),
  }));
  const hasEmptyRequest = changes.some((change) =>
    change.media.some(
      (request) =>
        request.catalogIds.length === 0 && !request.search && !request.generate,
    ),
  );
  if (hasRejectedValue || hasEmptyRequest) {
    notes.push(`Dropped ${label}: no asset left that looks right in battle. ${verdict.reason}`);
    return [];
  }
  notes.push(`Kept ${label} without ${[...rejected].join(", ")}: ${verdict.reason}`);
  return [{ ...proposal, changes }];
});

await writeFile(required("OUT_FILE"), JSON.stringify({ ...output, proposals }));
for (const note of notes) console.log(note);
if (process.env.GITHUB_STEP_SUMMARY && notes.length > 0) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `Battlefield check:\n\n${notes.map((note) => `- ${note}`).join("\n")}\n\n`,
  );
}
