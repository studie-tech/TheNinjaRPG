import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { indexableConceptArt } from "@/libs/conceptart";

describe("indexableConceptArt", () => {
  it("requires the final video for video rows", () => {
    const query = new MySqlDialect().sqlToQuery(indexableConceptArt!);

    expect(query.sql).toContain("`ConceptImage`.`image` is not null");
    expect(query.sql).toContain("`ConceptImage`.`video` is not null");
    expect(query.sql).toMatch(
      /`ConceptImage`.`mediaType` = \? or \(`ConceptImage`.`mediaType` = \? and `ConceptImage`.`video` is not null\)/,
    );
    expect(query.sql).toContain("`ConceptImage`.`done` = ?");
    expect(query.sql).toContain("`ConceptImage`.`userId` is not null");
    expect(query.sql).toContain("`ConceptImage`.`hidden` = ?");
    expect(query.params).toEqual([true, false, "image", "video"]);
  });
});
