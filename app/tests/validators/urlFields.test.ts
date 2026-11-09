import { describe, expect, it } from "bun:test";
import { getClanSearchSchema } from "@/validators/clan";
import { mapAssetValidator } from "@/validators/mapAsset";
import { mapTerrainValidator } from "@/validators/mapTerrain";

const accepted = [
  ["http://a.b", "http://a.b"],
  ["https://a.b/c?d=e", "https://a.b/c?d=e"],
  ["ftp://x", "ftp://x"],
  ["mailto:a@b.c", "mailto:a@b.c"],
  [" http://a.b", "http://a.b"],
  ["HTTP://A.B", "HTTP://A.B"],
  ["http://localhost:3000", "http://localhost:3000"],
] as const;
const rejectedFormats = ["", "x", "http://", "//a"];

const firstIssue = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

const fields = {
  "map asset image": { schema: mapAssetValidator.shape.imageUrl, nullable: false },
  "map terrain texture": {
    schema: mapTerrainValidator.shape.textureUrl,
    nullable: true,
  },
};

describe("URL fields", () => {
  for (const [name, { schema, nullable }] of Object.entries(fields)) {
    it(`${name} accepts URLs of any scheme and normalizes nothing else`, () => {
      for (const [input, output] of accepted) expect(schema.parse(input)).toBe(output);
    });

    it(`${name} reports malformed values`, () => {
      for (const input of rejectedFormats) {
        expect(firstIssue(schema.safeParse(input))).toBe("Invalid URL");
      }
      expect(firstIssue(schema.safeParse(1))).toBe(
        "Invalid input: expected string, received number",
      );
      expect(schema.safeParse(undefined).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(nullable);
    });
  }

  it("clan search accepts a missing, null or valid image only", () => {
    const parse = (image: unknown) =>
      getClanSearchSchema(1).safeParse({
        name: "search",
        clans: [{ id: "a", name: "Clan", image }],
      });
    expect(parse(undefined).data?.clans[0]).toEqual({ id: "a", name: "Clan" });
    expect(parse(null).data?.clans[0]).toEqual({ id: "a", name: "Clan", image: null });
    expect(parse("https://a.b/c.webp").success).toBe(true);
    expect(firstIssue(parse("x"))).toBe("Invalid URL");
    expect(firstIssue(parse(1))).toBe(
      "Invalid input: expected string, received number",
    );
  });
});
