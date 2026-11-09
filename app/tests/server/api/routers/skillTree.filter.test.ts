import { describe, expect, it } from "bun:test";
import { and } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { skillTreeDatabaseFilter } from "@/server/api/routers/skillTree";

describe("skill tree database filter", () => {
  it("matches any of the selected effects", () => {
    const query = new MySqlDialect().sqlToQuery(
      and(...skillTreeDatabaseFilter({ effect: ["absorb", "reflect"] }))!,
    );
    expect(query.params).toEqual(expect.arrayContaining(["absorb", "reflect"]));
    expect(query.sql.match(/JSON_SEARCH/g)).toHaveLength(2);
    expect(query.sql).toContain(" or ");
  });
});
