/** Automatic audits cannot audition generated sounds or inspect scene art created at submission. */
import { readFile } from "node:fs/promises";

const file = process.env.PROPOSALS_FILE;
if (!file) throw new Error("PROPOSALS_FILE is required");
const { proposals } = JSON.parse(await readFile(file, "utf8"));
for (const [index, proposal] of proposals.entries()) {
  for (const change of proposal.changes) {
    for (const media of change.media) {
      if (!media.generate) continue;
      if (media.kind === "SFX") {
        throw new Error(`Suggestion ${index}: sound generation requires an explicit interactive request`);
      }
      if (media.kind === "IMAGE" && /^content\.(?:objectives\.\d+\.)?sceneCharacters\.\d+$/.test(media.path)) {
        throw new Error(`Suggestion ${index}: generated scene characters require interactive visual inspection`);
      }
    }
  }
}
console.log("Automatic audit media policy passed");
