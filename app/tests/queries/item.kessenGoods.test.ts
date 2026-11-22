import { describe, expect, it } from "bun:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { KESSEN_PACK_ID_PREFIX } from "@/drizzle/constants";
import { kessenGoodsCondition } from "@/queries/item";

const dialect = new MySqlDialect();

describe("Kessen goods catalog condition", () => {
  it("matches cards and card packs, and the general shops' filter drops both", () => {
    const only = dialect.sqlToQuery(kessenGoodsCondition("only"));
    expect(only.sql).toBe("(`Item`.`itemType` = ? or `Item`.`id` like ?)");
    expect(only.params).toEqual(["CARD", `${KESSEN_PACK_ID_PREFIX}%`]);
    const exclude = dialect.sqlToQuery(kessenGoodsCondition("exclude"));
    expect(exclude.sql).toBe("not (`Item`.`itemType` = ? or `Item`.`id` like ?)");
    expect(exclude.params).toEqual(only.params);
  });
});
