/**
 * Applies the content audit's verdicts on the battlefield renders of its own suggestions
 * before they are submitted: drops the suggestions it rejected, removes candidate assets that
 * looked wrong in battle, and drops a suggestion that uses a rejected asset directly or has an
 * animation request without candidates left.
 *
 * Env vars consumed:
 *   PROPOSALS_FILE  the audit's output ({ proposals })
 *   VERDICTS_FILE   the visual check's output ({ verdicts }); may be absent when nothing
 *                   needed a render
 *   OUT_FILE        where to write the proposals to submit
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const readJson = async (file, fallback) => {
  if (!file) return fallback;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
};

const parsed = (valueJson) => {
  try {
    return JSON.parse(valueJson);
  } catch {
    return undefined;
  }
};

const output = await readJson(required("PROPOSALS_FILE"));
const { verdicts } = await readJson(process.env.VERDICTS_FILE, { verdicts: [] });
const notes = [];

const proposals = output.proposals.flatMap((proposal, index) => {
  const verdict = verdicts.find((entry) => entry.index === index);
  if (!verdict) return [proposal];
  const label = `Suggestion ${index} (${proposal.title})`;
  if (!verdict.keep) {
    notes.push(`Dropped ${label} after its battlefield render: ${verdict.reason}`);
    return [];
  }
  const rejected = new Set(verdict.rejectedAssetIds);
  if (rejected.size === 0) return [proposal];
  const setsRejected = proposal.changes.some((change) =>
    change.set.some((op) => rejected.has(parsed(op.valueJson))),
  );
  const changes = proposal.changes.map((change) => ({
    ...change,
    media: change.media.map((request) => ({
      ...request,
      catalogIds: request.catalogIds.filter((id) => !rejected.has(id)),
    })),
  }));
  const emptied = changes.some((change) =>
    change.media.some(
      (request) =>
        request.catalogIds.length === 0 && !request.search && !request.generate,
    ),
  );
  if (setsRejected || emptied) {
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
