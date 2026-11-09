import type {
  Moderation,
  ModerationCreateResponse,
} from "openai/resources/moderations";

export const unflaggedModeration = (): ModerationCreateResponse => {
  const categories: Moderation["categories"] = {
    sexual: false,
    "sexual/minors": false,
    harassment: false,
    "harassment/threatening": false,
    hate: false,
    "hate/threatening": false,
    illicit: false,
    "illicit/violent": false,
    "self-harm": false,
    "self-harm/intent": false,
    "self-harm/instructions": false,
    violence: false,
    "violence/graphic": false,
  };
  return {
    id: "test",
    model: "omni-moderation-latest",
    results: [
      {
        flagged: false,
        categories,
        category_scores: Object.fromEntries(
          Object.keys(categories).map((key) => [key, 0]),
        ) as unknown as Moderation["category_scores"],
        category_applied_input_types: Object.fromEntries(
          Object.keys(categories).map((key) => [key, ["text"]]),
        ) as unknown as Moderation["category_applied_input_types"],
      },
    ],
  };
};
